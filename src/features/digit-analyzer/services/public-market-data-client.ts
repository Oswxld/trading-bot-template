import type { DigitAnalyzerConnectionState } from '../types/digit-analyzer.types';

/**
 * Dedicated, unauthenticated Deriv market-data channel.
 * Never point this client at the app's account/OTP WebSocket.
 */
export const DERIV_PUBLIC_MARKET_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

const DEFAULT_KEEPALIVE_MS = 45_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const READY_STATE_OPEN = 1;

export type PublicMarketRequest =
    | { ping: 1 }
    | { active_symbols: 'brief' | 'full' }
    | { ticks: string; subscribe: 1 }
    | { ticks_history: string; count: number; end: 'latest'; style: 'ticks'; subscribe?: 1 }
    | { forget: string };

export type PublicMarketResponse = {
    msg_type?: string;
    req_id?: number;
    subscription?: { id: string };
    error?: { code?: string; message?: string };
    [key: string]: unknown;
};

type PendingRequest = {
    resolve: (message: PublicMarketResponse) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

export type PublicMarketDataClientOptions = {
    /** Injected in tests only; production defaults to the browser WebSocket. */
    socketFactory?: (url: string) => WebSocket;
    keepaliveMs?: number;
    requestTimeoutMs?: number;
};

/** Only public read-only market-data and subscription-cleanup requests are allowed. */
const isAllowedRequest = (request: unknown): request is PublicMarketRequest => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
    const values = request as Record<string, unknown>;
    const keys = Object.keys(values);
    const only = (allowed: readonly string[]) => keys.every(key => allowed.includes(key));

    if ('ping' in values) return values.ping === 1 && keys.length === 1;
    if ('active_symbols' in values) {
        return only(['active_symbols']) && (values.active_symbols === 'brief' || values.active_symbols === 'full');
    }
    if ('ticks' in values) {
        return only(['ticks', 'subscribe']) && typeof values.ticks === 'string' &&
            /^[A-Za-z0-9_]+$/.test(values.ticks) && values.subscribe === 1;
    }
    if ('ticks_history' in values) {
        return only(['ticks_history', 'count', 'end', 'style', 'subscribe']) &&
            typeof values.ticks_history === 'string' && /^[A-Za-z0-9_]+$/.test(values.ticks_history) &&
            typeof values.count === 'number' && Number.isInteger(values.count) &&
            values.count >= 1 && values.count <= 5_000 &&
            values.end === 'latest' && values.style === 'ticks' &&
            (values.subscribe === undefined || values.subscribe === 1);
    }
    if ('forget' in values) {
        return only(['forget']) && typeof values.forget === 'string' &&
            /^[\w-]{1,128}$/.test(values.forget);
    }
    return false;
};

const toError = (value: unknown, fallback: string): Error =>
    value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);

/**
 * Transport only — it does not call connect() on construction, share the trading
 * socket, fetch market symbols, or subscribe automatically.
 *
 * Chunk 3.1: explicit connect / send / request / receive / close lifecycle.
 * Higher-level market selection, history, and reconnect policy are later chunks.
 */
export class PublicMarketDataClient {
    private readonly socketFactory: (url: string) => WebSocket;
    private readonly keepaliveMs: number;
    private readonly requestTimeoutMs: number;
    private socket: WebSocket | null = null;
    private state: DigitAnalyzerConnectionState = 'idle';
    private nextRequestId = 0;
    private connectPromise: Promise<void> | null = null;
    private connectResolve: (() => void) | null = null;
    private connectReject: ((error: Error) => void) | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private pending = new Map<number, PendingRequest>();
    private messageListeners = new Set<(message: PublicMarketResponse) => void>();
    private stateListeners = new Set<(state: DigitAnalyzerConnectionState) => void>();
    private disposed = false;

    constructor(options: PublicMarketDataClientOptions = {}) {
        this.socketFactory = options.socketFactory ?? (url => new WebSocket(url));
        this.keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        if (!Number.isFinite(this.keepaliveMs) || this.keepaliveMs <= 0 ||
            !Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
            throw new Error('Market-data timers must be positive finite numbers');
        }
    }

    getState(): DigitAnalyzerConnectionState {
        return this.state;
    }

    onMessage(listener: (message: PublicMarketResponse) => void): () => void {
        this.messageListeners.add(listener);
        return () => { this.messageListeners.delete(listener); };
    }

    onStateChange(listener: (state: DigitAnalyzerConnectionState) => void): () => void {
        this.stateListeners.add(listener);
        listener(this.state);
        return () => { this.stateListeners.delete(listener); };
    }

    connect(): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Market-data client is disposed'));
        if (this.socket?.readyState === READY_STATE_OPEN) return Promise.resolve();
        if (this.connectPromise) return this.connectPromise;

        this.setState('connecting');
        this.connectPromise = new Promise<void>((resolve, reject) => {
            this.connectResolve = resolve;
            this.connectReject = reject;
        });
        // Keep the promise even if socket construction fails synchronously.
        const opening = this.connectPromise;

        try {
            const socket = this.socketFactory(DERIV_PUBLIC_MARKET_WS_URL);
            this.socket = socket;
            socket.onopen = () => {
                if (this.socket !== socket) return;
                this.setState('live');
                this.startHeartbeat();
                this.finishConnect();
            };
            socket.onmessage = event => {
                if (this.socket !== socket) return;
                this.receive(event.data);
            };
            socket.onerror = () => {
                this.failSocket(socket, new Error('Public market WebSocket error'));
            };
            socket.onclose = () => {
                this.failSocket(socket, new Error('Public market WebSocket closed'));
            };
        } catch (error) {
            this.stopHeartbeat();
            this.finishConnect(toError(error, 'Unable to open public market WebSocket'));
            this.setState('error');
        }

        // This promise is resolved only by the actual socket open event.
        return opening;
    }

    send(request: PublicMarketRequest): number {
        if (this.disposed) throw new Error('Market-data client is disposed');
        if (!isAllowedRequest(request)) throw new Error('Only read-only public market requests are allowed');
        const socket = this.socket;
        if (!socket || socket.readyState !== READY_STATE_OPEN) {
            throw new Error('Public market WebSocket is not connected');
        }
        const reqId = ++this.nextRequestId;
        socket.send(JSON.stringify({ ...request, req_id: reqId }));
        return reqId;
    }

    request(request: PublicMarketRequest): Promise<PublicMarketResponse> {
        if (this.disposed) return Promise.reject(new Error('Market-data client is disposed'));
        if (!isAllowedRequest(request)) return Promise.reject(new Error('Only read-only public market requests are allowed'));
        if (!this.socket || this.socket.readyState !== READY_STATE_OPEN) {
            return Promise.reject(new Error('Public market WebSocket is not connected'));
        }
        const reqId = this.nextRequestId + 1;
        return new Promise<PublicMarketResponse>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(reqId);
                reject(new Error('Public market request timed out'));
            }, this.requestTimeoutMs);
            this.pending.set(reqId, { resolve, reject, timeout });
            try {
                this.send(request);
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(reqId);
                reject(toError(error, 'Unable to send market request'));
            }
        });
    }

    /** Explicit cleanup: later hooks call this when leaving the Analysis tab. */
    close(): void {
        const socket = this.socket;
        this.socket = null;
        this.stopHeartbeat();
        this.finishConnect(new Error('Public market connection closed'));
        this.rejectPending(new Error('Public market connection closed'));
        if (socket) {
            this.clearHandlers(socket);
            try { socket.close(); } catch { /* already disconnected */ }
        }
        this.setState('idle');
    }

    /** Final teardown. Instances are intentionally not shared across tabs. */
    dispose(): void {
        if (this.disposed) return;
        this.close();
        this.disposed = true;
        this.messageListeners.clear();
        this.stateListeners.clear();
    }

    private receive(raw: unknown): void {
        if (typeof raw !== 'string') return;
        let decoded: unknown;
        try { decoded = JSON.parse(raw); } catch { return; }
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return;
        const message = decoded as PublicMarketResponse;

        if (typeof message.req_id === 'number') {
            const pending = this.pending.get(message.req_id);
            if (pending) {
                this.pending.delete(message.req_id);
                clearTimeout(pending.timeout);
                if (message.error) {
                    pending.reject(new Error(message.error.message || message.error.code || 'Public market API error'));
                } else {
                    pending.resolve(message);
                }
            }
        }

        // Stream updates share the same channel as request responses.
        // One listener failing must not block other consumers.
        for (const listener of this.messageListeners) {
            try { listener(message); } catch { /* listener owns its own UI errors */ }
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeat = setInterval(() => {
            if (this.socket?.readyState !== READY_STATE_OPEN) return;
            try { this.send({ ping: 1 }); } catch { /* onerror/onclose handle connection failure */ }
        }, this.keepaliveMs);
    }

    private stopHeartbeat(): void {
        if (this.heartbeat !== null) clearInterval(this.heartbeat);
        this.heartbeat = null;
    }

    private failSocket(socket: WebSocket, error: Error): void {
        if (this.socket !== socket) return;
        this.socket = null;
        this.clearHandlers(socket);
        this.stopHeartbeat();
        this.finishConnect(error);
        this.rejectPending(error);
        this.setState('error');
        try { socket.close(); } catch { /* no-op */ }
    }

    private finishConnect(error?: Error): void {
        const resolve = this.connectResolve;
        const reject = this.connectReject;
        this.connectResolve = null;
        this.connectReject = null;
        this.connectPromise = null;
        if (error) reject?.(error);
        else resolve?.();
    }

    private rejectPending(error: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private clearHandlers(socket: WebSocket): void {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
    }

    private setState(next: DigitAnalyzerConnectionState): void {
        if (this.state === next) return;
        this.state = next;
        for (const listener of this.stateListeners) {
            try { listener(next); } catch { /* isolate observers from transport */ }
        }
    }
}

export default PublicMarketDataClient;

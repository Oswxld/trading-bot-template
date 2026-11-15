import PublicMarketDataClient, {
    DERIV_PUBLIC_MARKET_WS_URL,
    type PublicMarketRequest,
} from '../services/public-market-data-client';

class FakeSocket {
    readonly url: string;
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    sent: Record<string, unknown>[] = [];
    closeCalls = 0;

    constructor(url: string) {
        this.url = url;
    }

    send(value: string) {
        if (this.readyState !== 1) throw new Error('Cannot send while disconnected');
        this.sent.push(JSON.parse(value));
    }

    close() {
        this.closeCalls += 1;
        this.readyState = 3;
        this.onclose?.(new CloseEvent('close', { code: 1000 }));
    }

    open() {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
    }

    receive(value: unknown) {
        this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
    }

    receiveInvalid() {
        this.onmessage?.({ data: '{invalid-json' } as MessageEvent);
    }

    disconnect() {
        this.readyState = 3;
        this.onclose?.(new CloseEvent('close', { code: 1006 }));
    }

    emitError() {
        this.onerror?.(new Event('error'));
    }
}

describe('PublicMarketDataClient (independent unauthenticated transport)', () => {
    let sockets: FakeSocket[];
    let clients: PublicMarketDataClient[];

    const createClient = (options: { keepaliveMs?: number; requestTimeoutMs?: number } = {}) => {
        const client = new PublicMarketDataClient({
            socketFactory: url => {
                const socket = new FakeSocket(url);
                sockets.push(socket);
                return socket as unknown as WebSocket;
            },
            ...options,
        });
        clients.push(client);
        return client;
    };

    beforeEach(() => {
        sockets = [];
        clients = [];
    });

    afterEach(() => {
        for (const client of clients) client.dispose();
        jest.useRealTimers();
    });

    it('is lazy and uses only the public no-OTP endpoint after explicit connect', async () => {
        const client = createClient();
        expect(client.getState()).toBe('idle');
        expect(sockets).toHaveLength(0);

        const opening = client.connect();
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toBe(DERIV_PUBLIC_MARKET_WS_URL);
        expect(sockets[0].url).not.toMatch(/otp=|token=|\/ws\/(real|demo)/i);
        expect(client.getState()).toBe('connecting');
        sockets[0].open();
        await opening;
        expect(client.getState()).toBe('live');
        expect(sockets[0].sent).toEqual([]);
    });

    it('shares one connection attempt and never opens a socket per request', async () => {
        const client = createClient();
        const first = client.connect();
        const second = client.connect();
        expect(first).toBe(second);
        expect(sockets).toHaveLength(1);
        sockets[0].open();
        await Promise.all([first, second, client.connect()]);
        expect(sockets).toHaveLength(1);

        client.send({ active_symbols: 'brief' });
        client.send({ ticks: 'R_75', subscribe: 1 });
        expect(sockets).toHaveLength(1);
        expect(sockets[0].sent).toEqual([
            { active_symbols: 'brief', req_id: 1 },
            { ticks: 'R_75', subscribe: 1, req_id: 2 },
        ]);
    });

    it('rejects trading, account, token and arbitrary commands even with a type cast', async () => {
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;
        for (const command of [
            { buy: 1 },
            { balance: 1 },
            { authorize: 'private-token' },
            { active_symbols: 'brief', token: 'private-token' },
            { ticks: 'R_75', subscribe: 1, passthrough: { account: 'sensitive' } },
            { ticks_history: 'R_75', count: 10000, end: 'latest', style: 'ticks' },
        ]) {
            expect(() => client.send(command as unknown as PublicMarketRequest)).toThrow('Only read-only');
        }
        await expect(client.request({ buy: 1 } as unknown as PublicMarketRequest)).rejects.toThrow('Only read-only');
        expect(sockets[0].sent).toEqual([]);
    });

    it('matches simultaneous requests by req_id and broadcasts streaming updates', async () => {
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;

        const messages: unknown[] = [];
        const unsubscribe = client.onMessage(message => messages.push(message));
        const symbols = client.request({ active_symbols: 'brief' });
        const history = client.request({ ticks_history: 'R_75', count: 100, end: 'latest', style: 'ticks', subscribe: 1 });

        expect(sockets[0].sent.map(message => message.req_id)).toEqual([1, 2]);
        sockets[0].receive({ msg_type: 'history', req_id: 2, subscription: { id: 'some-subscription-id' }, history: {} });
        sockets[0].receive({ msg_type: 'active_symbols', req_id: 1, active_symbols: [] });
        expect((await symbols).msg_type).toBe('active_symbols');
        expect((await history).subscription?.id).toBe('some-subscription-id');

        sockets[0].receive({ msg_type: 'tick', subscription: { id: 'some-subscription-id' }, tick: { quote: 12.3 } });
        expect(messages).toHaveLength(3);
        unsubscribe();
        sockets[0].receive({ msg_type: 'tick', tick: { quote: 12.4 } });
        expect(messages).toHaveLength(3);
    });

    it('rejects request-scoped API errors but leaves the connection available', async () => {
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;
        const pending = client.request({ active_symbols: 'brief' });
        const rejected = expect(pending).rejects.toThrow('Invalid symbol');

        sockets[0].receive({ req_id: 1, error: { code: 'BadRequest', message: 'Invalid symbol' } });
        await rejected;
        expect(client.getState()).toBe('live');
        client.send({ ping: 1 });
        expect(sockets[0].sent[1]).toEqual({ ping: 1, req_id: 2 });
    });

    it('rejects pending requests on timeout and ignores malformed messages', async () => {
        jest.useFakeTimers();
        const client = createClient({ requestTimeoutMs: 150 });
        const opening = client.connect();
        sockets[0].open();
        await opening;

        const pending = client.request({ active_symbols: 'brief' });
        const rejected = expect(pending).rejects.toThrow('timed out');
        sockets[0].receiveInvalid();
        sockets[0].receive(null);
        jest.advanceTimersByTime(150);
        await rejected;
        expect(client.getState()).toBe('live');
    });

    it('pings every 45 seconds and stops heartbeat after closing', async () => {
        jest.useFakeTimers();
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;

        jest.advanceTimersByTime(45_000);
        expect(sockets[0].sent).toEqual([{ ping: 1, req_id: 1 }]);
        client.close();
        expect(client.getState()).toBe('idle');
        jest.advanceTimersByTime(100_000);
        expect(sockets[0].sent).toHaveLength(1);
    });

    it('releases pending work on close, stays idle, and can connect again explicitly', async () => {
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;
        const pending = client.request({ active_symbols: 'brief' });
        const rejected = expect(pending).rejects.toThrow('closed');

        client.close();
        await rejected;
        expect(client.getState()).toBe('idle');
        expect(sockets[0].closeCalls).toBe(1);
        sockets[0].receive({ req_id: 1, active_symbols: [] });

        const reconnect = client.connect();
        expect(sockets).toHaveLength(2);
        sockets[1].open();
        await reconnect;
        expect(client.getState()).toBe('live');
    });

    it('rejects connect when the socket factory fails synchronously', async () => {
        const client = new PublicMarketDataClient({
            socketFactory: () => { throw new Error('Factory failure'); },
        });
        clients.push(client);
        await expect(client.connect()).rejects.toThrow('Factory failure');
        expect(client.getState()).toBe('error');
    });

    it('rejects open and in-flight work on network failure without automatic reconnect', async () => {
        const client = createClient();
        const states: string[] = [];
        const unsubscribe = client.onStateChange(state => states.push(state));

        const opening = client.connect();
        const failed = expect(opening).rejects.toThrow('WebSocket error');
        sockets[0].emitError();
        await failed;
        expect(client.getState()).toBe('error');
        expect(sockets).toHaveLength(1);

        const reopening = client.connect();
        sockets[1].open();
        await reopening;
        const pending = client.request({ active_symbols: 'brief' });
        const rejected = expect(pending).rejects.toThrow('WebSocket closed');
        sockets[1].disconnect();
        await rejected;
        expect(states).toEqual(['idle', 'connecting', 'error', 'connecting', 'live', 'error']);
        unsubscribe();
    });

    it('supports subscription-specific forget messages and permanent disposal', async () => {
        const client = createClient();
        const opening = client.connect();
        sockets[0].open();
        await opening;
        const unsubscribed = client.request({ forget: 'session_subscription_123' });
        expect(sockets[0].sent[0]).toEqual({ forget: 'session_subscription_123', req_id: 1 });
        sockets[0].receive({ msg_type: 'forget', req_id: 1, forget: 1 });
        expect((await unsubscribed).forget).toBe(1);
        client.dispose();
        expect(client.getState()).toBe('idle');
        await expect(client.connect()).rejects.toThrow('disposed');
        expect(() => client.send({ ping: 1 })).toThrow('disposed');
    });
});

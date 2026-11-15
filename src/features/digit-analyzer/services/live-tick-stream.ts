import type { AnalyzerTick } from '../types/digit-analyzer.types';
import type { PublicMarketResponse } from './public-market-data-client';
import PublicMarketDataClient from './public-market-data-client';
import { normalizeLiveTick } from '../utils/normalize-tick';

type TickHandler = (tick: AnalyzerTick) => void;

type Session = {
    symbol: string;
    subscriptionId: string | null;
    unsubscribe: () => void;
    sequence: number;
    onTick: TickHandler;
};

/**
 * One streaming instrument per instance.
 *
 * Catalog loading and tick updates share the Analyzer's dedicated, anonymous
 * public client. Market handovers are serialized: forget the previous stream
 * and wait for acknowledgment before sending a new subscribe request.
 */
export class LiveTickStream {
    private active: Session | null = null;
    private queue: Promise<void> = Promise.resolve();
    private generation = 0;
    private disposed = false;

    constructor(private readonly client: PublicMarketDataClient) {}

    subscribe(symbol: string, onTick: TickHandler): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Tick stream is disposed'));
        const generation = ++this.generation;
        const operation = this.queue.then(async () => {
            await this.clearSubscription();
            if (this.disposed || generation !== this.generation) return;
            if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol)) {
                throw new Error('Invalid selected tick symbol');
            }
            if (this.client.getState() !== 'live') throw new Error('Public market connection is unavailable');

            const session: Session = {
                symbol,
                subscriptionId: null,
                unsubscribe: () => {},
                sequence: 0,
                onTick,
            };
            session.unsubscribe = this.client.onMessage(message => {
                if (this.disposed || this.active !== session || generation !== this.generation) return;
                this.receiveTick(session, message);
            });
            this.active = session;

            try {
                // Listener is active before the request, so the first subscribed
                // tick is not dropped when its response also carries req_id.
                const initial = await this.client.request({ ticks: symbol, subscribe: 1 });
                const id = initial.subscription?.id;
                if (initial.msg_type !== 'tick' || typeof id !== 'string' || !id) {
                    throw new Error('Deriv did not confirm the tick subscription');
                }
                if (session.subscriptionId && session.subscriptionId !== id) {
                    throw new Error('Mismatched tick subscription identifier');
                }
                session.subscriptionId = id;
            } catch (error) {
                // A timed-out subscription may still exist upstream. Close only
                // the Analyzer's own socket rather than risk orphaned streams.
                if (this.active === session) {
                    session.unsubscribe();
                    this.active = null;
                    this.client.close();
                }
                throw error;
            }
        });
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    /** Queued unsubscribe; safe to call repeatedly or during a pending subscribe. */
    stop(): Promise<void> {
        ++this.generation; // immediately ignore stale streamed updates
        const operation = this.queue.then(() => this.clearSubscription());
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    /** No reconnection, trading API calls, or background work. */
    dispose(): Promise<void> {
        if (this.disposed) return this.queue;
        this.disposed = true;
        return this.stop().catch(() => undefined);
    }

    private receiveTick(session: Session, response: PublicMarketResponse): void {
        if (response.msg_type !== 'tick') return;
        const id = response.subscription?.id;
        if (typeof id !== 'string' || !id) return;
        if (session.subscriptionId && session.subscriptionId !== id) return;

        // Validate the symbol on every update before claiming the stream ID.
        const next = normalizeLiveTick(response, session.symbol, session.sequence + 1);
        if (!next) return;
        if (!session.subscriptionId) session.subscriptionId = id;
        session.sequence += 1;
        session.onTick(next);
    }

    private async clearSubscription(): Promise<void> {
        const session = this.active;
        this.active = null;
        if (!session) return;

        // Stop listening synchronously; no stale price may reach the next chart.
        session.unsubscribe();
        if (!session.subscriptionId) return;

        if (this.client.getState() !== 'live') return;
        try {
            await this.client.request({ forget: session.subscriptionId });
        } catch (error) {
            // Never issue another subscribe while the server could still have
            // the prior one. Closing the anonymous socket clears it upstream.
            this.client.close();
            throw error;
        }
    }
}

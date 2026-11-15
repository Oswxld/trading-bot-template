import { waitFor } from '@testing-library/react';
import { LiveTickStream } from '../services/live-tick-stream';
import PublicMarketDataClient from '../services/public-market-data-client';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

class MarketSocket {
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closeCalls = 0;
    autoForget = true;

    send(body: string) {
        const request = JSON.parse(body) as Record<string, unknown>;
        this.sent.push(request);
        if (request.forget && this.autoForget) {
            queueMicrotask(() => this.reply({ msg_type: 'forget', req_id: request.req_id, forget: 1 }));
        }
    }

    close() {
        this.closeCalls += 1;
        this.readyState = 3;
        this.onclose?.();
    }

    open() {
        this.readyState = 1;
        this.onopen?.();
    }

    reply(body: unknown) {
        this.onmessage?.({ data: JSON.stringify(body) } as MessageEvent);
    }

    tick(symbol: string, subscriptionId: string, quote = 123.45, precision = 3) {
        this.reply({
            msg_type: 'tick',
            subscription: { id: subscriptionId },
            tick: { symbol, quote, epoch: 1770000000, pip_size: precision },
        });
    }

    ack(symbol: string, id: string, index = 0) {
        const request = this.sent.filter(item => item.ticks === symbol)[index];
        if (!request) throw new Error(`Missing subscribe request for ${symbol}`);
        this.reply({
            msg_type: 'tick',
            req_id: request.req_id,
            subscription: { id },
            tick: { symbol, quote: 123.45, epoch: 1770000000, pip_size: 3 },
        });
    }
}

describe('LiveTickStream: one anonymous tick subscription per market', () => {
    let client: PublicMarketDataClient;
    let socket: MarketSocket;
    let manager: LiveTickStream;

    beforeEach(async () => {
        socket = new MarketSocket();
        client = new PublicMarketDataClient({ socketFactory: () => socket as unknown as WebSocket });
        manager = new LiveTickStream(client);
        const opening = client.connect();
        socket.open();
        await opening;
    });

    afterEach(() => {
        client.dispose();
    });

    it('subscribes once and formats the actual first price including trailing zeros', async () => {
        const seen: AnalyzerTick[] = [];
        const subscribed = manager.subscribe('R_75', tick => seen.push(tick));
        await waitFor(() => expect(socket.sent.filter(value => 'ticks' in value)).toHaveLength(1));
        expect(socket.sent[0]).toMatchObject({ ticks: 'R_75', subscribe: 1 });

        socket.ack('R_75', 'stream-75');
        await subscribed;

        expect(seen).toEqual([{
            id: 'R_75:1770000000:1',
            quote: '123.450',
            digit: 0,
            epoch: 1770000000,
        }]);
        socket.tick('R_75', 'stream-75', 987.654, 2);
        expect(seen[1].quote).toBe('987.65');
        expect(seen[1].digit).toBe(5);
    });

    it('ignores ticks for other symbols and stale subscription IDs', async () => {
        const seen: AnalyzerTick[] = [];
        const subscribed = manager.subscribe('R_10', tick => seen.push(tick));
        await waitFor(() => expect(socket.sent.some(value => value.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await subscribed;
        expect(seen).toHaveLength(1);

        socket.tick('R_75', 'stream-10');
        socket.tick('R_10', 'stream-obsolete');
        socket.reply({ msg_type: 'tick', subscription: { id: 'stream-10' }, tick: { symbol: 'R_10', quote: 123.45 } });
        socket.reply({ msg_type: 'history', subscription: { id: 'stream-10' }, history: {} });
        expect(seen).toHaveLength(1);
    });

    it('forgets the previous subscription before sending the next one', async () => {
        const seen: string[] = [];
        const first = manager.subscribe('R_10', () => seen.push('10'));
        await waitFor(() => expect(socket.sent.filter(item => 'ticks' in item)).toHaveLength(1));
        socket.ack('R_10', 'stream-10');
        await first;

        const second = manager.subscribe('R_75', () => seen.push('75'));
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));
        expect(socket.sent.map(item => Object.keys(item).find(key => ['ticks', 'forget'].includes(key)))).toEqual([
            'ticks', 'forget', 'ticks',
        ]);
        socket.ack('R_75', 'stream-75');
        await second;
        socket.tick('R_10', 'stream-10');
        expect(seen).toEqual(['10', '75']);
    });

    it('skips an obsolete symbol if user changes selection before first ack', async () => {
        const original = manager.subscribe('R_10', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        const latest = manager.subscribe('R_75', jest.fn());
        expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(false);

        socket.ack('R_10', 'stream-10');
        await original;
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));
        socket.ack('R_75', 'stream-75');
        await latest;
        expect(socket.sent.filter(item => 'ticks' in item)).toHaveLength(2);
    });

    it('stop immediately ignores stale updates and confirms forget before returning', async () => {
        const seen: AnalyzerTick[] = [];
        const first = manager.subscribe('R_10', tick => seen.push(tick));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await first;
        expect(seen).toHaveLength(1);

        const done = manager.stop();
        socket.tick('R_10', 'stream-10');
        await done;
        expect(seen).toHaveLength(1);
        expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true);
    });

    it('closes the isolated socket instead of overlapping subscriptions if forget fails', async () => {
        socket.autoForget = false;
        const first = manager.subscribe('R_10', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await first;

        const switching = manager.subscribe('R_75', jest.fn());
        const rejected = expect(switching).rejects.toThrow('Forget failed');
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));
        const forgetting = socket.sent.find(item => item.forget === 'stream-10');
        socket.reply({ req_id: forgetting?.req_id, error: { message: 'Forget failed' } });
        await rejected;

        expect(client.getState()).toBe('idle');
        expect(socket.closeCalls).toBeGreaterThan(0);
        expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(false);
    });

    it('refuses an invalid symbol without sending any subscription request', async () => {
        await expect(manager.subscribe('R_75?token=abc', jest.fn())).rejects.toThrow('Invalid selected tick symbol');
        expect(socket.sent.filter(item => 'ticks' in item)).toHaveLength(0);
    });

    it('ignores uncorrelated same-symbol ticks before the subscribe request is acknowledged', async () => {
        const seen: AnalyzerTick[] = [];
        const pending = manager.subscribe('R_75', tick => seen.push(tick));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));

        // A stale/orphaned subscription must not be able to claim the new session.
        socket.tick('R_75', 'orphaned-stream', 999.999, 3);
        expect(seen).toHaveLength(0);

        socket.ack('R_75', 'expected-stream');
        await pending;
        expect(seen).toHaveLength(1);
        expect(seen[0].quote).toBe('123.450');

        socket.tick('R_75', 'orphaned-stream', 888.888, 3);
        socket.tick('R_75', 'expected-stream', 777.777, 3);
        expect(seen.map(tick => tick.quote)).toEqual(['123.450', '777.777']);
    });

    it('will not begin a second subscription before forget is actually confirmed', async () => {
        socket.autoForget = false;
        const first = manager.subscribe('R_10', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await first;

        const second = manager.subscribe('R_75', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));

        // Even with a pending new selection, the old subscription remains the
        // sole one until we receive a matching req_id from the Deriv server.
        expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(false);

        const forget = socket.sent.find(item => item.forget === 'stream-10');
        socket.reply({ msg_type: 'forget', req_id: forget?.req_id, forget: 1 });
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));
        socket.ack('R_75', 'stream-75');
        await second;
    });

    it('closes the public socket rather than overlapping streams after an unconfirmed forget response', async () => {
        socket.autoForget = false;
        const first = manager.subscribe('R_10', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await first;

        const switching = manager.subscribe('R_75', jest.fn());
        const rejected = expect(switching).rejects.toThrow('did not confirm tick subscription cancellation');
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));

        const forget = socket.sent.find(item => item.forget === 'stream-10');
        socket.reply({ msg_type: 'forget', req_id: forget?.req_id, forget: 0 });
        await rejected;
        expect(socket.closeCalls).toBeGreaterThan(0);
        expect(client.getState()).toBe('idle');
        expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(false);
    });

    it('coalesces rapid R_10 → R_25 → R_75 selections while a subscribe is pending', async () => {
        const observations: string[] = [];
        const first = manager.subscribe('R_10', tick => observations.push('10:' + tick.quote));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));

        const middle = manager.subscribe('R_25', tick => observations.push('25:' + tick.quote));
        const final = manager.subscribe('R_75', tick => observations.push('75:' + tick.quote));
        socket.tick('R_10', 'unknown-stream');
        socket.ack('R_10', 'stream-10');
        await first;
        await middle;
        await waitFor(() => expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true));
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));

        expect(socket.sent.some(item => item.ticks === 'R_25')).toBe(false);
        socket.ack('R_75', 'stream-75');
        await final;
        socket.tick('R_10', 'stream-10');
        expect(observations).toEqual(['75:123.450']);
    });

    it('ignores all delayed ticks after disposal even while the server confirmation is pending', async () => {
        const callback = jest.fn();
        const starting = manager.subscribe('R_75', callback);
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_75')).toBe(true));

        const disposed = manager.dispose();
        socket.tick('R_75', 'old-session', 456.789, 3);
        socket.ack('R_75', 'stream-75');
        await starting;
        await disposed;
        socket.tick('R_75', 'stream-75', 999.999, 3);

        expect(callback).not.toHaveBeenCalled();
        expect(socket.sent.some(item => item.forget === 'stream-75')).toBe(true);
        await expect(manager.subscribe('R_10', callback)).rejects.toThrow('disposed');
    });

    it('dispose rejects new subscriptions and removes the old stream', async () => {
        const first = manager.subscribe('R_10', jest.fn());
        await waitFor(() => expect(socket.sent.some(item => item.ticks === 'R_10')).toBe(true));
        socket.ack('R_10', 'stream-10');
        await first;

        await manager.dispose();
        expect(socket.sent.some(item => item.forget === 'stream-10')).toBe(true);
        await expect(manager.subscribe('R_75', jest.fn())).rejects.toThrow('disposed');
    });
});

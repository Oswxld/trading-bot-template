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

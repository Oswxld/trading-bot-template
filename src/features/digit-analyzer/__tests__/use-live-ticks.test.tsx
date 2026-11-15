import { act, renderHook, waitFor } from '@testing-library/react';
import { useLiveTicks } from '../hooks/use-live-ticks';
import PublicMarketDataClient from '../services/public-market-data-client';

class SocketFixture {
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    send(body: string) {
        const request = JSON.parse(body) as Record<string, unknown>;
        this.sent.push(request);
        if (request.forget) {
            queueMicrotask(() => this.reply({ req_id: request.req_id, msg_type: 'forget', forget: 1 }));
        }
    }

    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    reply(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent); }
    subscribeResponse(symbol: string, quote: number, decimals: number) {
        const subscribe = this.sent.find(value => value.ticks === symbol);
        if (!subscribe) throw new Error('No tick subscription request for ' + symbol);
        this.reply({
            msg_type: 'tick',
            req_id: subscribe.req_id,
            subscription: { id: 'tick-' + symbol },
            tick: { symbol, quote, pip_size: decimals, epoch: 1770000000 },
        });
    }
}

describe('useLiveTicks dashboard data lifecycle', () => {
    let client: PublicMarketDataClient;
    let socket: SocketFixture;

    beforeEach(async () => {
        socket = new SocketFixture();
        client = new PublicMarketDataClient({ socketFactory: () => socket as unknown as WebSocket });
        const opening = client.connect();
        socket.open();
        await opening;
    });

    afterEach(() => client.dispose());

    it('displays a verified live quote and recent history from the dedicated public socket', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true));
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
        act(() => socket.subscribeResponse('R_10', 123.45, 3));

        await waitFor(() => expect(result.current.status).toBe('streaming'));
        expect(result.current.latestTick?.quote).toBe('123.450');
        expect(result.current.latestTick?.digit).toBe(0);
        expect(result.current.recentTicks).toHaveLength(1);

        act(() => socket.reply({
            msg_type: 'tick',
            subscription: { id: 'tick-R_10' },
            tick: { symbol: 'R_10', quote: 123.456, pip_size: 3, epoch: 1770000001 },
        }));
        expect(result.current.recentTicks[0].quote).toBe('123.456');
        expect(result.current.recentTicks[0].digit).toBe(6);
        expect(result.current.recentTicks[1].quote).toBe('123.450');
    });

    it('keeps a bounded list instead of accumulating unbounded ticks', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true));
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
        act(() => socket.subscribeResponse('R_10', 12, 2));
        await waitFor(() => expect(result.current.status).toBe('streaming'));
        act(() => {
            for (let i = 1; i <= 40; i++) {
                socket.reply({
                    msg_type: 'tick', subscription: { id: 'tick-R_10' },
                    tick: { symbol: 'R_10', quote: i + 0.25, pip_size: 2, epoch: 1770000000 + i },
                });
            }
        });
        expect(result.current.recentTicks).toHaveLength(20);
        expect(result.current.recentTicks[0].quote).toBe('40.25');
    });

    it('clears the old quote while changing markets and never displays a delayed old price', async () => {
        const { result, rerender } = renderHook(
            ({ symbol }) => useLiveTicks(client, symbol, true),
            { initialProps: { symbol: 'R_10' } }
        );
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
        act(() => socket.subscribeResponse('R_10', 123.45, 3));
        await waitFor(() => expect(result.current.status).toBe('streaming'));

        rerender({ symbol: 'R_75' });
        expect(result.current.latestTick).toBeNull();
        expect(result.current.recentTicks).toHaveLength(0);
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_75')).toBe(true));
        act(() => {
            socket.reply({
                msg_type: 'tick', subscription: { id: 'tick-R_10' },
                tick: { symbol: 'R_10', quote: 999.99, pip_size: 2, epoch: 1770000100 },
            });
            socket.subscribeResponse('R_75', 987.654, 2);
        });
        await waitFor(() => expect(result.current.status).toBe('streaming'));
        expect(result.current.latestTick?.quote).toBe('987.65');
        expect(result.current.latestTick?.digit).toBe(5);
        expect(result.current.recentTicks).toHaveLength(1);
    });

    it('disables streaming and resets the quote when the catalog becomes unavailable', async () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useLiveTicks(client, 'R_10', enabled),
            { initialProps: { enabled: true } }
        );
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
        act(() => socket.subscribeResponse('R_10', 123.45, 3));
        await waitFor(() => expect(result.current.status).toBe('streaming'));

        rerender({ enabled: false });
        expect(result.current.status).toBe('idle');
        expect(result.current.latestTick).toBeNull();
        expect(result.current.recentTicks).toHaveLength(0);
        await waitFor(() => expect(socket.sent.some(message => message.forget === 'tick-R_10')).toBe(true));
    });

    it('handles three rapid selections without showing an obsolete quote or opening a second socket', async () => {
        const { result, rerender } = renderHook(
            ({ symbol }) => useLiveTicks(client, symbol, true),
            { initialProps: { symbol: 'R_10' } }
        );
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
        rerender({ symbol: 'R_25' });
        rerender({ symbol: 'R_75' });

        expect(result.current.latestTick).toBeNull();
        expect(result.current.status).toBe('subscribing');
        act(() => socket.subscribeResponse('R_10', 123.45, 3));
        await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_75')).toBe(true));

        expect(socket.sent.some(message => message.ticks === 'R_25')).toBe(false);
        expect(socket.sent.some(message => message.forget === 'tick-R_10')).toBe(true);
        act(() => socket.subscribeResponse('R_75', 987.654, 2));
        await waitFor(() => expect(result.current.status).toBe('streaming'));
        expect(result.current.latestTick?.quote).toBe('987.65');
        expect(result.current.recentTicks).toHaveLength(1);
        expect(result.current.recentTicks[0].id.startsWith('R_75:')).toBe(true);
    });

    it('ignores late ticks when switching public clients and cleans up the old one', async () => {
        const replacementSocket = new SocketFixture();
        const replacementClient = new PublicMarketDataClient({
            socketFactory: () => replacementSocket as unknown as WebSocket,
        });
        try {
            const connecting = replacementClient.connect();
            replacementSocket.open();
            await connecting;

            const { result, rerender, unmount } = renderHook(
                ({ activeClient }) => useLiveTicks(activeClient, 'R_10', true),
                { initialProps: { activeClient: client } }
            );
            await waitFor(() => expect(socket.sent.some(message => message.ticks === 'R_10')).toBe(true));
            act(() => socket.subscribeResponse('R_10', 123.45, 3));
            await waitFor(() => expect(result.current.status).toBe('streaming'));
            expect(result.current.latestTick?.quote).toBe('123.450');

            rerender({ activeClient: replacementClient });
            expect(result.current.latestTick).toBeNull();
            await waitFor(() => expect(replacementSocket.sent.some(message => message.ticks === 'R_10')).toBe(true));

            act(() => {
                socket.reply({
                    msg_type: 'tick', subscription: { id: 'tick-R_10' },
                    tick: { symbol: 'R_10', quote: 999.999, pip_size: 3, epoch: 1770000010 },
                });
                replacementSocket.subscribeResponse('R_10', 456.789, 3);
            });
            await waitFor(() => expect(result.current.status).toBe('streaming'));
            expect(result.current.latestTick?.quote).toBe('456.789');
            expect(result.current.recentTicks.map(t => t.quote)).toEqual(['456.789']);

            unmount();
            await waitFor(() => expect(replacementSocket.sent.some(message => message.forget === 'tick-R_10')).toBe(true));
        } finally {
            replacementClient.dispose();
        }
    });

    it('has no socket side effects when there is no catalog client or selected market', () => {
        const { result } = renderHook(() => useLiveTicks(null, '', false));
        expect(result.current.status).toBe('idle');
        expect(result.current.latestTick).toBeNull();
        expect(socket.sent).toEqual([]);
    });
});

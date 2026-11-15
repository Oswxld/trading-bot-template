import { fetchHistoricalTicks } from '../services/historical-ticks';
import PublicMarketDataClient from '../services/public-market-data-client';
import type { PublicMarketResponse } from '../services/public-market-data-client';

const reply = (symbol: string, count: number, prices: number[] = [123.45, 123.456]): PublicMarketResponse => ({
    msg_type: 'history',
    echo_req: { ticks_history: symbol, count, end: 'latest', style: 'ticks' },
    pip_size: 3,
    history: { prices, times: prices.map((_, index) => 1770000000 + index) },
});

class FakeHistorySocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sent: Array<Record<string, unknown>> = [];
    closed = 0;

    send(payload: string) { this.sent.push(JSON.parse(payload)); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message: Record<string, unknown>) {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    }
    close() { this.closed += 1; this.readyState = 3; }
}

describe('Digit Analyzer one-off historical tick service', () => {
    it.each([100, 500, 1000] as const)(
        'requests exactly %s ticks from existing public socket with NO subscription', async count => {
            const client = {
                request: jest.fn().mockResolvedValue(reply('1HZ10V', count)),
                close: jest.fn(),
            };
            const ticks = await fetchHistoricalTicks(client, '1HZ10V', count);
            expect(client.request).toHaveBeenCalledTimes(1);
            expect(client.request).toHaveBeenCalledWith({
                ticks_history: '1HZ10V',
                count,
                end: 'latest',
                style: 'ticks',
            });
            expect(ticks.map(t => t.quote)).toEqual(['123.450', '123.456']);
            expect(ticks.map(t => t.digit)).toEqual([0, 6]);
            expect(client.close).not.toHaveBeenCalled();
        }
    );

    it('rejects arbitrary counts and unsafe symbols without any network request', async () => {
        const client = { request: jest.fn(), close: jest.fn() };
        const invalidSymbols = ['', '../token', 'R_75?otp=abc', 'A', '1'.repeat(31)];
        for (const symbol of invalidSymbols) {
            await expect(fetchHistoricalTicks(client, symbol, 100)).rejects.toThrow('Invalid historical tick symbol');
        }
        for (const count of [0, 1, 99, 101, 501, 5000, NaN] as const) {
            await expect(fetchHistoricalTicks(client, '1HZ10V', count as unknown as 100))
                .rejects.toThrow('Historical tick count');
        }
        expect(client.request).not.toHaveBeenCalled();
    });

    it('does not claim success on API rejection or malformed history', async () => {
        const client = {
            request: jest.fn().mockRejectedValueOnce(new Error('Rate limited'))
                .mockResolvedValueOnce({ msg_type: 'history', history: {} }),
            close: jest.fn(),
        };
        await expect(fetchHistoricalTicks(client, '1HZ10V', 100)).rejects.toThrow('Rate limited');
        await expect(fetchHistoricalTicks(client, '1HZ10V', 100)).rejects.toThrow('precision');
        expect(client.close).not.toHaveBeenCalled();
    });

    it('closes ONLY the isolated public client if a server unexpectedly creates a subscription', async () => {
        const client = {
            request: jest.fn().mockResolvedValue({
                ...reply('1HZ10V', 100),
                subscription: { id: 'unexpected-history-stream' },
            }),
            close: jest.fn(),
        };
        await expect(fetchHistoricalTicks(client, '1HZ10V', 100))
            .rejects.toThrow('unexpectedly created a subscription');
        expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('pairs requests and out-of-order responses using the real transport req_id mechanism', async () => {
        const socket = new FakeHistorySocket();
        const client = new PublicMarketDataClient({
            socketFactory: () => socket as unknown as WebSocket,
        });
        try {
            const opening = client.connect();
            socket.open();
            await opening;

            const a = fetchHistoricalTicks(client, 'R_10', 100);
            const b = fetchHistoricalTicks(client, 'R_75', 500);

            expect(socket.sent).toHaveLength(2);
            expect(socket.sent[0]).toEqual({
                ticks_history: 'R_10', count: 100, end: 'latest', style: 'ticks', req_id: 1,
            });
            expect(socket.sent[1]).toEqual({
                ticks_history: 'R_75', count: 500, end: 'latest', style: 'ticks', req_id: 2,
            });
            expect(socket.sent.every(payload => !('subscribe' in payload))).toBe(true);
            expect(socket.sent.every(payload => !('buy' in payload || 'authorize' in payload))).toBe(true);

            socket.receive({ ...reply('R_75', 500, [987.65]), req_id: 2 });
            socket.receive({ ...reply('R_10', 100, [111.22, 111.23]), req_id: 1 });

            expect((await a).map(t => t.quote)).toEqual(['111.220', '111.230']);
            expect((await b).map(t => t.quote)).toEqual(['987.650']);
        } finally {
            client.dispose();
        }
        expect(socket.closed).toBe(1);
    });

    it('rejects a pending history response on socket close without inventing data', async () => {
        const socket = new FakeHistorySocket();
        const client = new PublicMarketDataClient({
            socketFactory: () => socket as unknown as WebSocket,
        });
        try {
            const opening = client.connect();
            socket.open();
            await opening;
            const pending = fetchHistoricalTicks(client, 'R_10', 100);
            const rejected = expect(pending).rejects.toThrow('connection closed');
            client.close();
            await rejected;
        } finally {
            client.dispose();
        }
    });
});

import { fetchSyntheticMarketCatalog } from '../services/market-catalog';
import PublicMarketDataClient, {
    DERIV_PUBLIC_MARKET_WS_URL,
    type PublicMarketResponse,
} from '../services/public-market-data-client';

const currentCatalog = [
    { underlying_symbol: 'R_100', underlying_symbol_name: 'Volatility 100 Index',
        market: 'synthetic_index', subgroup: 'synthetics', submarket: 'random_index',
        exchange_is_open: 1, is_trading_suspended: 0, pip_size: 0.01 },
    { underlying_symbol: 'R_10', underlying_symbol_name: 'Volatility 10 Index',
        market: 'synthetic_index', subgroup: 'synthetics', submarket: 'random_index',
        exchange_is_open: 1, is_trading_suspended: 0, pip_size: 0.001 },
    { underlying_symbol: 'frxEURUSD', underlying_symbol_name: 'EUR/USD', market: 'forex' },
];

describe('Digit Analyzer: Deriv synthetic-market catalog', () => {
    it('connects to the dedicated public client before requesting full active symbols', async () => {
        const sequence: string[] = [];
        const connect = jest.fn(async () => { sequence.push('connect'); });
        const request = jest.fn(async () => {
            sequence.push('request');
            return { msg_type: 'active_symbols', active_symbols: currentCatalog } as PublicMarketResponse;
        });
        const markets = await fetchSyntheticMarketCatalog({ connect, request });

        expect(sequence).toEqual(['connect', 'request']);
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({ active_symbols: 'full' });
        expect(markets.map(m => m.symbol)).toEqual(['R_10', 'R_100']);
        expect(markets[0].pipSize).toBe(0.001);
        expect(markets[0].isOpen).toBe(true);
    });

    it('does not send any request when connection fails', async () => {
        const request = jest.fn();
        await expect(fetchSyntheticMarketCatalog({
            connect: jest.fn(async () => { throw new Error('Connection refused'); }),
            request,
        })).rejects.toThrow('Connection refused');
        expect(request).not.toHaveBeenCalled();
    });

    it('passes request errors through instead of silently showing no markets', async () => {
        await expect(fetchSyntheticMarketCatalog({
            connect: jest.fn(async () => undefined),
            request: jest.fn(async () => { throw new Error('API unavailable'); }),
        })).rejects.toThrow('API unavailable');
    });

    it('rejects mismatched or malformed active-symbol responses', async () => {
        const connect = jest.fn(async () => undefined);
        const request = jest.fn();
        request.mockResolvedValueOnce({ msg_type: 'ticks', active_symbols: currentCatalog });
        await expect(fetchSyntheticMarketCatalog({ connect, request })).rejects.toThrow('Unexpected Deriv response');

        request.mockResolvedValueOnce({ msg_type: 'active_symbols', active_symbols: undefined });
        await expect(fetchSyntheticMarketCatalog({ connect, request })).rejects.toThrow('Invalid Deriv active_symbols response');
    });

    it('sends a real-shaped request over a test public WebSocket and resolves by req_id', async () => {
        let socket: FakePublicSocket | undefined;
        const client = new PublicMarketDataClient({
            socketFactory: url => {
                socket = new FakePublicSocket(url);
                return socket as unknown as WebSocket;
            },
        });

        try {
            const pending = fetchSyntheticMarketCatalog(client);
            expect(socket?.url).toBe(DERIV_PUBLIC_MARKET_WS_URL);
            expect(socket?.sent).toHaveLength(0);

            socket?.open();
            // Allow the caller's awaiting connect() to proceed to active_symbols.
            await Promise.resolve();
            expect(socket?.sent).toHaveLength(1);
            expect(socket?.sent[0]).toEqual({ active_symbols: 'full', req_id: 1 });

            socket?.reply({ msg_type: 'active_symbols', req_id: 1, active_symbols: currentCatalog });
            expect((await pending).map(m => m.symbol)).toEqual(['R_10', 'R_100']);
            expect(socket?.sent.some(m => 'authorize' in m || 'buy' in m || 'token' in m)).toBe(false);
        } finally {
            client.dispose();
        }
    });
});

/** The mock is a protocol fixture, not a simulated data feed used by the UI. */
class FakePublicSocket {
    readonly url: string;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    sent: Record<string, unknown>[] = [];

    constructor(url: string) { this.url = url; }
    send(payload: string) { this.sent.push(JSON.parse(payload)); }
    close() { this.readyState = 3; }
    open() {
        this.readyState = 1;
        this.onopen?.();
    }
    reply(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    }
}

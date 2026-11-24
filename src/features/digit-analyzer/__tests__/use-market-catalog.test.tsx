import { act, renderHook, waitFor } from '@testing-library/react';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import type { PublicMarketDataClient, PublicMarketResponse } from '../services/public-market-data-client';
import type { DigitAnalyzerConnectionState } from '../types/digit-analyzer.types';

const sampleCatalog = [
    {
        underlying_symbol: 'R_10',
        underlying_symbol_name: 'Volatility 10 Index',
        market: 'synthetic_index',
        exchange_is_open: 1,
        is_trading_suspended: 0,
    },
    {
        underlying_symbol: 'R_25',
        underlying_symbol_name: 'Volatility 25 Index',
        market: 'synthetic_index',
        exchange_is_open: 1,
        is_trading_suspended: 0,
    },
    {
        underlying_symbol: 'R_50',
        underlying_symbol_name: 'Volatility 50 Index',
        market: 'synthetic_index',
        exchange_is_open: 0,
        is_trading_suspended: 0,
    },
];

class FakeCatalogClient {
    readonly requests: unknown[] = [];
    readonly callbacks = new Set<(state: DigitAnalyzerConnectionState) => void>();
    state: DigitAnalyzerConnectionState = 'idle';
    isDisposed = false;

    constructor(
        private readonly getCatalog: () => Promise<PublicMarketResponse> = async () => ({
            msg_type: 'active_symbols',
            active_symbols: sampleCatalog,
        })
    ) {}

    getState() {
        return this.state;
    }

    onStateChange(listener: (state: DigitAnalyzerConnectionState) => void) {
        this.callbacks.add(listener);
        listener(this.state);
        return () => { this.callbacks.delete(listener); };
    }

    emit(next: DigitAnalyzerConnectionState) {
        this.state = next;
        for (const callback of this.callbacks) callback(next);
    }

    connect = jest.fn(async () => {
        this.emit('connecting');
        this.emit('live');
    });

    request = jest.fn((request: unknown) => {
        this.requests.push(request);
        return this.getCatalog();
    });

    close = jest.fn(() => { this.emit('idle'); });
    dispose = jest.fn(() => { this.isDisposed = true; this.close(); });

    asClient() {
        return this as unknown as PublicMarketDataClient;
    }
}

describe('useMarketCatalog integration', () => {
    it('loads synthetic markets on mount, picks a selectable symbol and disposes on unmount', async () => {
        const client = new FakeCatalogClient();
        const factory = () => client.asClient();
        const { result, unmount } = renderHook(() => useMarketCatalog(factory));

        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.connectionState).toBe('live');
        expect(result.current.selectedSymbol).toBe('R_10');
        expect(result.current.markets.map(market => market.symbol)).toEqual(['R_10', 'R_25', 'R_50']);
        expect(client.requests).toEqual([{ active_symbols: 'full' }]);
        expect(client.connect).toHaveBeenCalledTimes(1);

        unmount();
        expect(client.dispose).toHaveBeenCalledTimes(1);
        expect(client.callbacks.size).toBe(0);
    });

    it('only allows market choices that came from the server and are not closed', async () => {
        const client = new FakeCatalogClient();
        const factory = () => client.asClient();
        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        act(() => result.current.selectMarket('R_25'));
        expect(result.current.selectedSymbol).toBe('R_25');
        act(() => result.current.selectMarket('R_50'));
        expect(result.current.selectedSymbol).toBe('R_25');
        act(() => result.current.selectMarket('UNLISTED'));
        expect(result.current.selectedSymbol).toBe('R_25');
        expect(client.requests).toEqual([{ active_symbols: 'full' }]);
    });

    it('only exposes the five standard Volatility indices in Analysis', async () => {
        const client = new FakeCatalogClient(async () => ({
            msg_type: 'active_symbols',
            active_symbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ100V', 'BOOM1000', 'R_200'].map(symbol => ({
                ...sampleCatalog[0],
                underlying_symbol: symbol,
                underlying_symbol_name: symbol,
            })),
        }));
        const factory = () => client.asClient();
        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.markets.map(market => market.symbol).sort()).toEqual(
            ['R_10', 'R_100', 'R_25', 'R_50', 'R_75']
        );
        const selected = result.current.selectedSymbol;
        act(() => result.current.selectMarket('1HZ100V'));
        expect(result.current.selectedSymbol).toBe(selected);
        act(() => result.current.selectMarket('R_75'));
        expect(result.current.selectedSymbol).toBe('R_75');
    });

    it('reports an empty catalog when all markets are unavailable', async () => {
        const closed = new FakeCatalogClient(async () => ({
            msg_type: 'active_symbols',
            active_symbols: [{ ...sampleCatalog[0], exchange_is_open: 0 }],
        }));
        const factory = () => closed.asClient();
        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(result.current.phase).toBe('empty'));
        expect(result.current.markets).toHaveLength(1);
        expect(result.current.selectedSymbol).toBe('');

        act(() => result.current.selectMarket('R_10'));
        expect(result.current.selectedSymbol).toBe('');
    });

    it('shows connection/catalog errors, then reloads using a new connection', async () => {
        const failing = new FakeCatalogClient(async () => {
            throw new Error('API is unavailable');
        });
        const healthy = new FakeCatalogClient();
        const clients = [failing, healthy];
        const factory = jest.fn(() => {
            const next = clients.shift();
            if (!next) throw new Error('Unexpected extra client');
            return next.asClient();
        });

        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(result.current.phase).toBe('error'));
        expect(result.current.connectionState).toBe('error');
        expect(result.current.error).toBe('API is unavailable');
        expect(result.current.markets).toEqual([]);

        act(() => result.current.reloadMarkets());
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.connectionState).toBe('live');
        expect(result.current.error).toBeNull();
        expect(failing.dispose).toHaveBeenCalledTimes(1);
        expect(healthy.connect).toHaveBeenCalledTimes(1);
    });

    it('does not allow an old response to overwrite data after a reload', async () => {
        let resolveOld!: (response: PublicMarketResponse) => void;
        const oldRequest = new Promise<PublicMarketResponse>(resolve => { resolveOld = resolve; });
        const obsolete = new FakeCatalogClient(() => oldRequest);
        const fresh = new FakeCatalogClient(async () => ({
            msg_type: 'active_symbols',
            active_symbols: [{ ...sampleCatalog[1] }],
        }));
        const clients = [obsolete, fresh];
        const factory = () => {
            const client = clients.shift();
            if (!client) throw new Error('Unexpected extra client');
            return client.asClient();
        };
        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(obsolete.request).toHaveBeenCalledTimes(1));

        act(() => result.current.reloadMarkets());
        await waitFor(() => expect(result.current.phase).toBe('ready'));
        expect(result.current.selectedSymbol).toBe('R_25');

        await act(async () => resolveOld({
            msg_type: 'active_symbols',
            active_symbols: sampleCatalog,
        }));
        expect(result.current.selectedSymbol).toBe('R_25');
        expect(result.current.markets.map(market => market.symbol)).toEqual(['R_25']);
        expect(obsolete.dispose).toHaveBeenCalledTimes(1);
    });

    it('disables market selection when the public socket goes down', async () => {
        const client = new FakeCatalogClient();
        const factory = () => client.asClient();
        const { result } = renderHook(() => useMarketCatalog(factory));
        await waitFor(() => expect(result.current.phase).toBe('ready'));

        act(() => client.emit('error'));
        expect(result.current.phase).toBe('error');
        expect(result.current.connectionState).toBe('error');
        expect(result.current.markets).toHaveLength(0);
        expect(result.current.error).toContain('connection lost');

        act(() => result.current.selectMarket('R_25'));
        expect(result.current.selectedSymbol).toBe('R_10');
    });
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSyntheticMarketCatalog } from '../services/market-catalog';
import PublicMarketDataClient from '../services/public-market-data-client';
import type { AnalyzerMarket, DigitAnalyzerConnectionState } from '../types/digit-analyzer.types';

export type MarketCatalogPhase = 'loading' | 'ready' | 'empty' | 'error';

const createPublicMarketClient = () => new PublicMarketDataClient();

const describeFailure = (error: unknown): string =>
    error instanceof Error ? error.message : 'Unable to load synthetic markets from Deriv.';

/**
 * Catalog-only lifecycle for Chunk 3.3.
 *
 * One socket per mounted Analysis page; strictly no Bot Builder, trading-account
 * auth or shared market API. Every reload and unmount disposes the previous
 * socket. An obsolete request is never allowed to update component state.
 *
 * The clientRef is reserved for the tick manager in subsequent chunks; this
 * hook makes NO tick-history or tick-subscription request.
 */
export const useMarketCatalog = (clientFactory: () => PublicMarketDataClient = createPublicMarketClient) => {
    const [markets, setMarkets] = useState<AnalyzerMarket[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const [connectionState, setConnectionState] = useState<DigitAnalyzerConnectionState>('idle');
    const [phase, setPhase] = useState<MarketCatalogPhase>('loading');
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const clientRef = useRef<PublicMarketDataClient | null>(null);

    useEffect(() => {
        let current = true;
        const client = clientFactory();
        clientRef.current = client;
        setConnectionState(client.getState());
        setPhase('loading');
        setError(null);
        setMarkets([]);

        const removeListener = client.onStateChange(next => {
            if (!current) return;
            setConnectionState(next);
            if (next === 'error') {
                setMarkets([]);
                setPhase('error');
                setError('Public market connection lost. Reload the market list to try again.');
            }
        });

        void fetchSyntheticMarketCatalog(client).then(catalog => {
            if (!current) return;
            const selectable = catalog.filter(market => market.isOpen !== false);
            setMarkets(catalog);
            setSelectedSymbol(previous =>
                selectable.some(market => market.symbol === previous)
                    ? previous
                    : (selectable[0]?.symbol ?? '')
            );
            setError(null);
            setPhase(selectable.length > 0 ? 'ready' : 'empty');
        }).catch(reason => {
            if (!current) return;
            client.close();
            setMarkets([]);
            setConnectionState('error');
            setError(describeFailure(reason));
            setPhase('error');
        });

        return () => {
            current = false;
            removeListener();
            client.dispose();
            if (clientRef.current === client) clientRef.current = null;
        };
    }, [clientFactory, reloadToken]);

    const selectMarket = useCallback((symbol: string) => {
        // Never accept a symbol outside the current, server-derived catalog.
        if (phase !== 'ready' || connectionState !== 'live') return;
        if (markets.some(market => market.symbol === symbol && market.isOpen !== false)) {
            setSelectedSymbol(symbol);
        }
    }, [connectionState, markets, phase]);

    const reloadMarkets = useCallback(() => setReloadToken(number => number + 1), []);

    return {
        markets,
        selectedSymbol,
        selectMarket,
        connectionState,
        phase,
        error,
        reloadMarkets,
        clientRef,
    };
};

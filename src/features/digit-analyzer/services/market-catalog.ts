import type { AnalyzerMarket } from '../types/digit-analyzer.types';
import type { PublicMarketDataClient } from './public-market-data-client';
import { normalizeSyntheticMarkets } from '../utils/normalize-symbol';

/**
 * Load currently available Deriv synthetic indices using ONLY the isolated
 * public WebSocket client. No auth, account OTP, trade API or client store.
 *
 * This function owns neither the socket nor its lifecycle: the caller reuses
 * the connected instance for the market's tick subscription in Chunk 3.4,
 * and disposes it on navigation in Chunk 3.5.
 *
 * Chunk 3.2 implements catalog retrieval; wiring this result to the market
 * dropdown is deliberately reserved for Chunk 3.3.
 */
export const fetchSyntheticMarketCatalog = async (
    client: Pick<PublicMarketDataClient, 'connect' | 'request'>
): Promise<AnalyzerMarket[]> => {
    await client.connect();

    // Full metadata preserves market/subgroup and pip_size where provided.
    // Deriv's New API removed several translated display fields; the
    // normalizer supports both New and Legacy names.
    const response = await client.request({ active_symbols: 'full' });

    if (response.msg_type !== undefined && response.msg_type !== 'active_symbols') {
        throw new Error('Unexpected Deriv response while retrieving active symbols');
    }

    return normalizeSyntheticMarkets(response.active_symbols);
};

import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';
import type { PublicMarketDataClient } from './public-market-data-client';
import { normalizeHistoricalTicks } from '../utils/normalize-history';

/**
 * Read-only, one-off historical snapshot. Shares the Analyzer's existing
 * anonymous public WebSocket with the market catalog and live tick stream.
 *
 * It MUST NOT subscribe: no subscribe:1, no watch/listener and no second socket.
 * The caller owns client lifetime and handles market/window changes. Historical
 * + live reconciliation and the rolling analysis window belong to Chunk 4.2.
 */
export const fetchHistoricalTicks = async (
    client: Pick<PublicMarketDataClient, 'request' | 'close'>,
    symbol: string,
    count: AnalyzerSampleSize
): Promise<AnalyzerTick[]> => {
    if (typeof symbol !== 'string' || !/^\w{2,30}$/.test(symbol)) {
        throw new Error('Invalid historical tick symbol');
    }
    if (!ANALYZER_SAMPLE_SIZES.includes(count)) {
        throw new Error('Historical tick count must be 100, 500 or 1000');
    }

    const response = await client.request({
        ticks_history: symbol,
        count,
        end: 'latest',
        style: 'ticks',
        // Omitting subscribe is intentional. A historical snapshot is never
        // allowed to create another market-data subscription.
    });

    if (response.subscription) {
        // Unexpected upstream subscription: terminate this *public* socket so
        // it cannot survive or overlap with the live tick subscription.
        client.close();
        throw new Error('Historical snapshot unexpectedly created a subscription');
    }

    return normalizeHistoricalTicks(response, symbol, count);
};

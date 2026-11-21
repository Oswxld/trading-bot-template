import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';
import type { PublicMarketResponse } from '../services/public-market-data-client';
import { normalizeLiveTick } from './normalize-tick';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A one-time Deriv ticks_history response contains parallel arrays:
 * history.prices[i] is the quote at history.times[i]. The top-level pip_size
 * is the number of fractional digits, NOT the active_symbols pip increment.
 *
 * Preserve API chronology (oldest -> newest) and the exact number of observed
 * ticks. Never pad a partial history with invented ticks or silently drop
 * malformed entries: either return the verified snapshot or reject it.
 *
 * This is pure normalization. No WebSocket, subscriptions, trades or UI.
 */
export const normalizeHistoricalTicks = (
    response: PublicMarketResponse,
    symbol: string,
    requestedCount: AnalyzerSampleSize
): AnalyzerTick[] => {
    if (response.msg_type !== 'history') {
        throw new Error('Unexpected Deriv response: expected tick history');
    }

    if (response.subscription) {
        throw new Error('Historical snapshot unexpectedly created a subscription');
    }

    const echo = isRecord(response.echo_req) ? response.echo_req : null;
    if (echo && (echo.ticks_history !== symbol || echo.style !== 'ticks' ||
        echo.end !== 'latest' || echo.count !== requestedCount || echo.subscribe === 1)) {
        throw new Error('Historical snapshot does not match the requested market and window');
    }

    if (typeof response.pip_size !== 'number' ||
        !Number.isInteger(response.pip_size) ||
        response.pip_size < 0 || response.pip_size > 12) {
        throw new Error('Historical tick precision missing or invalid');
    }

    const history = isRecord(response.history) ? response.history : null;
    if (!history || !Array.isArray(history.prices) || !Array.isArray(history.times)) {
        throw new Error('Invalid Deriv history: missing prices or times array');
    }

    if (history.prices.length !== history.times.length || history.prices.length > requestedCount) {
        throw new Error('Invalid Deriv history: mismatched or excessive tick arrays');
    }

    const result: AnalyzerTick[] = [];
    let previousEpoch = 0;
    for (let index = 0; index < history.prices.length; index += 1) {
        const epoch = history.times[index];
        if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch <= 0 ||
            epoch < previousEpoch) {
            throw new Error('Invalid Deriv history: timestamps are missing or out of order');
        }
        previousEpoch = epoch;

        // Reuse the exact same precision and last-digit rules as streamed ticks.
        const item = normalizeLiveTick({
            msg_type: 'tick',
            tick: {
                symbol,
                epoch,
                pip_size: response.pip_size,
                quote: history.prices[index],
            },
        }, symbol, index + 1);
        if (!item) throw new Error(`Invalid Deriv history: malformed quote at index ${index}`);

        // Avoid collisions with a live tick that has the same symbol and epoch.
        result.push({ ...item, id: `history:${item.id}` });
    }

    return result;
};

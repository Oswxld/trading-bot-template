import type { AnalyzerTick } from '../types/digit-analyzer.types';
import type { PublicMarketResponse } from '../services/public-market-data-client';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Deriv tick.pip_size is the number of fractional digits (unlike the
 * active_symbols pip_size field, which describes a price increment).
 * Preserve trailing zeros when finding the last digit.
 *
 * Do not infer precision from a JavaScript number's string representation:
 * quote 123.45 with pip_size 3 ends in 0, not 5.
 */
export const normalizeLiveTick = (
    response: PublicMarketResponse,
    expectedSymbol: string,
    sequence: number
): AnalyzerTick | null => {
    if (response.msg_type !== 'tick' || !isRecord(response.tick)) return null;
    const tick = response.tick;
    if (tick.symbol !== expectedSymbol) return null;
    if (typeof tick.epoch !== 'number' || !Number.isSafeInteger(tick.epoch) || tick.epoch <= 0) return null;
    if (typeof tick.pip_size !== 'number' || !Number.isInteger(tick.pip_size) ||
        tick.pip_size < 0 || tick.pip_size > 12) return null;

    const numericQuote = typeof tick.quote === 'number'
        ? tick.quote
        : typeof tick.quote === 'string' && /^-?\d+(\.\d+)?$/.test(tick.quote)
            ? Number(tick.quote)
            : NaN;
    if (!Number.isFinite(numericQuote) || !Number.isSafeInteger(sequence) || sequence <= 0) return null;

    const quote = numericQuote.toFixed(tick.pip_size);
    const lastCharacter = quote.charAt(quote.length - 1);
    if (!/^[0-9]$/.test(lastCharacter)) return null;

    return {
        // A tick ID is not guaranteed in Deriv's schema. Sequence prevents a
        // duplicate React key even for identical quotes in the same second.
        id: `${expectedSymbol}:${tick.epoch}:${sequence}`,
        epoch: tick.epoch,
        quote,
        digit: Number(lastCharacter),
    };
};

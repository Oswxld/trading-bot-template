import type { AnalyzerTick } from '../types/digit-analyzer.types';

export const NEXT_DIGIT_MIN_TICKS = 100;
export const NEXT_DIGIT_MIN_TRANSITIONS = 10;

export type NextDigitCandidate = {
    digit: number;
    count: number;
    /** Observed conditional share, NOT a calibrated win probability. */
    observedShare: number;
};

export type NextDigitPrediction = {
    status: 'ready' | 'insufficient-data';
    symbol: string;
    entryDigit: number | null;
    nextDigit: number | null;
    sampleSize: number;
    transitionCount: number;
    candidates: readonly NextDigitCandidate[];
    reason: string;
};

/**
 * Empirical first-order transition frequencies for REAL Deriv observations.
 *
 * Given the newest digit E, inspect historical pairs where E was followed by
 * another digit and rank the actual successors. The source is the analyzer's
 * validated, chronological, single-market rolling tick window, not its pattern
 * scores, a synthetic feed, Math.random, or a generated "confidence".
 *
 * This is descriptive conditional frequency, not a proven next-tick edge:
 * even the top candidate can be no better than chance on fresh observations.
 */
export const calculateNextDigitPrediction = (
    symbol: string,
    ticks: readonly AnalyzerTick[]
): NextDigitPrediction => {
    if (!/^[A-Za-z0-9_]{2,30}$/.test(symbol) || !Array.isArray(ticks)) {
        throw new Error('Invalid next-digit market observations.');
    }

    let lastEpoch = 0;
    const identities = new Set<string>();
    for (const tick of ticks) {
        const livePrefix = `${symbol}:`;
        const historyPrefix = `history:${symbol}:`;
        if (!tick || typeof tick.id !== 'string' ||
            (!tick.id.startsWith(livePrefix) && !tick.id.startsWith(historyPrefix)) ||
            identities.has(tick.id) || !Number.isSafeInteger(tick.epoch) ||
            tick.epoch <= 0 || tick.epoch < lastEpoch ||
            !Number.isInteger(tick.digit) || tick.digit < 0 || tick.digit > 9 ||
            typeof tick.quote !== 'string' ||
            !/^-?\d+(?:\.\d+)?$/.test(tick.quote) ||
            Number(tick.quote.slice(-1)) !== tick.digit) {
            throw new Error('Invalid or cross-market next-digit observation.');
        }
        identities.add(tick.id);
        lastEpoch = tick.epoch;
    }

    const entryDigit = ticks.length ? ticks[ticks.length - 1].digit : null;
    const empty = (reason: string, count = 0): NextDigitPrediction => ({
        status: 'insufficient-data',
        symbol,
        entryDigit,
        nextDigit: null,
        sampleSize: ticks.length,
        transitionCount: count,
        candidates: [],
        reason,
    });

    if (ticks.length < NEXT_DIGIT_MIN_TICKS || entryDigit === null) {
        return empty(`Waiting for at least ${NEXT_DIGIT_MIN_TICKS} genuine Deriv ticks.`);
    }

    const counts = Array.from({ length: 10 }, () => 0);
    let total = 0;
    // Chronological: ticks[i] -> ticks[i+1]. Do not exclude a repeat digit.
    for (let i = 0; i < ticks.length - 1; i += 1) {
        if (ticks[i].digit !== entryDigit) continue;
        counts[ticks[i + 1].digit] += 1;
        total += 1;
    }
    if (total < NEXT_DIGIT_MIN_TRANSITIONS) {
        return empty(
            `Only ${total} transitions were observed after digit ${entryDigit}; at least ${NEXT_DIGIT_MIN_TRANSITIONS} are needed.`,
            total
        );
    }

    const candidates = counts
        .map((count, digit) => ({
            digit,
            count,
            observedShare: 100 * count / total,
        }))
        .sort((left, right) => right.count - left.count || left.digit - right.digit);

    return {
        status: 'ready',
        symbol,
        entryDigit,
        nextDigit: candidates[0].digit,
        sampleSize: ticks.length,
        transitionCount: total,
        candidates,
        reason: 'Most common observed successor of the current digit; not a guaranteed prediction or calibrated win probability.',
    };
};

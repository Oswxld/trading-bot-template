import type { RollingTickSnapshot } from './rolling-tick-window';
import { countRollingDigitFrequencies } from './digit-frequency';
import type { DigitFrequencyCounts, DigitFrequencyResult } from './digit-frequency';

/** A percentage for each last digit, indexed from 0 through 9. */
export type DigitPercentageValues = readonly [
    number, number, number, number, number,
    number, number, number, number, number,
];

export type DigitPercentageDistribution = {
    /** Exact integer counts from the validated 0–9 frequency engine. */
    counts: DigitFrequencyCounts;
    /** Number of actually observed ticks; never the requested capacity. */
    totalTicks: number;
    /** Unrounded observed share of the sample, expressed on a 0–100 scale. */
    percentages: DigitPercentageValues;
    /** False when no ticks exist; a zero percentage alone is not evidence. */
    hasData: boolean;
};

const DIGIT_COUNT = 10;

/**
 * Convert actual observed counts into digit-distribution percentages.
 *
 * This intentionally keeps the raw percentages unrounded; rounding each
 * label independently can produce a displayed total of 99.9% or 100.1%.
 * Never adjust one digit to force a 100.0% total: that would misrepresent its
 * underlying observed frequency. Chart presentation/formatting comes in 5.6.
 *
 * A partial 17-of-500 sample uses 17 as its denominator, not 500. Empty
 * data yields ten zeros and hasData=false, so the UI can show a placeholder.
 */
export const calculateDigitPercentages = (
    frequency: DigitFrequencyResult
): DigitPercentageDistribution => {
    if (!frequency || !Array.isArray(frequency.counts) ||
        frequency.counts.length !== DIGIT_COUNT ||
        !Number.isSafeInteger(frequency.totalTicks) || frequency.totalTicks < 0) {
        throw new Error('Invalid digit frequency distribution');
    }

    let sum = 0;
    for (const count of frequency.counts) {
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error('Invalid digit frequency count');
        }
        sum += count;
    }
    if (!Number.isSafeInteger(sum) || sum !== frequency.totalTicks) {
        throw new Error('Digit frequencies do not match the observed sample total');
    }

    const totalTicks = frequency.totalTicks;
    const percentages = frequency.counts.map(count =>
        totalTicks === 0 ? 0 : (count * 100) / totalTicks
    ) as DigitPercentageValues;

    return {
        counts: [...frequency.counts] as unknown as DigitFrequencyCounts,
        totalTicks,
        percentages,
        hasData: totalTicks > 0,
    };
};

/**
 * Calculate from the already synchronized, bounded rolling window:
 * real history + verified live observations; no network calls or trading.
 */
export const calculateRollingDigitPercentages = (
    snapshot: RollingTickSnapshot
): DigitPercentageDistribution =>
    calculateDigitPercentages(countRollingDigitFrequencies(snapshot));

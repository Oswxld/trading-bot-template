import { countRollingDigitFrequencies } from './digit-frequency';
import type { DigitFrequencyResult } from './digit-frequency';
import { calculateDigitPercentages } from './digit-percentages';
import type { RollingTickSnapshot } from './rolling-tick-window';

export type DigitParityStatistics = {
    /** Observed final digits 0, 2, 4, 6 and 8. Zero is even. */
    even: number;
    /** Observed final digits 1, 3, 5, 7 and 9. */
    odd: number;
    /** Unrounded observed shares, measured from 0 to 100. */
    evenPercentage: number;
    oddPercentage: number;
    /** Actual observations; a partially filled window is not treated as full. */
    totalTicks: number;
    /** No ticks means "no data", not evidence of 0% even or odd outcomes. */
    hasData: boolean;
};

/**
 * Read-only empirical Even / Odd statistics over last digits.
 *
 * Reuse the validated ten-bin frequency distribution from Chunks 5.1/5.2,
 * so malformed/mismatched totals never produce misleading parity results.
 * Do not use theoretical 50/50 odds as a substitute for real observations.
 * The dashboard will consume these values in Chunk 5.6.
 */
export const calculateDigitParity = (
    frequency: DigitFrequencyResult
): DigitParityStatistics => {
    // This validates the ten non-negative integer bins AND their exact total.
    const distribution = calculateDigitPercentages(frequency);
    const { counts, totalTicks, hasData } = distribution;

    const even = counts[0] + counts[2] + counts[4] + counts[6] + counts[8];
    const odd = counts[1] + counts[3] + counts[5] + counts[7] + counts[9];

    return {
        even,
        odd,
        evenPercentage: hasData ? (even * 100) / totalTicks : 0,
        oddPercentage: hasData ? (odd * 100) / totalTicks : 0,
        totalTicks,
        hasData,
    };
};

/** Calculate from the validated, synchronized, bounded rolling sample. */
export const calculateRollingDigitParity = (
    snapshot: RollingTickSnapshot
): DigitParityStatistics =>
    calculateDigitParity(countRollingDigitFrequencies(snapshot));

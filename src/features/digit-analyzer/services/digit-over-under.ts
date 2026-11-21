import type { RollingTickSnapshot } from './rolling-tick-window';
import { countRollingDigitFrequencies } from './digit-frequency';
import type { DigitFrequencyResult } from './digit-frequency';
import { calculateDigitPercentages } from './digit-percentages';

export type DigitOverUnderStatistics = {
    /** Digit (0 through 9) used as the exclusive comparison boundary. */
    threshold: number;
    /** Digits strictly greater than threshold. */
    over: number;
    /** Digits strictly less than threshold. */
    under: number;
    /** Digits exactly equal to threshold, not part of Over or Under. */
    equal: number;
    /** Unrounded percentages from observed ticks, not theoretical odds. */
    overPercentage: number;
    underPercentage: number;
    equalPercentage: number;
    /** Actual observed tick count, not the configured 100/500/1000 capacity. */
    totalTicks: number;
    /** Empty samples must be distinguishable from observed 0% outcomes. */
    hasData: boolean;
};

/**
 * Pure, empirical comparison of the final digit against a selected threshold.
 *
 * "Over 5" means 6, 7, 8, 9; "Under 5" means 0, 1, 2, 3, 4;
 * "Equal to 5" means only 5. These three categories are exclusive and
 * together account for exactly the observed sample.
 *
 * Validate the same ten-bin frequency result used by the other statistics,
 * including exact total/count agreement. This function does not subscribe to
 * markets, produce trading signals or assume a uniform digit distribution.
 */
export const calculateDigitOverUnder = (
    frequency: DigitFrequencyResult,
    threshold: number
): DigitOverUnderStatistics => {
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 9) {
        throw new Error('Over/Under threshold must be an integer from 0 through 9');
    }

    const { counts, totalTicks, hasData } = calculateDigitPercentages(frequency);
    let over = 0;
    let under = 0;

    for (let digit = 0; digit < counts.length; digit += 1) {
        if (digit > threshold) over += counts[digit];
        if (digit < threshold) under += counts[digit];
    }
    const equal = counts[threshold];

    return {
        threshold,
        over,
        under,
        equal,
        overPercentage: hasData ? (over * 100) / totalTicks : 0,
        underPercentage: hasData ? (under * 100) / totalTicks : 0,
        equalPercentage: hasData ? (equal * 100) / totalTicks : 0,
        totalTicks,
        hasData,
    };
};

/** Calculate directly from the bounded, synchronized historical + live sample. */
export const calculateRollingDigitOverUnder = (
    snapshot: RollingTickSnapshot,
    threshold: number
): DigitOverUnderStatistics =>
    calculateDigitOverUnder(countRollingDigitFrequencies(snapshot), threshold);

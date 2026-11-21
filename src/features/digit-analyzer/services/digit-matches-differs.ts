import { countRollingDigitFrequencies } from './digit-frequency';
import type { DigitFrequencyResult } from './digit-frequency';
import { calculateDigitPercentages } from './digit-percentages';
import type { RollingTickSnapshot } from './rolling-tick-window';

/** Observed comparisons of one selected last digit versus every other digit. */
export type DigitMatchesDiffersStatistics = {
    /** User-selected last digit, from 0 through 9. */
    selectedDigit: number;
    /** Observations whose final digit exactly equals selectedDigit. */
    matches: number;
    /** Observations whose final digit is any of the other nine digits. */
    differs: number;
    /** Unrounded observed shares, not predictions or trading probabilities. */
    matchesPercentage: number;
    differsPercentage: number;
    /** Number of actual ticks counted, which may be below the window capacity. */
    totalTicks: number;
    /** False when no observations exist; zero is not an empirical 0% result. */
    hasData: boolean;
};

/**
 * Pure Matches/Differs calculations from verified ten-bin digit frequencies.
 *
 * With selectedDigit=7, Matches counts only 7 and Differs counts 0–6,8,9.
 * Changing the selected digit never requires a WebSocket request or a new
 * historical snapshot. Validate counts and total via the shared percentage
 * service before deriving two mutually exclusive, exhaustive outcomes.
 *
 * UI integration is intentionally deferred to Chunk 5.6.
 */
export const calculateDigitMatchesDiffers = (
    frequency: DigitFrequencyResult,
    selectedDigit: number
): DigitMatchesDiffersStatistics => {
    if (!Number.isInteger(selectedDigit) || selectedDigit < 0 || selectedDigit > 9) {
        throw new Error('Matches/Differs selected digit must be an integer from 0 through 9');
    }

    const { counts, totalTicks, hasData } = calculateDigitPercentages(frequency);
    const matches = counts[selectedDigit];
    const differs = totalTicks - matches;

    return {
        selectedDigit,
        matches,
        differs,
        matchesPercentage: hasData ? (matches * 100) / totalTicks : 0,
        differsPercentage: hasData ? (differs * 100) / totalTicks : 0,
        totalTicks,
        hasData,
    };
};

/** Calculate from the already synchronized, bounded historical + live sample. */
export const calculateRollingDigitMatchesDiffers = (
    snapshot: RollingTickSnapshot,
    selectedDigit: number
): DigitMatchesDiffersStatistics =>
    calculateDigitMatchesDiffers(countRollingDigitFrequencies(snapshot), selectedDigit);

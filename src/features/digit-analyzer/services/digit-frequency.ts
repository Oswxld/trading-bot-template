import type { AnalyzerTick } from '../types/digit-analyzer.types';
import type { RollingTickSnapshot } from './rolling-tick-window';

/** One count for each last digit, indexed directly by digit 0 through 9. */
export type DigitFrequencyCounts = readonly [
    number, number, number, number, number,
    number, number, number, number, number,
];

export type DigitFrequencyResult = {
    /** Exactly ten non-negative integer counts in 0,1,...,9 order. */
    counts: DigitFrequencyCounts;
    /** Number of actual observations counted, not the requested window size. */
    totalTicks: number;
};

const newCounts = (): number[] => Array.from({ length: 10 }, () => 0);

/**
 * Count observed last digits without deriving predictions or percentages.
 *
 * Input is the already validated, de-duplicated rolling window. Do not
 * deduplicate on price or epoch here: distinct genuine ticks can share both.
 * Reject malformed entries instead of biasing the distribution by skipping
 * them. No sockets, timers, trading commands, or simulated observations.
 *
 * Chunk 5.2 will derive percentages from these exact integer counts.
 * Chunk 5.6 will connect the result to the presentational dashboard.
 */
export const countDigitFrequencies = (
    ticks: readonly AnalyzerTick[]
): DigitFrequencyResult => {
    if (!Array.isArray(ticks)) {
        throw new Error('Digit frequency input must be an array of normalized ticks');
    }

    const counts = newCounts();
    for (const tick of ticks) {
        if (!tick || typeof tick.digit !== 'number' ||
            !Number.isInteger(tick.digit) || tick.digit < 0 || tick.digit > 9 ||
            typeof tick.quote !== 'string' ||
            !/^-?\d+(?:\.\d+)?$/.test(tick.quote) ||
            Number(tick.quote.charAt(tick.quote.length - 1)) !== tick.digit) {
            throw new Error('Invalid normalized tick in digit frequency input');
        }

        counts[tick.digit] += 1;
    }

    return { counts: counts as unknown as DigitFrequencyCounts, totalTicks: ticks.length };
};

/**
 * Read only the actually retained rolling observations. The requested
 * capacity may be 100, 500 or 1,000 even if the server returned fewer.
 * Cross-check snapshot metadata to expose corruption rather than
 * accidentally presenting misleading frequencies.
 */
export const countRollingDigitFrequencies = (
    snapshot: RollingTickSnapshot
): DigitFrequencyResult => {
    if (!snapshot || !Array.isArray(snapshot.ticks) ||
        !Number.isSafeInteger(snapshot.count) ||
        snapshot.count !== snapshot.ticks.length ||
        snapshot.count < 0 ||
        snapshot.count > snapshot.windowSize) {
        throw new Error('Invalid rolling tick snapshot for digit frequencies');
    }

    return countDigitFrequencies(snapshot.ticks);
};

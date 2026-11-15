import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import { countDigitFrequencies, countRollingDigitFrequencies } from './digit-frequency';
import { DIGIT_PATTERN_SCORE_MODEL as model } from './digit-pattern-score-model';
import type {
    DigitPatternScore,
    DigitPatternScoreInput,
    DigitPatternScoreResult,
} from './digit-pattern-score-model';
import type { RollingTickSnapshot } from './rolling-tick-window';

/** Clip to a defined finite scale. All denominators are positive for N >= 100. */
const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));

/**
 * A standardized, clipped empirical contrast to the model's reference rate.
 * This is NOT a significance test or a calibrated probability.
 */
const signal = (difference: number, standardDeviation: number): number =>
    clamp(
        difference / standardDeviation / model.standardizedDifferenceCap,
        -1,
        1
    );

/**
 * Verify source, chronology and identity, even before the 100-tick readiness
 * threshold. Never turn malformed or cross-market observations into scores.
 *
 * Equal-second observations with distinct IDs are legitimate. We purposely
 * do not collapse them based on price or timestamp.
 */
const validateInput = ({ symbol, ticks }: DigitPatternScoreInput): void => {
    if (typeof symbol !== 'string' || !/^[A-Za-z0-9_]{2,30}$/.test(symbol) ||
        !Array.isArray(ticks)) {
        throw new Error('Invalid digit pattern score input');
    }

    const ids = new Set<string>();
    let previousEpoch = 0;
    for (const tick of ticks) {
        if (!tick || typeof tick.id !== 'string' ||
            !Number.isSafeInteger(tick.epoch) || tick.epoch <= 0) {
            throw new Error('Invalid normalized tick in digit pattern score input');
        }

        const prefix = tick.id.startsWith('history:') ? `history:${symbol}:` : `${symbol}:`;
        if (!tick.id.startsWith(prefix)) {
            throw new Error('Digit pattern score tick belongs to another market');
        }
        const identity = /^(\d+):(\d+)$/.exec(tick.id.slice(prefix.length));
        if (!identity || Number(identity[1]) !== tick.epoch ||
            !Number.isSafeInteger(Number(identity[2])) || Number(identity[2]) < 1) {
            throw new Error('Invalid digit pattern score tick identity');
        }
        if (tick.epoch < previousEpoch) {
            throw new Error('Digit pattern score ticks are out of chronological order');
        }
        if (ids.has(tick.id)) {
            throw new Error('Duplicate digit pattern score tick identity');
        }
        previousEpoch = tick.epoch;
        ids.add(tick.id);
    }
};

/**
 * Chunk 6.2 — PURE 0–9 digit pattern scoring from verified rolling observations.
 *
 * Full frequency (40%), last R ticks (35%), and recent-minus-earlier trend
 * (25%) are standardized against a 10% reference, clipped at 3 standard
 * deviations, then mapped to a descriptive 0–100 index centered at 50.
 * This does not estimate the probability of a match on the next tick.
 *
 * No winner/highlight selection (6.3), UI wiring (6.4) or prediction claims.
 */
export const calculateDigitPatternScores = (
    input: DigitPatternScoreInput
): DigitPatternScoreResult => {
    if (!input) throw new Error('Invalid digit pattern score input');
    validateInput(input);

    // Reuse the established normalization checks, including the preserved
    // quote precision and matching final digit, for ALL observations.
    const frequency = countDigitFrequencies(input.ticks);
    const observedTicks = frequency.totalTicks;

    if (observedTicks < model.minimumObservations) {
        return {
            status: 'insufficient-data',
            modelVersion: model.version,
            symbol: input.symbol,
            observedTicks,
            minimumRequiredTicks: model.minimumObservations,
            scores: [],
        };
    }

    const recentTicks = Math.min(
        model.recentWindowCap,
        Math.floor(observedTicks / model.recentWindowDivisor)
    );
    const earlierTicks = observedTicks - recentTicks;
    // Earlier and recent windows are disjoint, with both nonempty for N>=100.
    const earlier = countDigitFrequencies(input.ticks.slice(0, earlierTicks));
    const recent = countDigitFrequencies(input.ticks.slice(earlierTicks));

    const p0 = model.uniformReferenceRate;
    const variance = p0 * (1 - p0);
    const fullSd = Math.sqrt(variance / observedTicks);
    const recentSd = Math.sqrt(variance / recentTicks);
    const trendSd = Math.sqrt(variance * (1 / recentTicks + 1 / earlierTicks));

    const scores: DigitPatternScore[] = Array.from({ length: 10 }, (_, digit) => {
        const fullCount = frequency.counts[digit];
        const recentCount = recent.counts[digit];
        const earlierCount = earlier.counts[digit];

        const fullFrequencyComponent = signal(
            fullCount / observedTicks - p0,
            fullSd
        );
        const recentFrequencyComponent = signal(
            recentCount / recentTicks - p0,
            recentSd
        );
        const trendComponent = signal(
            recentCount / recentTicks - earlierCount / earlierTicks,
            trendSd
        );

        const rawScore = model.neutralScore + 50 * (
            model.weights.fullFrequency * fullFrequencyComponent +
            model.weights.recentFrequency * recentFrequencyComponent +
            model.weights.trend * trendComponent
        );

        return {
            digit,
            score: clamp(rawScore, model.minimumScore, model.maximumScore),
            fullFrequencyComponent,
            recentFrequencyComponent,
            trendComponent,
            fullCount,
            recentCount,
            earlierCount,
        };
    });

    return {
        status: 'ready',
        modelVersion: model.version,
        symbol: input.symbol,
        observedTicks,
        recentTicks,
        earlierTicks,
        scores,
    };
};

/**
 * Consume the real, bounded, synchronized rolling window. Cross-check all
 * snapshot metadata rather than silently accepting mismatched sample counts.
 */
export const calculateRollingDigitPatternScores = (
    snapshot: RollingTickSnapshot
): DigitPatternScoreResult => {
    if (!snapshot || !ANALYZER_SAMPLE_SIZES.includes(snapshot.windowSize) ||
        !Array.isArray(snapshot.ticks) ||
        !Number.isSafeInteger(snapshot.count) ||
        snapshot.remaining !== snapshot.windowSize - snapshot.count ||
        snapshot.isFull !== (snapshot.count === snapshot.windowSize) ||
        (snapshot.count === 0
            ? snapshot.latestTick !== null
            : !snapshot.latestTick ||
              snapshot.latestTick.id !== snapshot.ticks[snapshot.count - 1]?.id ||
              snapshot.latestTick.quote !== snapshot.ticks[snapshot.count - 1]?.quote ||
              snapshot.latestTick.epoch !== snapshot.ticks[snapshot.count - 1]?.epoch ||
              snapshot.latestTick.digit !== snapshot.ticks[snapshot.count - 1]?.digit)) {
        throw new Error('Invalid rolling tick snapshot for digit pattern scores');
    }
    // Existing frequency wrapper validates count === ticks.length, bounds and
    // every preserved formatted quote/last digit.
    countRollingDigitFrequencies(snapshot);
    return calculateDigitPatternScores({ symbol: snapshot.symbol, ticks: snapshot.ticks });
};

import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';
import { countDigitFrequencies } from './digit-frequency';
import { calculateDigitPatternScores } from './digit-pattern-score';
import { detectDigitPatternLeaders } from './digit-pattern-leaders';
import { DIGIT_PATTERN_SCORE_MODEL as model } from './digit-pattern-score-model';

/** Strictly after the training sample. A tie earns 1/k for a correct digit. */
export type DigitPatternHoldout = {
    /** Chronological zero-based position of a tick NEVER used to pick leaders. */
    observedIndex: number;
    observedEpoch: number;
    actualDigit: number;
    modelLeaders: readonly number[];
    frequencyLeaders: readonly number[];
    modelCredit: number;
    frequencyCredit: number;
};

export type DigitPatternBacktestMethod = {
    /** Sum of tie-adjusted 0..1 credits; compare this, not inflated set-hit rates. */
    creditedHits: number;
    /** Tie-adjusted credits divided by evaluated holdouts (0..1). */
    creditedHitRate: number;
    /** Number of evaluated holdouts with exactly one leader. */
    uniquePicks: number;
    /** Successful unique picks, out of uniquePicks (NOT all held-out ticks). */
    uniqueHits: number;
    /** Null when every pick tied. */
    uniqueHitRate: number | null;
    /** Number of evaluated holdouts with two or more joint leaders. */
    tiedPicks: number;
};

export type DigitPatternWalkForwardResult =
    | {
        status: 'insufficient-holdout';
        symbol: string;
        windowSize: AnalyzerSampleSize;
        totalTicks: number;
        minimumRequiredTicks: number;
        modelVersion: typeof model.version;
        evaluatedTicks: 0;
        /** No fabricated 0% success when no unseen next tick exists. */
        model: null;
        frequencyBaseline: null;
        holdouts: readonly [];
      }
    | {
        status: 'evaluated';
        symbol: string;
        windowSize: AnalyzerSampleSize;
        totalTicks: number;
        minimumRequiredTicks: number;
        modelVersion: typeof model.version;
        evaluatedTicks: number;
        /** 10% is an equal-digit REFERENCE, not a market guarantee. */
        uniformReferenceRate: number;
        model: DigitPatternBacktestMethod;
        frequencyBaseline: DigitPatternBacktestMethod;
        /** Model minus baseline in percentage points, not proof of significance. */
        modelVsBaselinePercentagePoints: number;
        /** Evaluation trace for auditing exactly which next ticks were held out. */
        holdouts: readonly DigitPatternHoldout[];
      };

type MethodAccumulator = {
    creditedHits: number;
    uniquePicks: number;
    uniqueHits: number;
    tiedPicks: number;
};

const newAccumulator = (): MethodAccumulator =>
    ({ creditedHits: 0, uniquePicks: 0, uniqueHits: 0, tiedPicks: 0 });

const credit = (leaders: readonly number[], actualDigit: number): number =>
    leaders.includes(actualDigit) ? 1 / leaders.length : 0;

const recordOutcome = (
    tally: MethodAccumulator,
    leaders: readonly number[],
    actualDigit: number
): number => {
    const earned = credit(leaders, actualDigit);
    tally.creditedHits += earned;
    if (leaders.length === 1) {
        tally.uniquePicks += 1;
        if (earned === 1) tally.uniqueHits += 1;
    } else {
        tally.tiedPicks += 1;
    }
    return earned;
};

const summarize = (tally: MethodAccumulator, tested: number): DigitPatternBacktestMethod => ({
    ...tally,
    creditedHitRate: tally.creditedHits / tested,
    uniqueHitRate: tally.uniquePicks > 0 ? tally.uniqueHits / tally.uniquePicks : null,
});

/** Reuse digit/quote validation, then guard source and chronology for the entire dataset. */
const validateHistory = (symbol: string, ticks: readonly AnalyzerTick[]): void => {
    if (typeof symbol !== 'string' || !/^[A-Za-z0-9_]{2,30}$/.test(symbol) ||
        !Array.isArray(ticks)) {
        throw new Error('Invalid pattern walk-forward market input');
    }
    countDigitFrequencies(ticks);
    const seen = new Set<string>();
    let previousEpoch = 0;
    for (const item of ticks) {
        if (!Number.isSafeInteger(item.epoch) || item.epoch <= 0 ||
            typeof item.id !== 'string') {
            throw new Error('Invalid pattern walk-forward tick');
        }
        const prefix = item.id.startsWith('history:') ? `history:${symbol}:` : `${symbol}:`;
        const identity = item.id.startsWith(prefix) ?
            /^(\d+):(\d+)$/.exec(item.id.slice(prefix.length)) : null;
        if (!identity || Number(identity[1]) !== item.epoch ||
            !Number.isSafeInteger(Number(identity[2])) || Number(identity[2]) < 1) {
            throw new Error('Wrong market or malformed pattern walk-forward tick identity');
        }
        if (item.epoch < previousEpoch || seen.has(item.id)) {
            throw new Error('Pattern walk-forward ticks must be ordered and unique');
        }
        previousEpoch = item.epoch;
        seen.add(item.id);
    }
};

/**
 * Chunk 6.5: chronological, leakage-free NEXT-TICK evaluation of a FIXED
 * window. The score and frequency-only baseline see IDENTICAL past ticks.
 *
 * At time i: sample = ticks[i-windowSize .. i-1], target = ticks[i].
 * No sample includes the held-out tick. No data is shuffled or backfilled.
 * The first full window is only scored at i === windowSize (thus 1,000
 * observations cannot evaluate a 1,000-tick model even once).
 *
 * Joint leads: a correct member of k joint leaders earns 1/k, preserving a
 * 10% uniform-reference expectation for any fixed leader set. An unadjusted
 * "hit any of ten leaders" could misleadingly claim 100% accuracy.
 *
 * Exploratory descriptive backtest ONLY. Repeated overlapping windows are
 * dependent observations. Do not interpret the rate as a calibrated
 * probability, confidence interval, trade signal or proven out-of-sample edge.
 */
export const evaluateDigitPatternWalkForward = (
    symbol: string,
    ticks: readonly AnalyzerTick[],
    windowSize: AnalyzerSampleSize
): DigitPatternWalkForwardResult => {
    if (!ANALYZER_SAMPLE_SIZES.includes(windowSize)) {
        throw new Error('Walk-forward sample size must be 100, 500 or 1000');
    }
    validateHistory(symbol, ticks);
    const totalTicks = ticks.length;
    const required = windowSize + 1;

    if (totalTicks < required) {
        return {
            status: 'insufficient-holdout',
            symbol, windowSize, totalTicks,
            minimumRequiredTicks: required,
            modelVersion: model.version,
            evaluatedTicks: 0, model: null, frequencyBaseline: null, holdouts: [],
        };
    }

    const tally = newAccumulator();
    const baselineTally = newAccumulator();
    const holdouts: DigitPatternHoldout[] = [];

    for (let index = windowSize; index < totalTicks; index += 1) {
        const past = ticks.slice(index - windowSize, index);
        const observed = ticks[index];
        const scores = calculateDigitPatternScores({ symbol, ticks: past });
        const leaders = detectDigitPatternLeaders(scores);
        if (leaders.status !== 'ready') {
            throw new Error('Expected full window to produce ready pattern scores');
        }

        // Simple fair comparison: choose all digits tied for the maximum
        // empirical frequency over exactly the same full past sample.
        const histogram = countDigitFrequencies(past).counts;
        const largest = Math.max(...histogram);
        const frequencyLeaders = histogram.flatMap((count, digit) =>
            count === largest ? [digit] : []
        );

        const modelCredit = recordOutcome(tally, leaders.leaderDigits, observed.digit);
        const frequencyCredit = recordOutcome(
            baselineTally, frequencyLeaders, observed.digit
        );
        holdouts.push({
            observedIndex: index,
            observedEpoch: observed.epoch,
            actualDigit: observed.digit,
            modelLeaders: [...leaders.leaderDigits],
            frequencyLeaders,
            modelCredit,
            frequencyCredit,
        });
    }

    const evaluatedTicks = holdouts.length;
    const modelResult = summarize(tally, evaluatedTicks);
    const baselineResult = summarize(baselineTally, evaluatedTicks);
    return {
        status: 'evaluated',
        symbol, windowSize, totalTicks,
        minimumRequiredTicks: required, modelVersion: model.version,
        evaluatedTicks, uniformReferenceRate: model.uniformReferenceRate,
        model: modelResult,
        frequencyBaseline: baselineResult,
        modelVsBaselinePercentagePoints:
            (modelResult.creditedHitRate - baselineResult.creditedHitRate) * 100,
        holdouts,
    };
};

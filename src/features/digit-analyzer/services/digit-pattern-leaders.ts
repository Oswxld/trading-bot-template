import { DIGIT_PATTERN_SCORE_MODEL as model } from './digit-pattern-score-model';
import type { DigitPatternScoreResult } from './digit-pattern-score-model';
import { calculateRollingDigitPatternScores } from './digit-pattern-score';
import type { RollingTickSnapshot } from './rolling-tick-window';

/**
 * Maximum tolerated difference between unrounded scores for a joint lead.
 * Only sub-nanopoint numerical noise counts as a tie; displayed rounding
 * (for example 72.4 versus 72.4) must NOT manufacture one.
 */
export const DIGIT_PATTERN_LEADER_TOLERANCE = 1e-9;

export type DigitPatternLeaderResult =
    | {
        status: 'insufficient-data';
        symbol: string;
        modelVersion: typeof model.version;
        observedTicks: number;
        highestScore: null;
        leaderDigits: readonly [];
        isTie: false;
      }
    | {
        status: 'ready';
        symbol: string;
        modelVersion: typeof model.version;
        observedTicks: number;
        /** The true, unrounded maximum; not a next-tick probability. */
        highestScore: number;
        /** All digits within 1e-9 of the maximum, ascending (0–9) order. */
        leaderDigits: readonly number[];
        isTie: boolean;
      };

const isValidSymbol = (symbol: unknown): symbol is string =>
    typeof symbol === 'string' && /^[A-Za-z0-9_]{2,30}$/.test(symbol);

const isCount = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Validate external/malformed score objects rather than highlighting a
 * corrupt digit. Valid scores are expected to come from the 6.2 engine.
 */
const validateScoreResult = (result: DigitPatternScoreResult): void => {
    if (!result || !isValidSymbol(result.symbol) ||
        result.modelVersion !== model.version || !isCount(result.observedTicks) ||
        (result.status !== 'ready' && result.status !== 'insufficient-data') ||
        !Array.isArray(result.scores)) {
        throw new Error('Invalid digit pattern score result for leader detection');
    }

    if (result.status === 'insufficient-data') {
        if (result.observedTicks >= model.minimumObservations ||
            result.minimumRequiredTicks !== model.minimumObservations ||
            result.scores.length !== 0) {
            throw new Error('Invalid insufficient-data pattern score result');
        }
        return;
    }

    const expectedRecent = Math.min(
        model.recentWindowCap,
        Math.floor(result.observedTicks / model.recentWindowDivisor)
    );
    if (result.observedTicks < model.minimumObservations ||
        result.recentTicks !== expectedRecent ||
        result.earlierTicks !== result.observedTicks - expectedRecent ||
        result.scores.length !== 10) {
        throw new Error('Invalid complete pattern score result');
    }

    let fullSum = 0;
    let recentSum = 0;
    let earlierSum = 0;
    for (let digit = 0; digit < 10; digit += 1) {
        const item = result.scores[digit];
        if (!item || item.digit !== digit ||
            !Number.isFinite(item.score) ||
            item.score < model.minimumScore || item.score > model.maximumScore ||
            !isCount(item.fullCount) || !isCount(item.recentCount) ||
            !isCount(item.earlierCount) ||
            item.fullCount !== item.recentCount + item.earlierCount ||
            ![item.fullFrequencyComponent, item.recentFrequencyComponent, item.trendComponent]
                .every(component => Number.isFinite(component) &&
                    component >= -1 && component <= 1)) {
            throw new Error('Invalid digit pattern score entry for leader detection');
        }
        fullSum += item.fullCount;
        recentSum += item.recentCount;
        earlierSum += item.earlierCount;
    }
    if (fullSum !== result.observedTicks ||
        recentSum !== result.recentTicks ||
        earlierSum !== result.earlierTicks) {
        throw new Error('Pattern score counts do not match the observed sample');
    }
};

/**
 * Chunk 6.3 — select the highest observed-pattern index WITHOUT rounding.
 *
 * A near-exact tie produces MULTIPLE leaders; no arbitrary first winner,
 * randomness, next-digit forecast, or trading action. Display and green
 * highlighting are deliberately deferred to Chunk 6.4.
 */
export const detectDigitPatternLeaders = (
    result: DigitPatternScoreResult
): DigitPatternLeaderResult => {
    validateScoreResult(result);

    if (result.status === 'insufficient-data') {
        return {
            status: 'insufficient-data',
            symbol: result.symbol,
            modelVersion: result.modelVersion,
            observedTicks: result.observedTicks,
            highestScore: null,
            leaderDigits: [],
            isTie: false,
        };
    }

    const highestScore = Math.max(...result.scores.map(item => item.score));
    const leaderDigits = result.scores
        .filter(item => highestScore - item.score <= DIGIT_PATTERN_LEADER_TOLERANCE)
        .map(item => item.digit);

    return {
        status: 'ready',
        symbol: result.symbol,
        modelVersion: result.modelVersion,
        observedTicks: result.observedTicks,
        highestScore,
        leaderDigits,
        isTie: leaderDigits.length > 1,
    };
};

/** All calculations use the current single-market, bounded rolling sample. */
export const detectRollingDigitPatternLeaders = (
    snapshot: RollingTickSnapshot
): DigitPatternLeaderResult =>
    detectDigitPatternLeaders(calculateRollingDigitPatternScores(snapshot));

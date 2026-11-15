import type { AnalyzerTick } from '../types/digit-analyzer.types';

/**
 * Chunk 6.1 — versioned scoring design consumed by the 6.2 engine.
 *
 * These values are heuristic design choices that MUST be calibrated with
 * forward-only tests before anyone treats the ranking as predictive.
 * "Pattern score" is deliberately not a next-tick match probability.
 */
export const DIGIT_PATTERN_SCORE_MODEL = Object.freeze({
    version: '1.0.0',
    displayLabel: 'Digit pattern score',
    scoreInterpretation: 'relative historical pattern strength (NOT probability)',
    /** Each final digit has a 1-in-10 uniform-reference share. */
    uniformReferenceRate: 0.1,
    /** No leader or 0–100 score is displayed with fewer actual observations. */
    minimumObservations: 100,
    /** Compare at most the last 100 observed ticks to the earlier retained ticks. */
    recentWindowCap: 100,
    /** At small eligible samples, reserve half for the earlier comparison. */
    recentWindowDivisor: 2,
    /** Standardized differences saturate at +/-3 for display stability. */
    standardizedDifferenceCap: 3,
    /** A perfectly balanced reference corresponds to the neutral midpoint. */
    neutralScore: 50,
    minimumScore: 0,
    maximumScore: 100,
    weights: Object.freeze({
        /** Overall digit frequency relative to the uniform reference. */
        fullFrequency: 0.4,
        /** Recent digit frequency relative to the same reference. */
        recentFrequency: 0.35,
        /** Recent-minus-earlier digit-frequency shift. */
        trend: 0.25,
    }),
} as const);

export type DigitPatternScoreModel = typeof DIGIT_PATTERN_SCORE_MODEL;

/** Each digit's empirical signal components, before UI rounding. */
export type DigitPatternScore = {
    digit: number;
    score: number;
    fullFrequencyComponent: number;
    recentFrequencyComponent: number;
    trendComponent: number;
    fullCount: number;
    recentCount: number;
    earlierCount: number;
};

/**
 * A complete model input is one validated, oldest-to-newest rolling sample,
 * supplied by the existing history/live synchronization pipeline.
 */
export type DigitPatternScoreInput = {
    symbol: string;
    ticks: readonly AnalyzerTick[];
};

/**
 * The 6.2 engine implements this discriminated contract.
 * No invented score of 0 or 50 when data is insufficient.
 */
export type DigitPatternScoreResult =
    | {
        status: 'insufficient-data';
        modelVersion: DigitPatternScoreModel['version'];
        symbol: string;
        observedTicks: number;
        minimumRequiredTicks: number;
        scores: readonly [];
      }
    | {
        status: 'ready';
        modelVersion: DigitPatternScoreModel['version'];
        symbol: string;
        observedTicks: number;
        recentTicks: number;
        earlierTicks: number;
        /** Exactly ten entries, ordered by digit from 0 through 9. */
        scores: readonly DigitPatternScore[];
      };

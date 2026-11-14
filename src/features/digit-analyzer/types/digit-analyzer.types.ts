/**
 * Read-only Digit Analyzer types. All data supplied to presentational components
 * must originate from the dedicated analyzer feed (added in later chunks).
 */
export type DigitAnalyzerConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'error';

export const ANALYZER_SAMPLE_SIZES = [100, 500, 1000] as const;
export type AnalyzerSampleSize = (typeof ANALYZER_SAMPLE_SIZES)[number];

export type AnalyzerMarket = {
    symbol: string;
    displayName: string;
    pipSize?: number;
    isOpen?: boolean;
};

/** Formatted quote is preserved so its intended decimal precision is visible. */
export type AnalyzerTick = {
    id: string;
    epoch: number;
    quote: string;
    digit: number;
};

/** Derived counts; data processing and calculation are introduced in Chunk 5. */
export type DigitOutcomeCounts = {
    even: number;
    odd: number;
    over: number;
    under: number;
    equal: number;
    matches: number;
    differs: number;
};

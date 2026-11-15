/**
 * Read-only Digit Analyzer types. All data supplied to presentational components
 * must originate from the dedicated analyzer feed (added in later chunks).
 */
export type DigitAnalyzerConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'error';

export const ANALYZER_SAMPLE_SIZES = [100, 500, 1000] as const;
export type AnalyzerSampleSize = (typeof ANALYZER_SAMPLE_SIZES)[number];

export type AnalyzerMarket = {
    /** Deriv underlying identifier used for all future tick subscriptions. */
    symbol: string;
    displayName: string;
    /**
     * Minimum price increment from active_symbols (e.g. 0.01).
     * This is NOT the number of decimal places in tick.pip_size.
     */
    pipSize?: number;
    subgroup?: string;
    submarket?: string;
    /**
     * true: explicitly open and not suspended;
     * false: explicitly closed/suspended;
     * undefined: API omitted enough status metadata to know.
     */
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

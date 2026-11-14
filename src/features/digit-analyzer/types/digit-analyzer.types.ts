/**
 * Connection states owned exclusively by the read-only Digit Analyzer.
 * This is intentionally separate from Bot Builder and account-auth state.
 */
export type DigitAnalyzerConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'error';

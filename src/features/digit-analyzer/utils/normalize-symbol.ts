import type { AnalyzerMarket } from '../types/digit-analyzer.types';

/**
 * New Options API: underlying_symbol / underlying_symbol_name / pip_size.
 * Legacy API: symbol / display_name / pip.
 *
 * Filter by market metadata, NEVER by hard-coded R_ / 1HZ symbol prefixes:
 * the available Synthetic Index families may change over time.
 */
const SYNTHETIC_MARKET_IDS = new Set(['synthetic_index', 'synthetic_indices', 'synthetics']);
const SYNTHETIC_SUBGROUP_IDS = new Set(['synthetics', 'synthetic_indices', 'synthetic_index']);
const DERIV_SYMBOL_ID = /^[A-Za-z0-9_]+$/;

const recordOf = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

const stringValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizedId = (value: unknown): string | undefined => stringValue(value)?.toLowerCase();

const positiveIncrement = (value: unknown): number | undefined => {
    // An active-symbol pip is a price increment such as 0.01, not a digit count.
    // Do not convert strings or infer decimal places here: tick normalization
    // will use instrument metadata and the actual tick payload later.
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;
};

const availabilityFlag = (value: unknown): boolean | undefined => {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    return undefined;
};

const isSynthetic = (entry: Record<string, unknown>): boolean => {
    const market = normalizedId(entry.market);
    if (market) return SYNTHETIC_MARKET_IDS.has(market);
    return SYNTHETIC_SUBGROUP_IDS.has(normalizedId(entry.subgroup) ?? '');
};

/** Convert one supported Deriv symbol to a stable read-only market descriptor. */
export const normalizeSyntheticSymbol = (value: unknown): AnalyzerMarket | null => {
    const entry = recordOf(value);
    if (!entry || !isSynthetic(entry)) return null;

    const symbol = stringValue(entry.underlying_symbol) ?? stringValue(entry.symbol);
    if (!symbol || !DERIV_SYMBOL_ID.test(symbol)) return null;

    const exchangeOpen = availabilityFlag(entry.exchange_is_open);
    const suspended = availabilityFlag(entry.is_trading_suspended);
    const isOpen = exchangeOpen === false || suspended === true
        ? false
        : exchangeOpen === true && suspended === false
            ? true
            : undefined;

    // Favor the new response shape, fall back to legacy only where necessary.
    const pipSize = positiveIncrement(entry.pip_size) ?? positiveIncrement(entry.pip);
    const subgroup = stringValue(entry.subgroup);
    const submarket = stringValue(entry.submarket);

    return {
        symbol,
        displayName: stringValue(entry.underlying_symbol_name) ??
            stringValue(entry.display_name) ??
            symbol,
        ...(pipSize !== undefined ? { pipSize } : {}),
        ...(subgroup !== undefined ? { subgroup } : {}),
        ...(submarket !== undefined ? { submarket } : {}),
        ...(isOpen !== undefined ? { isOpen } : {}),
    };
};

/**
 * Active Symbols returns the whole catalog in one response.
 * A malformed payload is an error, not an empty (and misleading) market list.
 */
export const normalizeSyntheticMarkets = (symbols: unknown): AnalyzerMarket[] => {
    if (!Array.isArray(symbols)) {
        throw new Error('Invalid Deriv active_symbols response: expected a list of markets');
    }

    const bySymbol = new Map<string, AnalyzerMarket>();
    for (const value of symbols) {
        const market = normalizeSyntheticSymbol(value);
        if (!market || bySymbol.has(market.symbol)) continue;
        bySymbol.set(market.symbol, market);
    }

    // Present available instruments first, then human-friendly numerical order.
    // Unknown status is not treated as explicitly closed.
    return [...bySymbol.values()].sort((left, right) =>
        Number(left.isOpen === false) - Number(right.isOpen === false) ||
        left.displayName.localeCompare(right.displayName, 'en', { numeric: true, sensitivity: 'base' }) ||
        left.symbol.localeCompare(right.symbol, 'en')
    );
};

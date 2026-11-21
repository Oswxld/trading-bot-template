import { normalizeSyntheticMarkets, normalizeSyntheticSymbol } from '../utils/normalize-symbol';

const newMarket = (changes: Record<string, unknown> = {}) => ({
    underlying_symbol: 'R_75',
    underlying_symbol_name: 'Volatility 75 Index',
    underlying_symbol_type: 'stockindex',
    market: 'synthetic_index',
    subgroup: 'synthetics',
    submarket: 'random_index',
    pip_size: 0.001,
    exchange_is_open: 1,
    is_trading_suspended: 0,
    ...changes,
});

describe('Digit Analyzer: normalize Deriv synthetic market metadata', () => {
    it('parses current Options API fields without changing pip increments', () => {
        expect(normalizeSyntheticSymbol(newMarket())).toEqual({
            symbol: 'R_75',
            displayName: 'Volatility 75 Index',
            pipSize: 0.001,
            subgroup: 'synthetics',
            submarket: 'random_index',
            isOpen: true,
        });
    });

    it('accepts legacy symbol, display_name, and pip fields', () => {
        const old = normalizeSyntheticSymbol({
            symbol: '1HZ100V',
            display_name: 'Volatility 100 (1s) Index',
            pip: 0.01,
            market: 'synthetic_index',
            subgroup: 'synthetics',
            submarket: 'random_index',
            exchange_is_open: 1,
            is_trading_suspended: 0,
        });
        expect(old).toEqual({
            symbol: '1HZ100V',
            displayName: 'Volatility 100 (1s) Index',
            pipSize: 0.01,
            subgroup: 'synthetics',
            submarket: 'random_index',
            isOpen: true,
        });
    });

    it('prefers current fields when both API formats are present', () => {
        const market = normalizeSyntheticSymbol(newMarket({
            symbol: 'R_10',
            display_name: 'Old label',
            pip: 0.5,
        }));
        expect(market?.symbol).toBe('R_75');
        expect(market?.displayName).toBe('Volatility 75 Index');
        expect(market?.pipSize).toBe(0.001);
    });

    it('includes synthetic categories outside Volatility such as Step, Boom, Crash, and Jump', () => {
        const markets = normalizeSyntheticMarkets([
            newMarket({ underlying_symbol: 'R_25', underlying_symbol_name: 'Volatility 25 Index' }),
            newMarket({ underlying_symbol: 'STPRNG', underlying_symbol_name: 'Step Index', submarket: 'step_index' }),
            newMarket({ underlying_symbol: 'BOOM500', underlying_symbol_name: 'Boom 500 Index', submarket: 'crash_boom' }),
            newMarket({ underlying_symbol: 'CRASH1000', underlying_symbol_name: 'Crash 1000 Index', submarket: 'crash_boom' }),
            newMarket({ underlying_symbol: 'JD10', underlying_symbol_name: 'Jump 10 Index', submarket: 'jump_index' }),
        ]);
        expect(markets.map(m => m.symbol)).toEqual(['BOOM500', 'CRASH1000', 'JD10', 'STPRNG', 'R_25']);
    });

    it('does not accidentally include forex, commodities or ordinary stock indices', () => {
        const markets = normalizeSyntheticMarkets([
            newMarket({ underlying_symbol: 'frxEURUSD', underlying_symbol_name: 'EUR/USD', market: 'forex', subgroup: 'major_pairs' }),
            newMarket({ underlying_symbol: 'WLDAUD', underlying_symbol_name: 'Australian stock', market: 'indices', subgroup: 'indices' }),
            newMarket({ underlying_symbol: 'R_50', underlying_symbol_name: 'Volatility 50 Index' }),
        ]);
        expect(markets.map(m => m.symbol)).toEqual(['R_50']);
    });

    it('keeps closed and suspended markets visible but marks them unavailable', () => {
        expect(normalizeSyntheticSymbol(newMarket({ exchange_is_open: 0 }))?.isOpen).toBe(false);
        expect(normalizeSyntheticSymbol(newMarket({ is_trading_suspended: 1 }))?.isOpen).toBe(false);
        expect(normalizeSyntheticSymbol(newMarket({ exchange_is_open: true, is_trading_suspended: false }))?.isOpen).toBe(true);
        const markets = normalizeSyntheticMarkets([
            newMarket({ underlying_symbol: 'R_10', underlying_symbol_name: 'A closed market', exchange_is_open: 0 }),
            newMarket({ underlying_symbol: 'R_25', underlying_symbol_name: 'Z open market' }),
        ]);
        expect(markets.map(m => m.symbol)).toEqual(['R_25', 'R_10']);
    });

    it('does not pretend market hours are known if the API omitted status flags', () => {
        const data = newMarket();
        const { exchange_is_open: _exchangeIsOpen, is_trading_suspended: _suspended, ...withoutStatus } = data;
        const normalized = normalizeSyntheticSymbol(withoutStatus);
        expect(normalized?.isOpen).toBeUndefined();
        expect(normalized?.symbol).toBe('R_75');
    });

    it('falls back to the symbol ID if a display label is not provided', () => {
        const { underlying_symbol_name: _name, ...withoutName } = newMarket();
        expect(normalizeSyntheticSymbol(withoutName)?.displayName).toBe('R_75');
    });

    it('rejects unsafe identifiers and malformed market entries', () => {
        expect(normalizeSyntheticSymbol(null)).toBeNull();
        expect(normalizeSyntheticSymbol([])).toBeNull();
        expect(normalizeSyntheticSymbol('R_75')).toBeNull();
        expect(normalizeSyntheticSymbol(newMarket({ underlying_symbol: 'R 75' }))).toBeNull();
        expect(normalizeSyntheticSymbol(newMarket({ underlying_symbol: '' }))).toBeNull();
    });

    it('handles missing market only if the subgroup explicitly indicates synthetics', () => {
        const { market: _market, ...noMarket } = newMarket();
        expect(normalizeSyntheticSymbol(noMarket)?.symbol).toBe('R_75');
        expect(normalizeSyntheticSymbol({ underlying_symbol: 'R_75', display_name: 'Volatility 75 Index' })).toBeNull();
    });

    it('does not allow untrusted pip metadata to become an invalid precision', () => {
        expect(normalizeSyntheticSymbol(newMarket({ pip_size: 0 }))?.pipSize).toBeUndefined();
        expect(normalizeSyntheticSymbol(newMarket({ pip_size: '0.01' }))?.pipSize).toBeUndefined();
        expect(normalizeSyntheticSymbol(newMarket({ pip_size: Infinity, pip: 0.01 }))?.pipSize).toBe(0.01);
    });

    it('deduplicates symbols and sorts numeric display names naturally', () => {
        const markets = normalizeSyntheticMarkets([
            newMarket({ underlying_symbol: 'R_100', underlying_symbol_name: 'Volatility 100 Index' }),
            newMarket({ underlying_symbol: 'R_10', underlying_symbol_name: 'Volatility 10 Index' }),
            newMarket({ underlying_symbol: 'R_10', underlying_symbol_name: 'Volatility 10 Index' }),
        ]);
        expect(markets.map(m => m.displayName)).toEqual(['Volatility 10 Index', 'Volatility 100 Index']);
    });

    it('does not mutate the original API response array', () => {
        const entries = [newMarket({ underlying_symbol: 'R_100' }), newMarket({ underlying_symbol: 'R_10' })];
        const before = JSON.stringify(entries);
        normalizeSyntheticMarkets(entries);
        expect(JSON.stringify(entries)).toBe(before);
    });

    it('accepts a genuinely empty list but rejects malformed catalog responses', () => {
        expect(normalizeSyntheticMarkets([])).toEqual([]);
        expect(() => normalizeSyntheticMarkets(null)).toThrow('Invalid Deriv active_symbols response');
        expect(() => normalizeSyntheticMarkets({ active_symbols: [] })).toThrow('Invalid Deriv active_symbols response');
    });
});

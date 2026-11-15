import type { AnalyzerMarket } from '../types/digit-analyzer.types';

type MarketSelectorProps = {
    markets: readonly AnalyzerMarket[];
    selectedSymbol: string;
    onSelect: (symbol: string) => void;
    isLoading?: boolean;
    hasError?: boolean;
};

/**
 * The available markets come exclusively from Deriv's public active_symbols.
 * Display a truthful placeholder until the catalog has finished loading.
 */
const MarketSelector = ({
    markets,
    selectedSymbol,
    onSelect,
    isLoading = false,
    hasError = false,
}: MarketSelectorProps) => {
    const selectable = markets.filter(market => market.isOpen !== false);
    const selectedIsAvailable = selectable.some(market => market.symbol === selectedSymbol);
    const disabled = isLoading || hasError || selectable.length === 0;

    return (
        <label className='digit-analyzer__field digit-analyzer__field--market'>
            <span className='digit-analyzer__field-label'>Market</span>
            <select
                aria-label='Market'
                value={disabled || !selectedIsAvailable ? '' : selectedSymbol}
                onChange={event => {
                    if (!disabled && selectable.some(market => market.symbol === event.target.value)) {
                        onSelect(event.target.value);
                    }
                }}
                disabled={disabled}
                aria-busy={isLoading}
            >
                {disabled ? (
                    <option value=''>
                        {isLoading
                            ? 'Loading Deriv markets...'
                            : hasError
                                ? 'Unable to load markets'
                                : 'No available synthetic markets'}
                    </option>
                ) : (
                    <>
                        {!selectedIsAvailable && <option value=''>Select a market</option>}
                        {markets.map(market => (
                            <option key={market.symbol} value={market.symbol} disabled={market.isOpen === false}>
                                {market.displayName}{market.isOpen === false ? ' (closed)' : ''}
                            </option>
                        ))}
                    </>
                )}
            </select>
        </label>
    );
};

export default MarketSelector;

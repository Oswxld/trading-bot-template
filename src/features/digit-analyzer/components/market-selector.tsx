import type { AnalyzerMarket } from '../types/digit-analyzer.types';

type MarketSelectorProps = {
    markets: readonly AnalyzerMarket[];
    selectedSymbol: string;
    onSelect: (symbol: string) => void;
};

/**
 * The catalog is intentionally empty until the public market-data service arrives.
 * Never advertise hard-coded instruments as live/available.
 */
const MarketSelector = ({ markets, selectedSymbol, onSelect }: MarketSelectorProps) => (
    <label className='digit-analyzer__field digit-analyzer__field--market'>
        <span className='digit-analyzer__field-label'>Market</span>
        <select
            aria-label='Market'
            value={selectedSymbol}
            onChange={event => onSelect(event.target.value)}
            disabled={markets.length === 0}
        >
            {markets.length === 0 ? (
                <option value=''>Markets unavailable until connected</option>
            ) : (
                <>
                    {!markets.some(market => market.symbol === selectedSymbol) && (
                        <option value=''>Select a market</option>
                    )}
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

export default MarketSelector;

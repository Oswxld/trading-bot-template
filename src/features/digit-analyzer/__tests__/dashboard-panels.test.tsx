import { fireEvent, render, screen, within } from '@testing-library/react';
import DigitDistribution from '../components/digit-distribution';
import MarketSelector from '../components/market-selector';
import OutcomeStatistics from '../components/outcome-statistics';
import RecentTicks from '../components/recent-ticks';

describe('Digit Analyzer presentational panels (controlled test fixtures only)', () => {
    it('renders the correct percentages supplied through digit counts', () => {
        render(
            <DigitDistribution
                counts={[0, 0, 2, 1, 0, 0, 0, 0, 0, 0]}
                totalTicks={3}
                latestDigit={2}
            />
        );

        expect(within(screen.getByLabelText('Digit 2')).getByText('66.7%')).toBeInTheDocument();
        expect(within(screen.getByLabelText('Digit 3')).getByText('33.3%')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting market data')).not.toBeInTheDocument();
    });

    it('renders parity and digit comparisons from computed statistics', () => {
        render(
            <OutcomeStatistics
                totalTicks={3}
                threshold={5}
                selectedDigit={2}
                onThresholdChange={jest.fn()}
                onSelectedDigitChange={jest.fn()}
                outcomes={{ even: 2, odd: 1, over: 1, under: 1, equal: 1, matches: 2, differs: 1 }}
            />
        );

        expect(screen.getByText('Even')).toBeInTheDocument();
        expect(screen.getByText('Over 5')).toBeInTheDocument();
        expect(screen.getByText('Equal to 5')).toBeInTheDocument();
        expect(screen.getByText('Matches 2')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting market data')).not.toBeInTheDocument();
    });

    it('renders a tick with its original quote precision', () => {
        render(<RecentTicks ticks={[{ id: 'R_75:1700000000:1', epoch: 1700000000, quote: '123.450', digit: 0 }]} />);

        expect(screen.getByText('123.450')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting market data')).not.toBeInTheDocument();
    });

    it('renders only supplied markets and prevents choosing closed markets', () => {
        const handleSelect = jest.fn();
        render(
            <MarketSelector
                markets={[
                    { symbol: 'R_75', displayName: 'Volatility 75 Index', isOpen: true },
                    { symbol: 'R_50', displayName: 'Volatility 50 Index', isOpen: false },
                    { symbol: 'R_25', displayName: 'Volatility 25 Index', isOpen: true },
                ]}
                selectedSymbol='R_75'
                onSelect={handleSelect}
            />
        );

        expect(screen.getByRole('combobox', { name: 'Market' })).toHaveValue('R_75');
        expect(screen.getByRole('option', { name: 'Volatility 50 Index (closed)' })).toBeDisabled();
        fireEvent.change(screen.getByRole('combobox', { name: 'Market' }), { target: { value: 'R_25' } });
        expect(handleSelect).toHaveBeenCalledWith('R_25');
    });
});

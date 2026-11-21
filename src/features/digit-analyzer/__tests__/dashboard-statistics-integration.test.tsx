import { fireEvent, render, screen, within } from '@testing-library/react';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import { useLiveTicks } from '../hooks/use-live-ticks';
import type { AnalyzerTick } from '../types/digit-analyzer.types';
import DigitAnalyzer from '..';

jest.mock('../hooks/use-market-catalog', () => ({ useMarketCatalog: jest.fn() }));
jest.mock('../hooks/use-live-ticks', () => ({ useLiveTicks: jest.fn() }));

const mkTicks = (digits: number[], symbol = 'R_10'): AnalyzerTick[] =>
    digits.map((digit, index) => ({
        id: `history:${symbol}:${1770000000 + index}:${index + 1}`,
        epoch: 1770000000 + index,
        quote: `123.45${digit}`,
        digit,
    }));

const mockCatalog = (symbol = 'R_10') => {
    jest.mocked(useMarketCatalog).mockReturnValue({
        markets: [
            { symbol: 'R_10', displayName: 'Volatility 10 Index', isOpen: true },
            { symbol: 'R_75', displayName: 'Volatility 75 Index', isOpen: true },
        ],
        selectedSymbol: symbol,
        selectMarket: jest.fn(),
        connectionState: 'live',
        phase: 'ready',
        error: null,
        reloadMarkets: jest.fn(),
        clientRef: { current: null },
    });
};

const mockFeed = (ticks: AnalyzerTick[], phase: 'ready' | 'loading' = 'ready') => {
    jest.mocked(useLiveTicks).mockReturnValue({
        latestTick: ticks.at(-1) ?? null,
        recentTicks: [...ticks].reverse().slice(0, 20),
        rollingTicks: ticks,
        sampleCount: ticks.length,
        status: ticks.length ? 'streaming' : 'subscribing',
        error: null,
        historyPhase: phase,
        historyError: null,
    });
};

const chartDigit = (digit: number) =>
    screen.getByRole('region', { name: 'Digit distribution' })
        .querySelectorAll('.digit-analyzer__bar-column')[digit] as HTMLElement;

const metric = (region: 'Even / Odd' | 'Over / Under' | 'Matches / Differs', label: string) => {
    const panel = screen.getByRole('region', { name: region });
    const text = within(panel).getByText(label);
    return text.closest('.digit-analyzer__metric-row') as HTMLElement;
};

describe('Digit Analyzer: live statistical dashboard integration (Chunk 5.6)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCatalog();
        mockFeed([]);
    });

    it('displays all five statistical engines from the same six observed ticks', () => {
        mockFeed(mkTicks([0, 0, 2, 5, 7, 9]), 'loading');
        render(<DigitAnalyzer />);

        expect(screen.getByRole('region', { name: 'Latest tick' })).toHaveTextContent('6 / 1,000');
        expect(chartDigit(0)).toHaveAttribute('aria-label', 'Digit 0: 2 of 6 ticks (33.3%)');
        expect(chartDigit(2)).toHaveAttribute('aria-label', 'Digit 2: 1 of 6 ticks (16.7%)');
        expect(chartDigit(1)).toHaveAttribute('aria-label', 'Digit 1: 0 of 6 ticks (0.0%)');
        expect(chartDigit(9)).toHaveClass('digit-analyzer__bar-column');
        expect(within(chartDigit(9)).getByText('16.7%')).toBeInTheDocument();

        expect(metric('Even / Odd', 'Even')).toHaveTextContent('350.0%');
        expect(metric('Even / Odd', 'Odd')).toHaveTextContent('350.0%');
        expect(metric('Over / Under', 'Over 5')).toHaveTextContent('233.3%');
        expect(metric('Over / Under', 'Under 5')).toHaveTextContent('350.0%');
        expect(metric('Over / Under', 'Equal to 5')).toHaveTextContent('116.7%');
        expect(metric('Matches / Differs', 'Matches 5')).toHaveTextContent('116.7%');
        expect(metric('Matches / Differs', 'Differs')).toHaveTextContent('583.3%');

        expect(screen.queryByText('Awaiting market data')).not.toBeInTheDocument();
        expect(screen.getByRole('note')).toHaveTextContent('Loading the latest 1,000 historical ticks.');
    });

    it('updates frequencies, parity, over/under and matches/differs after new real ticks', () => {
        mockFeed(mkTicks([0, 0, 2, 5, 7, 9]));
        const { rerender } = render(<DigitAnalyzer />);
        expect(chartDigit(9)).toHaveAttribute('aria-label', 'Digit 9: 1 of 6 ticks (16.7%)');
        expect(metric('Matches / Differs', 'Matches 5')).toHaveTextContent('116.7%');

        mockFeed(mkTicks([0, 0, 2, 5, 7, 9, 9, 9]));
        rerender(<DigitAnalyzer />);
        expect(chartDigit(9)).toHaveAttribute('aria-label', 'Digit 9: 3 of 8 ticks (37.5%)');
        expect(metric('Even / Odd', 'Even')).toHaveTextContent('337.5%');
        expect(metric('Even / Odd', 'Odd')).toHaveTextContent('562.5%');
        expect(metric('Over / Under', 'Over 5')).toHaveTextContent('450.0%');
        expect(metric('Matches / Differs', 'Matches 5')).toHaveTextContent('112.5%');
        expect(screen.getByRole('region', { name: 'Latest tick' })).toHaveTextContent('8 / 1,000');
    });

    it('recalculates threshold and digit selection without requesting a new market stream', () => {
        mockFeed(mkTicks([0, 0, 2, 5, 7, 9]));
        render(<DigitAnalyzer />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Over/Under threshold' }), {
            target: { value: '7' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Matches/Differs digit' }), {
            target: { value: '0' },
        });

        expect(metric('Over / Under', 'Over 7')).toHaveTextContent('116.7%');
        expect(metric('Over / Under', 'Under 7')).toHaveTextContent('466.7%');
        expect(metric('Over / Under', 'Equal to 7')).toHaveTextContent('116.7%');
        expect(metric('Matches / Differs', 'Matches 0')).toHaveTextContent('233.3%');
        expect(metric('Matches / Differs', 'Differs')).toHaveTextContent('466.7%');
        expect(chartDigit(0)).toHaveAttribute('aria-label', 'Digit 0: 2 of 6 ticks (33.3%)');
        // useLiveTicks continues receiving the same selected market/window; a
        // threshold change is local computation, not a resubscription.
        expect(jest.mocked(useLiveTicks).mock.calls.every(args => args[1] === 'R_10' && args[3] === 1000))
            .toBe(true);
    });

    it('uses the new instrument’s observations and never displays the previous market’s counts', () => {
        mockFeed(mkTicks([0, 0, 2, 5, 7, 9]));
        const { rerender } = render(<DigitAnalyzer />);
        expect(chartDigit(0)).toHaveAttribute('aria-label', 'Digit 0: 2 of 6 ticks (33.3%)');

        mockCatalog('R_75');
        mockFeed(mkTicks([5, 5, 5], 'R_75'));
        rerender(<DigitAnalyzer />);
        expect(chartDigit(0)).toHaveAttribute('aria-label', 'Digit 0: 0 of 3 ticks (0.0%)');
        expect(chartDigit(5)).toHaveAttribute('aria-label', 'Digit 5: 3 of 3 ticks (100.0%)');
        expect(metric('Even / Odd', 'Even')).toHaveTextContent('00.0%');
        expect(metric('Even / Odd', 'Odd')).toHaveTextContent('3100.0%');
        expect(metric('Matches / Differs', 'Matches 5')).toHaveTextContent('3100.0%');
        expect(screen.getByRole('region', { name: 'Latest tick' })).toHaveTextContent('3 / 1,000');

        mockFeed([]);
        rerender(<DigitAnalyzer />);
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
        expect(chartDigit(5)).toHaveAttribute('aria-label', 'Digit 5: awaiting market data');
        expect(metric('Matches / Differs', 'Matches 5')).toHaveTextContent('—');
    });

    it('does not fabricate a full 500-tick sample when the feed has only 17 observations', () => {
        const ticks = mkTicks(Array.from({ length: 17 }, (_, i) => i % 10));
        mockFeed(ticks);
        render(<DigitAnalyzer />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Sample size' }), {
            target: { value: '500' },
        });
        expect(screen.getByRole('region', { name: 'Latest tick' })).toHaveTextContent('17 / 500');
        expect(chartDigit(0)).toHaveAttribute('aria-label', 'Digit 0: 2 of 17 ticks (11.8%)');
        expect(metric('Even / Odd', 'Even')).toHaveTextContent('952.9%');
        expect(metric('Even / Odd', 'Odd')).toHaveTextContent('847.1%');
    });
});

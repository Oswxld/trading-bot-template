import { fireEvent, render, screen } from '@testing-library/react';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import { useLiveTicks } from '../hooks/use-live-ticks';
// Exercise the same public entry point used by main.tsx's lazy import.
import DigitAnalyzer from '..';

// Isolate view tests from the real WebSocket; hook lifecycle has its own tests.
jest.mock('../hooks/use-market-catalog', () => ({ useMarketCatalog: jest.fn() }));
jest.mock('../hooks/use-live-ticks', () => ({ useLiveTicks: jest.fn() }));

const selectMarket = jest.fn();
const reloadMarkets = jest.fn();

const loadingCatalog: ReturnType<typeof useMarketCatalog> = {
    markets: [],
    selectedSymbol: '',
    selectMarket,
    connectionState: 'connecting',
    phase: 'loading',
    error: null,
    reloadMarkets,
    clientRef: { current: null },
};

describe('Digit Analyzer feature shell', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useMarketCatalog).mockReturnValue({ ...loadingCatalog });
        jest.mocked(useLiveTicks).mockReturnValue({
            latestTick: null, recentTicks: [], status: 'idle', error: null,
        });
    });

    it('shows an honest loading state until public market metadata arrives', () => {
        render(<DigitAnalyzer />);

        expect(screen.getByRole('heading', { name: 'Digit Analyzer' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Connecting');
        expect(screen.getByRole('note')).toHaveTextContent('loading available synthetic markets');
        expect(screen.getByRole('note')).toHaveTextContent('Live ticks are not streaming yet');
    });

    it('mounts and unmounts without leaving analyzer content behind', () => {
        const { unmount } = render(<DigitAnalyzer />);
        expect(screen.getByRole('heading', { name: 'Digit Analyzer' })).toBeInTheDocument();
        unmount();
        expect(screen.queryByRole('heading', { name: 'Digit Analyzer' })).not.toBeInTheDocument();

        render(<DigitAnalyzer />);
        expect(screen.getByRole('status')).toHaveTextContent('Connecting');
    });

    it('keeps trading/tick controls disabled while the catalog is loading', () => {
        render(<DigitAnalyzer />);
        expect(screen.getByRole('combobox', { name: 'Market' })).toBeDisabled();
        expect(screen.getByRole('option', { name: 'Loading Deriv markets...' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
        expect(screen.getByText('No ticks received yet')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Latest tick' })).toBeInTheDocument();
    });

    it('lets users configure analysis settings without inventing tick data', () => {
        render(<DigitAnalyzer />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Sample size' }), { target: { value: '500' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Over/Under threshold' }), {
            target: { value: '7' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Matches/Differs digit' }), {
            target: { value: '2' },
        });

        expect(screen.getByRole('combobox', { name: 'Sample size' })).toHaveValue('500');
        expect(screen.getByRole('combobox', { name: 'Over/Under threshold' })).toHaveValue('7');
        expect(screen.getByRole('combobox', { name: 'Matches/Differs digit' })).toHaveValue('2');
        expect(screen.getByText('Over 7')).toBeInTheDocument();
        expect(screen.getByText('Matches 2')).toBeInTheDocument();
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
    });

    it('renders the planned analysis areas without fabricating tick results', () => {
        render(<DigitAnalyzer />);
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
        expect(screen.getByRole('region', { name: 'Digit distribution' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent ticks' })).toBeInTheDocument();
    });

    it('populates the market dropdown and allows changing only selectable symbols', () => {
        jest.mocked(useMarketCatalog).mockReturnValue({
            ...loadingCatalog,
            connectionState: 'live',
            phase: 'ready',
            markets: [
                { symbol: 'R_10', displayName: 'Volatility 10 Index', isOpen: true },
                { symbol: 'R_25', displayName: 'Volatility 25 Index', isOpen: true },
                { symbol: 'R_50', displayName: 'Volatility 50 Index', isOpen: false },
            ],
            selectedSymbol: 'R_10',
        });
        render(<DigitAnalyzer />);

        expect(screen.getByRole('note')).toHaveTextContent('2 synthetic markets available');
        expect(screen.getByRole('note')).toHaveTextContent('Live tick streaming is not enabled yet');
        expect(screen.getByRole('combobox', { name: 'Market' })).toHaveValue('R_10');
        expect(screen.getByRole('option', { name: 'Volatility 50 Index (closed)' })).toBeDisabled();
        fireEvent.change(screen.getByRole('combobox', { name: 'Market' }), { target: { value: 'R_25' } });
        expect(selectMarket).toHaveBeenCalledWith('R_25');
        fireEvent.click(screen.getByRole('button', { name: 'Reload markets' }));
        expect(reloadMarkets).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
    });

    it('renders actual streamed prices and last digits without faking histogram totals', () => {
        jest.mocked(useMarketCatalog).mockReturnValue({
            ...loadingCatalog,
            connectionState: 'live',
            phase: 'ready',
            markets: [{ symbol: 'R_75', displayName: 'Volatility 75 Index', isOpen: true }],
            selectedSymbol: 'R_75',
        });
        jest.mocked(useLiveTicks).mockReturnValue({
            latestTick: { id: 'R_75:1770000000:1', epoch: 1770000000, quote: '123.450', digit: 0 },
            recentTicks: [{ id: 'R_75:1770000000:1', epoch: 1770000000, quote: '123.450', digit: 0 }],
            status: 'streaming',
            error: null,
        });
        render(<DigitAnalyzer />);

        expect(screen.getByRole('note')).toHaveTextContent('Receiving live ticks');
        expect(screen.getByText('123.450')).toBeInTheDocument();
        expect(screen.getByText('Most recent market tick')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent ticks' })).toHaveTextContent('123.450');
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(4);
        expect(screen.getByRole('combobox', { name: 'Market' })).toHaveValue('R_75');
    });

    it('shows an explicit error with a Retry action instead of fake market choices', () => {
        jest.mocked(useMarketCatalog).mockReturnValue({
            ...loadingCatalog,
            connectionState: 'error',
            phase: 'error',
            error: 'Public market request timed out',
        });
        render(<DigitAnalyzer />);

        expect(screen.getByRole('alert')).toHaveTextContent('Public market request timed out');
        expect(screen.getByRole('combobox', { name: 'Market' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry markets' }));
        expect(reloadMarkets).toHaveBeenCalledTimes(1);
    });
});

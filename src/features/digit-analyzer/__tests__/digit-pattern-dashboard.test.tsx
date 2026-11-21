import { fireEvent, render, screen, within } from '@testing-library/react';
import DigitAnalyzer from '..';
import DigitPatternScores from '../components/digit-pattern-scores';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import { useLiveTicks } from '../hooks/use-live-ticks';
import { calculateDigitPatternScores } from '../services/digit-pattern-score';
import { detectDigitPatternLeaders } from '../services/digit-pattern-leaders';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

jest.mock('../hooks/use-market-catalog', () => ({ useMarketCatalog: jest.fn() }));
jest.mock('../hooks/use-live-ticks', () => ({ useLiveTicks: jest.fn() }));

const makeTicks = (digits: number[], symbol = 'R_10'): AnalyzerTick[] =>
    digits.map((digit, index) => ({
        id: `history:${symbol}:${1770000000 + index}:${index + 1}`,
        epoch: 1770000000 + index,
        quote: `123.45${digit}`,
        digit,
    }));

const uniform = (size: number, symbol = 'R_10') =>
    makeTicks(Array.from({ length: size }, (_, i) => i % 10), symbol);

const allDigit = (digit: number, count = 100, symbol = 'R_10') =>
    makeTicks(Array(count).fill(digit), symbol);

const mockCatalog = (symbol = 'R_10', connected = true) =>
    jest.mocked(useMarketCatalog).mockReturnValue({
        markets: [
            { symbol: 'R_10', displayName: 'Volatility 10 Index', isOpen: true },
            { symbol: 'R_75', displayName: 'Volatility 75 Index', isOpen: true },
        ],
        selectedSymbol: symbol,
        selectMarket: jest.fn(),
        connectionState: connected ? 'live' : 'connecting',
        phase: connected ? 'ready' : 'loading',
        error: null,
        reloadMarkets: jest.fn(),
        clientRef: { current: null },
    });

const mockFeed = (
    ticks: AnalyzerTick[],
    historyPhase: 'idle' | 'loading' | 'ready' | 'error' = 'ready',
    status: 'subscribing' | 'streaming' | 'error' = 'streaming'
) => jest.mocked(useLiveTicks).mockReturnValue({
    latestTick: ticks.at(-1) ?? null,
    recentTicks: [...ticks].reverse().slice(0, 20),
    rollingTicks: ticks,
    sampleCount: ticks.length,
    status,
    error: status === 'error' ? 'Market connection interrupted' : null,
    historyPhase,
    historyError: historyPhase === 'error' ? 'History unavailable' : null,
});

const tiles = () => within(screen.getByRole('region', { name: 'Digit pattern scores' }))
    .getAllByRole('group', { name: /^Digit [0-9]:/ });

const greenTiles = () => tiles().filter(tile => tile.getAttribute('data-leader') === 'true');

describe('Digit Analyzer: 10-score dashboard + green leader integration (Chunk 6.4)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCatalog();
        mockFeed([]);
    });

    it('shows ten non-green placeholders until at least 100 real ticks exist', () => {
        mockFeed(makeTicks(Array(17).fill(7)));
        render(<DigitAnalyzer />);
        expect(tiles()).toHaveLength(10);
        expect(greenTiles()).toHaveLength(0);
        expect(tiles().every(tile => tile.textContent?.includes('No score'))).toBe(true);
        expect(screen.getByText('Collecting observations: 17 / 100 real ticks.'))
            .toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Digit distribution' }))
            .toHaveTextContent('100.0%'); // Other analytics still show actual 17 ticks.
    });

    it('identifies digit seven with a visible green Top score badge', () => {
        mockFeed(allDigit(7));
        render(<DigitAnalyzer />);
        expect(tiles()).toHaveLength(10);
        expect(greenTiles()).toHaveLength(1);
        expect(greenTiles()[0]).toHaveAttribute(
            'aria-label', 'Digit 7: 87.5 pattern points, highest observed pattern score'
        );
        expect(greenTiles()[0]).toHaveClass('digit-analyzer__pattern-digit--leader');
        expect(within(greenTiles()[0]).getByText('Top score')).toBeInTheDocument();
        expect(screen.getByText('Calculated from 100 observed ticks. Highest score: digit 7.'))
            .toBeInTheDocument();
        expect(screen.getByText(/not a prediction, win probability or trading recommendation/i))
            .toBeInTheDocument();
    });

    it('handles digit zero as a valid highest-scoring digit', () => {
        mockFeed(allDigit(0));
        render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
        expect(greenTiles()[0]).toHaveAttribute('aria-label',
            'Digit 0: 87.5 pattern points, highest observed pattern score');
    });

    it('highlights EVERY genuinely equal top digit, not an arbitrary first winner', () => {
        mockFeed(uniform(100));
        render(<DigitAnalyzer />);
        expect(tiles()).toHaveLength(10);
        expect(greenTiles()).toHaveLength(10);
        expect(greenTiles().every(tile => tile.getAttribute('aria-label')?.includes('joint highest'))).toBe(true);
        expect(screen.getByText(/Joint highest score: digits 0, 1, 2, 3, 4, 5, 6, 7, 8, 9/))
            .toBeInTheDocument();
    });

    it('suppresses green while historical observations are still loading', () => {
        mockFeed(allDigit(7), 'loading');
        const { rerender } = render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
        expect(screen.getByText('Loading verified market observations; scores are not available yet.'))
            .toBeInTheDocument();
        mockFeed(allDigit(7), 'ready');
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
    });

    it('never highlights stale observations during a market switch, even before the hook clears its view', () => {
        mockFeed(allDigit(7));
        const { rerender } = render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
        mockCatalog('R_75');
        // The engine refuses previously cached ticks with the old market ID.
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
        expect(screen.getByText('Pattern scores unavailable until verified market data is ready.'))
            .toBeInTheDocument();

        mockFeed(allDigit(3, 100, 'R_75'));
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
        expect(greenTiles()[0]).toHaveAttribute('aria-label',
            'Digit 3: 87.5 pattern points, highest observed pattern score');
        mockFeed([]);
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
    });

    it('moves the green indicator when the underlying rolling observations change', () => {
        mockFeed(allDigit(7));
        const { rerender } = render(<DigitAnalyzer />);
        expect(greenTiles()[0]).toHaveAttribute('aria-label', expect.stringContaining('Digit 7:'));

        mockFeed(allDigit(9));
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
        expect(greenTiles()[0]).toHaveAttribute('aria-label', expect.stringContaining('Digit 9:'));
        expect(screen.getByText('Calculated from 100 observed ticks. Highest score: digit 9.'))
            .toBeInTheDocument();
    });

    it('works with 100 / 500 / 1000 observations and keeps one market subscription contract', () => {
        mockFeed(allDigit(7, 1000));
        const { rerender } = render(<DigitAnalyzer />);
        expect(screen.getByText('Calculated from 1,000 observed ticks. Highest score: digit 7.'))
            .toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Sample size' }), {
            target: { value: '500' },
        });
        mockFeed(allDigit(7, 500));
        rerender(<DigitAnalyzer />);
        expect(screen.getByText('Calculated from 500 observed ticks. Highest score: digit 7.'))
            .toBeInTheDocument();
        expect(greenTiles()).toHaveLength(1);
        expect(jest.mocked(useLiveTicks).mock.calls.every(args =>
            args[1] === 'R_10'
        )).toBe(true);
    });

    it('keeps verified live-only scores available after historical API failure', () => {
        mockFeed(allDigit(7), 'error');
        render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(1);
        expect(screen.getByText('Calculated from 100 observed ticks. Highest score: digit 7.'))
            .toBeInTheDocument();
    });

    it('removes all green highlights when disconnected or stream has errored', () => {
        mockFeed(allDigit(7));
        mockCatalog('R_10', false);
        const { rerender } = render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
        mockCatalog('R_10', true);
        mockFeed(allDigit(7), 'ready', 'error');
        rerender(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
        expect(tiles()).toHaveLength(10);
    });

    it('shows informative text for an empty feed and no winner', () => {
        mockFeed([]);
        render(<DigitAnalyzer />);
        expect(greenTiles()).toHaveLength(0);
        expect(screen.getByText('Awaiting market data. At least 100 real ticks are needed for pattern scores.'))
            .toBeInTheDocument();
    });

    it('keeps all ten visible score labels descriptive, never percentage predictions', () => {
        const input = allDigit(7);
        const scores = calculateDigitPatternScores({ symbol: 'R_10', ticks: input });
        const leaders = detectDigitPatternLeaders(scores);
        render(<DigitPatternScores scores={scores} leaders={leaders} />);
        expect(tiles()).toHaveLength(10);
        for (const tile of tiles()) {
            expect(tile.getAttribute('aria-label')).toContain('pattern points');
            expect(tile.getAttribute('aria-label')).not.toContain('%');
        }
        expect(screen.getByText(/Scores do not sum to 100%/)).toBeInTheDocument();
    });

    it('fails closed when the presentation receives no validated leader object', () => {
        const scores = calculateDigitPatternScores({ symbol: 'R_10', ticks: allDigit(7) });
        render(<DigitPatternScores scores={scores} leaders={null} />);
        expect(greenTiles()).toHaveLength(0);
        expect(tiles()).toHaveLength(10);
        expect(screen.getByText('Pattern scores unavailable until verified market data is ready.'))
            .toBeInTheDocument();
    });
});

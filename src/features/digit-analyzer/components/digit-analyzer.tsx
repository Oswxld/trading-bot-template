import { useMemo, useState } from 'react';
import { countDigitFrequencies } from '../services/digit-frequency';
import { calculateDigitPercentages } from '../services/digit-percentages';
import { calculateDigitParity } from '../services/digit-parity';
import { calculateDigitOverUnder } from '../services/digit-over-under';
import { calculateDigitMatchesDiffers } from '../services/digit-matches-differs';
import { calculateDigitPatternScores } from '../services/digit-pattern-score';
import { detectDigitPatternLeaders } from '../services/digit-pattern-leaders';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import { useLiveTicks } from '../hooks/use-live-ticks';
import type { AnalyzerSampleSize } from '../types/digit-analyzer.types';
import AnalyzerControls from './analyzer-controls';
import AnalyzerHeader from './analyzer-header';
import CurrentTick from './current-tick';
import DigitDistribution from './digit-distribution';
import DigitPatternScores from './digit-pattern-scores';
import OutcomeStatistics from './outcome-statistics';
import RecentTicks from './recent-ticks';
import '../styles/digit-analyzer.scss';

/**
 * Chunk 5.6: derive every displayed distribution and outcome from the SAME
 * bounded, synchronized historical + live rolling sample. Observed statistics
 * describe past ticks; they are not predictive trading probabilities.
 */
const DigitAnalyzer = () => {
    const {
        markets,
        selectedSymbol,
        selectMarket,
        connectionState,
        phase,
        error,
        reloadMarkets,
        clientRef,
    } = useMarketCatalog();
    const [sampleSize, setSampleSize] = useState<AnalyzerSampleSize>(1000);
    const {
        latestTick,
        recentTicks,
        sampleCount,
        rollingTicks,
        status: tickStatus,
        error: tickError,
        historyPhase,
        historyError,
    } = useLiveTicks(
        clientRef.current,
        selectedSymbol,
        phase === 'ready' && connectionState === 'live',
        sampleSize
    );
    const [selectedDigit, setSelectedDigit] = useState(5);
    const [threshold, setThreshold] = useState(5);

    // All five statistic engines consume one validated frequency histogram.
    // Control changes recalculate locally; they never restart the WebSocket.
    // With no observed ticks, keep outcome cards in their no-data state.
    const statistics = useMemo(() => {
        const frequency = countDigitFrequencies(rollingTicks);
        const distribution = calculateDigitPercentages(frequency);
        const parity = calculateDigitParity(frequency);
        const overUnder = calculateDigitOverUnder(frequency, threshold);
        const matchesDiffers = calculateDigitMatchesDiffers(frequency, selectedDigit);

        return {
            distribution,
            outcomes: distribution.hasData ? {
                even: parity.even,
                odd: parity.odd,
                over: overUnder.over,
                under: overUnder.under,
                equal: overUnder.equal,
                matches: matchesDiffers.matches,
                differs: matchesDiffers.differs,
            } : null,
        };
    }, [rollingTicks, selectedDigit, threshold]);

    // All ten scores and the top digit(s) come from the SAME live/history
    // sample as the distribution. No additional subscription, timer or
    // trading endpoint. While history is loading, do not signal a leader.
    // The market-aware engine refuses stale/wrong-symbol tick observations.
    const patternsLoading = phase === 'loading' ||
        (phase === 'ready' && historyPhase === 'loading');
    const patterns = useMemo(() => {
        if (phase !== 'ready' || connectionState !== 'live' ||
            !selectedSymbol || historyPhase === 'loading' || tickStatus === 'error') {
            return { scores: null, leaders: null };
        }
        try {
            const scores = calculateDigitPatternScores({ symbol: selectedSymbol, ticks: rollingTicks });
            return { scores, leaders: detectDigitPatternLeaders(scores) };
        } catch {
            // Invalid market observations must never produce a green winner.
            // The tick stream owns transport errors and their diagnostics.
            return { scores: null, leaders: null };
        }
    }, [connectionState, historyPhase, phase, rollingTicks, selectedSymbol, tickStatus]);

    const selectedMarket = markets.find(market => market.symbol === selectedSymbol);
    const loadedCount = markets.filter(market => market.isOpen !== false).length;

    return (
        <section className='digit-analyzer' aria-labelledby='digit-analyzer-title'>
            <div className='digit-analyzer__content'>
                <AnalyzerHeader connectionState={connectionState} />

                <div className={`digit-analyzer__notice digit-analyzer__notice--${phase}`} role='note'>
                    <div className='digit-analyzer__notice-copy'>
                        {phase === 'loading' && (
                            <p>Connecting to Deriv and loading available synthetic markets. Live ticks are not streaming yet.</p>
                        )}
                        {phase === 'ready' && (
                            <p>
                                {loadedCount} synthetic {loadedCount === 1 ? 'market' : 'markets'} available.
                                {selectedMarket ? ` Selected: ${selectedMarket.displayName}.` : ''}
                                {' '}
                                {tickStatus === 'streaming'
                                    ? 'Receiving live ticks.'
                                    : tickStatus === 'subscribing'
                                        ? 'Subscribing to live ticks...'
                                        : tickStatus === 'error'
                                            ? 'Tick stream unavailable; reload markets to reconnect.'
                                            : 'Preparing live market stream.'}
                            </p>
                        )}
                        {phase === 'ready' && tickStatus === 'error' && (
                            <p role='alert'>Live tick error: {tickError ?? 'Subscription failed.'}</p>
                        )}
                        {phase === 'ready' && historyPhase === 'loading' && (
                            <p>Loading the latest {sampleSize.toLocaleString()} historical ticks.</p>
                        )}
                        {phase === 'ready' && historyPhase === 'ready' && (
                            <p>Historical and live observations are synchronized into the rolling sample.</p>
                        )}
                        {phase === 'ready' && historyPhase === 'error' && (
                            <p role='alert'>
                                Historical ticks unavailable: {historyError ?? 'History request failed.'}
                                {' '}Live observations can still continue.
                            </p>
                        )}
                        {phase === 'empty' && (
                            <p>Deriv returned no currently selectable synthetic markets. Live tick streaming has not started.</p>
                        )}
                        {phase === 'error' && (
                            <p role='alert'>
                                Unable to load the Deriv market catalog: {error ?? 'Connection unavailable.'}
                            </p>
                        )}
                    </div>
                    {phase !== 'loading' && (
                        <button
                            type='button'
                            className='digit-analyzer__reload-markets'
                            onClick={reloadMarkets}
                        >
                            {phase === 'error' ? 'Retry markets' : 'Reload markets'}
                        </button>
                    )}
                </div>

                <AnalyzerControls
                    markets={markets}
                    selectedSymbol={selectedSymbol}
                    onMarketChange={selectMarket}
                    isMarketLoading={phase === 'loading'}
                    hasMarketError={phase === 'error'}
                    sampleSize={sampleSize}
                    onSampleSizeChange={setSampleSize}
                    isPaused={false}
                />

                <CurrentTick tick={latestTick} sampleCount={sampleCount} sampleSize={sampleSize} />

                <div className='digit-analyzer__grid'>
                    <DigitDistribution
                        counts={statistics.distribution.counts}
                        percentages={statistics.distribution.percentages}
                        totalTicks={statistics.distribution.totalTicks}
                        latestDigit={latestTick?.digit ?? null}
                    />
                    <RecentTicks ticks={recentTicks} />
                    <DigitPatternScores
                        scores={patterns.scores}
                        leaders={patterns.leaders}
                        isLoading={patternsLoading}
                    />
                    <OutcomeStatistics
                        outcomes={statistics.outcomes}
                        totalTicks={statistics.distribution.totalTicks}
                        threshold={threshold}
                        onThresholdChange={setThreshold}
                        selectedDigit={selectedDigit}
                        onSelectedDigitChange={setSelectedDigit}
                    />
                </div>

                <p className='digit-analyzer__disclaimer'>
                    Historical digit frequencies describe past ticks and do not guarantee future outcomes.
                </p>
            </div>
        </section>
    );
};

export default DigitAnalyzer;

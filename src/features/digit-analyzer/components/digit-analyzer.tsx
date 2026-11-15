import { useState } from 'react';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import { useLiveTicks } from '../hooks/use-live-ticks';
import type { AnalyzerSampleSize } from '../types/digit-analyzer.types';
import AnalyzerControls from './analyzer-controls';
import AnalyzerHeader from './analyzer-header';
import CurrentTick from './current-tick';
import DigitDistribution from './digit-distribution';
import OutcomeStatistics from './outcome-statistics';
import RecentTicks from './recent-ticks';
import '../styles/digit-analyzer.scss';

/**
 * Chunk 4.3: historical snapshots and live ticks share the same public
 * connection, then populate a genuine bounded rolling sample. Digit-frequency
 * calculations and probability-style statistics are not enabled yet.
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
                    <DigitDistribution counts={[]} totalTicks={0} latestDigit={null} />
                    <RecentTicks ticks={recentTicks} />
                    <OutcomeStatistics
                        outcomes={null}
                        totalTicks={0}
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

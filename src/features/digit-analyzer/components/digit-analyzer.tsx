import { useState } from 'react';
import { useMarketCatalog } from '../hooks/use-market-catalog';
import type { AnalyzerSampleSize } from '../types/digit-analyzer.types';
import AnalyzerControls from './analyzer-controls';
import AnalyzerHeader from './analyzer-header';
import CurrentTick from './current-tick';
import DigitDistribution from './digit-distribution';
import OutcomeStatistics from './outcome-statistics';
import RecentTicks from './recent-ticks';
import '../styles/digit-analyzer.scss';

/**
 * Chunk 3.3: the market dropdown now uses a real public active_symbols catalog.
 * No history or tick stream is subscribed to yet, and no prices/statistics are
 * fabricated. The hook opens one dedicated socket only while this tab is mounted.
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
    } = useMarketCatalog();
    const [sampleSize, setSampleSize] = useState<AnalyzerSampleSize>(1000);
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
                                {' '}Live tick streaming is not enabled yet.
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

                <CurrentTick tick={null} sampleCount={0} sampleSize={sampleSize} />

                <div className='digit-analyzer__grid'>
                    <DigitDistribution counts={[]} totalTicks={0} latestDigit={null} />
                    <RecentTicks ticks={[]} />
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

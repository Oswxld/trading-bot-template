import { useState } from 'react';
import type { AnalyzerMarket, AnalyzerSampleSize } from '../types/digit-analyzer.types';
import AnalyzerControls from './analyzer-controls';
import AnalyzerHeader from './analyzer-header';
import CurrentTick from './current-tick';
import DigitDistribution from './digit-distribution';
import OutcomeStatistics from './outcome-statistics';
import RecentTicks from './recent-ticks';
import '../styles/digit-analyzer.scss';

// Chunk 2.4 is presentational only. Markets will come from the dedicated public
// feed service in Chunk 3; we never represent a mock market as available.
const NO_MARKETS: readonly AnalyzerMarket[] = [];

/**
 * Read-only dashboard shell.
 * No WebSocket, trading requests, or fabricated statistics are created here.
 * The analyzer hook and real market-data stream will feed these components later.
 */
const DigitAnalyzer = () => {
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const [sampleSize, setSampleSize] = useState<AnalyzerSampleSize>(1000);
    const [selectedDigit, setSelectedDigit] = useState(5);
    const [threshold, setThreshold] = useState(5);

    return (
        <section className='digit-analyzer' aria-labelledby='digit-analyzer-title'>
            <div className='digit-analyzer__content'>
                <AnalyzerHeader connectionState='idle' />

                <div className='digit-analyzer__notice' role='note'>
                    The analyzer interface is ready. Live market data is not connected yet.
                    Market selection, refresh, and pause will become available when the public feed is integrated.
                </div>

                <AnalyzerControls
                    markets={NO_MARKETS}
                    selectedSymbol={selectedSymbol}
                    onMarketChange={setSelectedSymbol}
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

import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import type { AnalyzerMarket, AnalyzerSampleSize } from '../types/digit-analyzer.types';
import MarketSelector from './market-selector';

type AnalyzerControlsProps = {
    markets: readonly AnalyzerMarket[];
    selectedSymbol: string;
    onMarketChange: (symbol: string) => void;
    isMarketLoading?: boolean;
    hasMarketError?: boolean;
    sampleSize: AnalyzerSampleSize;
    onSampleSizeChange: (size: AnalyzerSampleSize) => void;
    isPaused: boolean;
    onRefresh?: () => void;
    onTogglePause?: () => void;
};

/** Safe toolbar: unavailable live-data actions remain disabled until wired up. */
const AnalyzerControls = ({
    markets,
    selectedSymbol,
    onMarketChange,
    isMarketLoading,
    hasMarketError,
    sampleSize,
    onSampleSizeChange,
    isPaused,
    onRefresh,
    onTogglePause,
}: AnalyzerControlsProps) => (
    <section className='digit-analyzer__toolbar' aria-label='Analysis controls'>
        <MarketSelector
            markets={markets}
            selectedSymbol={selectedSymbol}
            onSelect={onMarketChange}
            isLoading={isMarketLoading}
            hasError={hasMarketError}
        />
        <label className='digit-analyzer__field digit-analyzer__field--window'>
            <span className='digit-analyzer__field-label'>Sample window</span>
            <select
                aria-label='Sample size'
                value={sampleSize}
                onChange={event => onSampleSizeChange(Number(event.target.value) as AnalyzerSampleSize)}
            >
                {ANALYZER_SAMPLE_SIZES.map(size => (
                    <option key={size} value={size}>{size.toLocaleString()} ticks</option>
                ))}
            </select>
        </label>
        <div className='digit-analyzer__toolbar-actions'>
            <button type='button' className='digit-analyzer__action' onClick={onRefresh} disabled={!onRefresh}>
                Refresh
            </button>
            <button
                type='button'
                className='digit-analyzer__action digit-analyzer__action--primary'
                onClick={onTogglePause}
                disabled={!onTogglePause}
            >
                {isPaused ? 'Resume' : 'Pause'}
            </button>
        </div>
    </section>
);

export default AnalyzerControls;

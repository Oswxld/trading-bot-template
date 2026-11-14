import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

type CurrentTickProps = {
    tick: AnalyzerTick | null;
    sampleCount: number;
    sampleSize: AnalyzerSampleSize;
};

const CurrentTick = ({ tick, sampleCount, sampleSize }: CurrentTickProps) => (
    <section className='digit-analyzer__overview' aria-label='Latest tick'>
        <div className='digit-analyzer__overview-primary'>
            <span className='digit-analyzer__field-label'>Latest quoted price</span>
            <strong className='digit-analyzer__quote'>{tick?.quote ?? '—'}</strong>
            <span className='digit-analyzer__overview-caption'>
                {tick ? 'Most recent market tick' : 'No ticks received yet'}
            </span>
        </div>
        <div className='digit-analyzer__overview-side'>
            <div className='digit-analyzer__overview-stat'>
                <span className='digit-analyzer__field-label'>Last digit</span>
                <strong className='digit-analyzer__last-digit'>{tick?.digit ?? '—'}</strong>
            </div>
            <div className='digit-analyzer__overview-stat'>
                <span className='digit-analyzer__field-label'>Analyzed ticks</span>
                <strong className='digit-analyzer__sample-count'>
                    {sampleCount.toLocaleString()} <span>/ {sampleSize.toLocaleString()}</span>
                </strong>
            </div>
        </div>
    </section>
);

export default CurrentTick;

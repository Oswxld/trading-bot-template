import AnalyzerHeader from './analyzer-header';
import '../styles/digit-analyzer.scss';

const ANALYSIS_PANELS = [
    {
        title: 'Digit distribution',
        description: 'Counts and percentages for the final digits 0–9.',
    },
    {
        title: 'Even / Odd',
        description: 'Compare the occurrence of even and odd final digits.',
    },
    {
        title: 'Over / Under',
        description: 'Compare final digits against a selected threshold.',
    },
    {
        title: 'Matches / Differs',
        description: 'Compare one selected digit against all other digits.',
    },
    {
        title: 'Recent ticks',
        description: 'Review the latest tick prices, digits, and streaks.',
    },
] as const;

/**
 * Feature shell only (Chunk 2.1).
 * No market requests, trading requests, or simulated tick values are made here.
 * Live data services and interactive analysis are added in later chunks.
 */
const DigitAnalyzer = () => (
    <section className='digit-analyzer' aria-labelledby='digit-analyzer-title'>
        <div className='digit-analyzer__content'>
            <AnalyzerHeader connectionState='idle' />

            <div className='digit-analyzer__notice' role='note'>
                The analyzer interface is being prepared. Live market data is not connected yet.
            </div>

            <div className='digit-analyzer__grid'>
                {ANALYSIS_PANELS.map(panel => (
                    <section key={panel.title} className='digit-analyzer__panel' aria-label={panel.title}>
                        <h3 className='digit-analyzer__panel-title'>{panel.title}</h3>
                        <p className='digit-analyzer__panel-description'>{panel.description}</p>
                        <p className='digit-analyzer__panel-empty'>Awaiting market data</p>
                    </section>
                ))}
            </div>
        </div>
    </section>
);

export default DigitAnalyzer;

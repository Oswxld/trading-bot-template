import type { AnalyzerTick } from '../types/digit-analyzer.types';

type RecentTicksProps = {
    ticks: readonly AnalyzerTick[];
};

/** Pure presentation; the feed manager owns ordering, filtering and deduplication. */
const RecentTicks = ({ ticks }: RecentTicksProps) => (
    <section className='digit-analyzer__panel digit-analyzer__panel--recent' aria-label='Recent ticks'>
        <div className='digit-analyzer__panel-heading'>
            <div>
                <h3 className='digit-analyzer__panel-title'>Recent ticks</h3>
                <p className='digit-analyzer__panel-description'>Latest observed market prices.</p>
            </div>
            <span className='digit-analyzer__panel-chip'>Live history</span>
        </div>
        <div className='digit-analyzer__recent-scroll'>
            <table className='digit-analyzer__recent-table'>
                <thead>
                    <tr>
                        <th scope='col'>Time</th>
                        <th scope='col'>Quote</th>
                        <th scope='col'>Digit</th>
                    </tr>
                </thead>
                <tbody>
                    {ticks.length > 0 ? ticks.map(tick => (
                        <tr key={tick.id}>
                            <td>{new Date(tick.epoch * 1000).toLocaleTimeString()}</td>
                            <td className='digit-analyzer__recent-quote'>{tick.quote}</td>
                            <td><span className='digit-analyzer__recent-digit'>{tick.digit}</span></td>
                        </tr>
                    )) : (
                        <tr>
                            <td colSpan={3} className='digit-analyzer__recent-empty'>Awaiting market data</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </section>
);

export default RecentTicks;

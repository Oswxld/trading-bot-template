import type { DigitOutcomeCounts } from '../types/digit-analyzer.types';

type OutcomeStatisticsProps = {
    outcomes: DigitOutcomeCounts | null;
    totalTicks: number;
    threshold: number;
    onThresholdChange: (value: number) => void;
    selectedDigit: number;
    onSelectedDigitChange: (value: number) => void;
};

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

type MetricRowProps = {
    label: string;
    count: number | null;
    total: number;
};

const MetricRow = ({ label, count, total }: MetricRowProps) => (
    <div className='digit-analyzer__metric-row'>
        <span className='digit-analyzer__metric-label'>{label}</span>
        <div className='digit-analyzer__metric-values'>
            <strong>{count === null ? '—' : count.toLocaleString()}</strong>
            <span>{count === null || total === 0 ? '—' : `${((100 * count) / total).toFixed(1)}%`}</span>
        </div>
    </div>
);

const EmptyMessage = ({ show }: { show: boolean }) =>
    show ? <p className='digit-analyzer__panel-empty'>Awaiting market data</p> : null;

const OutcomeStatistics = ({
    outcomes,
    totalTicks,
    threshold,
    onThresholdChange,
    selectedDigit,
    onSelectedDigitChange,
}: OutcomeStatisticsProps) => (
    <>
        <section className='digit-analyzer__panel digit-analyzer__panel--metric' aria-label='Even / Odd'>
            <div className='digit-analyzer__panel-heading'>
                <h3 className='digit-analyzer__panel-title'>Even / Odd</h3>
                <span className='digit-analyzer__panel-chip'>Parity</span>
            </div>
            <p className='digit-analyzer__panel-description'>Compare the parity of each final digit.</p>
            <div className='digit-analyzer__metrics'>
                <MetricRow label='Even' count={outcomes?.even ?? null} total={totalTicks} />
                <MetricRow label='Odd' count={outcomes?.odd ?? null} total={totalTicks} />
            </div>
            <EmptyMessage show={!outcomes} />
        </section>

        <section className='digit-analyzer__panel digit-analyzer__panel--metric' aria-label='Over / Under'>
            <div className='digit-analyzer__panel-heading'>
                <h3 className='digit-analyzer__panel-title'>Over / Under</h3>
                <label className='digit-analyzer__inline-selector'>
                    <span>Threshold</span>
                    <select
                        aria-label='Over/Under threshold'
                        value={threshold}
                        onChange={event => onThresholdChange(Number(event.target.value))}
                    >
                        {DIGITS.map(digit => <option key={digit} value={digit}>{digit}</option>)}
                    </select>
                </label>
            </div>
            <p className='digit-analyzer__panel-description'>Compare digits with the selected threshold.</p>
            <div className='digit-analyzer__metrics'>
                <MetricRow label={`Over ${threshold}`} count={outcomes?.over ?? null} total={totalTicks} />
                <MetricRow label={`Under ${threshold}`} count={outcomes?.under ?? null} total={totalTicks} />
                <MetricRow label={`Equal to ${threshold}`} count={outcomes?.equal ?? null} total={totalTicks} />
            </div>
            <EmptyMessage show={!outcomes} />
        </section>

        <section className='digit-analyzer__panel digit-analyzer__panel--metric' aria-label='Matches / Differs'>
            <div className='digit-analyzer__panel-heading'>
                <h3 className='digit-analyzer__panel-title'>Matches / Differs</h3>
                <label className='digit-analyzer__inline-selector'>
                    <span>Digit</span>
                    <select
                        aria-label='Matches/Differs digit'
                        value={selectedDigit}
                        onChange={event => onSelectedDigitChange(Number(event.target.value))}
                    >
                        {DIGITS.map(digit => <option key={digit} value={digit}>{digit}</option>)}
                    </select>
                </label>
            </div>
            <p className='digit-analyzer__panel-description'>Compare the selected digit with all other digits.</p>
            <div className='digit-analyzer__metrics'>
                <MetricRow label={`Matches ${selectedDigit}`} count={outcomes?.matches ?? null} total={totalTicks} />
                <MetricRow label='Differs' count={outcomes?.differs ?? null} total={totalTicks} />
            </div>
            <EmptyMessage show={!outcomes} />
        </section>
    </>
);

export default OutcomeStatistics;

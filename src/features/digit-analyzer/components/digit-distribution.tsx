type DigitDistributionProps = {
    counts: readonly number[];
    totalTicks: number;
    latestDigit: number | null;
};

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

/** Presentation only. Frequencies and the rolling window are calculated elsewhere. */
const DigitDistribution = ({ counts, totalTicks, latestDigit }: DigitDistributionProps) => {
    const maxCount = totalTicks > 0 ? Math.max(0, ...counts) : 0;

    return (
        <section className='digit-analyzer__panel digit-analyzer__panel--distribution' aria-label='Digit distribution'>
            <div className='digit-analyzer__panel-heading'>
                <div>
                    <h3 className='digit-analyzer__panel-title'>Digit distribution</h3>
                    <p className='digit-analyzer__panel-description'>
                        Frequency of the last digit across the selected sample.
                    </p>
                </div>
                <span className='digit-analyzer__panel-chip'>Digits 0–9</span>
            </div>
            <div className='digit-analyzer__distribution-scroll'>
                <div className='digit-analyzer__distribution' aria-label='Last-digit frequency chart'>
                    {DIGITS.map(digit => {
                        const count = counts[digit] ?? 0;
                        const percent = totalTicks > 0 ? (100 * count) / totalTicks : 0;
                        const barHeight = maxCount > 0 ? (100 * count) / maxCount : 0;
                        return (
                            <div
                                className='digit-analyzer__bar-column'
                                key={digit}
                                aria-label={`Digit ${digit}`}
                                title={totalTicks > 0
                                    ? `Digit ${digit}: ${count} of ${totalTicks} ticks (${percent.toFixed(1)}%)`
                                    : `Digit ${digit}: awaiting market data`}
                            >
                                <span className='digit-analyzer__bar-value digit-analyzer__bar-value--detailed'>
                                    {totalTicks > 0 ? `${percent.toFixed(1)}%` : '—'}
                                </span>
                                <span className='digit-analyzer__bar-value digit-analyzer__bar-value--compact' aria-hidden='true'>
                                    {totalTicks > 0 ? `${Math.round(percent)}%` : '—'}
                                </span>
                                <div className='digit-analyzer__bar-track'>
                                    <span
                                        className={`digit-analyzer__bar${latestDigit === digit ? ' digit-analyzer__bar--latest' : ''}`}
                                        style={{ height: `${barHeight}%` }}
                                    />
                                </div>
                                <span className='digit-analyzer__bar-digit'>{digit}</span>
                                <span className='digit-analyzer__bar-count'>
                                    {totalTicks > 0 ? count.toLocaleString() : '—'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
            {totalTicks === 0 && <p className='digit-analyzer__panel-empty'>Awaiting market data</p>}
            <div className='digit-analyzer__panel-footnote'>
                Bars are scaled to the most frequent digit. The highlighted bar marks the latest digit. Percentages use the actual tick count.
            </div>
        </section>
    );
};

export default DigitDistribution;

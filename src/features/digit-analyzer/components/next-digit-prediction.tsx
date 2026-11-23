import type { NextDigitPrediction } from '../services/next-digit-transition';

const NextDigitPredictionPanel = ({ prediction }: { prediction: NextDigitPrediction | null }) => {
    const ready = prediction?.status === 'ready' && prediction.nextDigit !== null;
    const runner = ready ? prediction.candidates.find(item => item.digit === prediction.nextDigit) : null;
    const backup = ready ? prediction.candidates[1] : null;
    return (
        <section className='digit-analyzer__next-panel' aria-label='Best next digit'>
            <div className='digit-analyzer__next-heading'>
                <div>
                    <span className='digit-analyzer__next-kicker'>LIVE DERIV · DIGIT TRANSITIONS</span>
                    <h3>Best next number to choose</h3>
                </div>
                <span className='digit-analyzer__next-chip'>OBSERVED PATTERN · NOT A GUARANTEE</span>
            </div>
            {!ready ? (
                <div role='status' className='digit-analyzer__next-empty'>
                    {prediction?.reason ?? 'Connecting to real Deriv tick history. No simulated predictions are displayed.'}
                </div>
            ) : (
                <>
                    <div className='digit-analyzer__next-duo'>
                        <div className='digit-analyzer__next-entry'>
                            <span>ENTRY DIGIT · LATEST REAL TICK</span>
                            <strong>{prediction.entryDigit}</strong>
                            <p>Observed trigger number</p>
                        </div>
                        <div className='digit-analyzer__next-choice'>
                            <span>BEST OBSERVED NEXT DIGIT</span>
                            <strong>{prediction.nextDigit}</strong>
                            <p>{runner?.count ?? 0} of {prediction.transitionCount} historical successors ({runner?.observedShare.toFixed(1)}%)</p>
                        </div>
                    </div>
                    <p className='digit-analyzer__next-context'>
                        In {prediction.sampleSize.toLocaleString()} genuine ticks, digit <b>{prediction.entryDigit}</b> was followed by
                        digit <b>{prediction.nextDigit}</b> more frequently than other successors.
                        {backup && <> Second: <b>{backup.digit}</b> ({backup.count} occurrences).</>}
                    </p>
                    <div className='digit-analyzer__next-scores' role='group' aria-label='Observed next-digit transition shares'>
                        {prediction.candidates.slice().sort((a, b) => a.digit - b.digit).map(item => (
                            <div key={item.digit} className={item.digit === prediction.nextDigit
                                ? 'digit-analyzer__next-score digit-analyzer__next-score--leader'
                                : 'digit-analyzer__next-score'}
                                aria-label={`Digit ${item.digit}, ${item.count} observed next transitions`}>
                                <strong>{item.digit}</strong>
                                <span>{item.observedShare.toFixed(1)}%</span>
                                {item.digit === prediction.nextDigit && <small>TOP OBSERVED</small>}
                            </div>
                        ))}
                    </div>
                </>
            )}
            <p className='digit-analyzer__next-disclaimer'>
                These are measured conditional frequencies, not estimated match-win probabilities.
                The next live tick can be any digit; trading may lose your entire stake.
            </p>
        </section>
    );
};
export default NextDigitPredictionPanel;

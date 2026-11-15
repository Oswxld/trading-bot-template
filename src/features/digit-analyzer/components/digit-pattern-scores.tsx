import type { DigitPatternScoreResult } from '../services/digit-pattern-score-model';
import type { DigitPatternLeaderResult } from '../services/digit-pattern-leaders';

type DigitPatternScoresProps = {
    scores: DigitPatternScoreResult | null;
    leaders: DigitPatternLeaderResult | null;
    isLoading?: boolean;
};

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

/**
 * Pure, presentational 0–9 pattern score panel.
 *
 * "Top" means highest historical pattern-strength index, NEVER the next
 * predicted digit. Co-leaders are equally highlighted rather than giving
 * one digit an unjustified advantage. No real score before 100 observations.
 */
const DigitPatternScores = ({ scores, leaders, isLoading = false }: DigitPatternScoresProps) => {
    const ready = !isLoading && scores?.status === 'ready' && leaders?.status === 'ready' &&
        scores.symbol === leaders.symbol && scores.observedTicks === leaders.observedTicks;
    const topDigits = ready ? leaders.leaderDigits : [];
    const tied = ready && leaders.isTie;
    const observed = scores?.observedTicks ?? 0;
    const needsMore = !isLoading && scores?.status === 'insufficient-data';

    return (
        <section
            className='digit-analyzer__panel digit-analyzer__panel--patterns'
            aria-label='Digit pattern scores'
        >
            <div className='digit-analyzer__panel-heading'>
                <div>
                    <h3 className='digit-analyzer__panel-title'>Digit pattern scores</h3>
                    <p className='digit-analyzer__panel-description'>
                        Historical frequency (40%), recent frequency (35%) and frequency trend (25%).
                    </p>
                </div>
                <span className='digit-analyzer__panel-chip'>0–100 points</span>
            </div>

            <div className='digit-analyzer__pattern-grid' role='group' aria-label='Pattern scores for digits 0 to 9'>
                {DIGITS.map(digit => {
                    const score = ready ? scores.scores[digit]?.score : undefined;
                    const hasScore = typeof score === 'number' && Number.isFinite(score);
                    const isLeader = hasScore && topDigits.includes(digit);
                    const label = hasScore
                        ? `Digit ${digit}: ${score.toFixed(1)} pattern points${isLeader
                            ? tied ? ', joint highest observed pattern score' : ', highest observed pattern score'
                            : ''}`
                        : `Digit ${digit}: pattern score unavailable`;

                    return (
                        <div
                            className={`digit-analyzer__pattern-digit${isLeader ? ' digit-analyzer__pattern-digit--leader' : ''}`}
                            key={digit}
                            role='group'
                            aria-label={label}
                            data-leader={isLeader ? 'true' : 'false'}
                            title={label}
                        >
                            <span className='digit-analyzer__pattern-number'>{digit}</span>
                            <strong className='digit-analyzer__pattern-points'>
                                {hasScore ? score.toFixed(1) : '—'}
                            </strong>
                            <span className='digit-analyzer__pattern-tag'>
                                {isLeader ? tied ? 'Joint top' : 'Top score' : hasScore ? 'points' : 'No score'}
                            </span>
                        </div>
                    );
                })}
            </div>

            <p className='digit-analyzer__pattern-state' role='status'>
                {isLoading
                    ? 'Loading verified market observations; scores are not available yet.'
                    : ready
                        ? `Calculated from ${observed.toLocaleString()} observed ticks. ${tied
                            ? `Joint highest score: digits ${topDigits.join(', ')}.`
                            : `Highest score: digit ${topDigits[0]}.`}`
                        : needsMore
                            ? observed === 0
                                ? 'Awaiting market data. At least 100 real ticks are needed for pattern scores.'
                                : `Collecting observations: ${observed.toLocaleString()} / 100 real ticks.`
                            : 'Pattern scores unavailable until verified market data is ready.'}
            </p>
            <p className='digit-analyzer__panel-footnote'>
                Green identifies the highest observed pattern score (or joint leaders), not a
                prediction, win probability or trading recommendation. Scores do not sum to 100%.
            </p>
        </section>
    );
};

export default DigitPatternScores;

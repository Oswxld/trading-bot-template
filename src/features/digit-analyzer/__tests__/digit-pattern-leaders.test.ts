import { DIGIT_PATTERN_SCORE_MODEL as model } from '../services/digit-pattern-score-model';
import type { DigitPatternScoreResult } from '../services/digit-pattern-score-model';
import { calculateDigitPatternScores, calculateRollingDigitPatternScores } from '../services/digit-pattern-score';
import {
    DIGIT_PATTERN_LEADER_TOLERANCE,
    detectDigitPatternLeaders,
    detectRollingDigitPatternLeaders,
} from '../services/digit-pattern-leaders';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const BASE = 1770000000;
const digitTick = (
    index: number,
    digit: number,
    symbol = 'R_10',
    source: 'history' | 'live' = 'history',
    epoch = BASE + index
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${index + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const history = (count: number, symbol = 'R_10'): AnalyzerTick[] =>
    Array.from({ length: count }, (_, index) => digitTick(index, index % 10, symbol));

const uniformResult = (count = 100, symbol = 'R_10') =>
    calculateDigitPatternScores({ symbol, ticks: history(count, symbol) });

const ready = (result: DigitPatternScoreResult) => {
    if (result.status !== 'ready') throw new Error('Expected ready scores');
    return result;
};

const withScores = (result: DigitPatternScoreResult, scores: readonly number[]) => {
    const valid = ready(result);
    return {
        ...valid,
        scores: valid.scores.map((entry, digit) => ({
            ...entry, score: scores[digit],
        })),
    };
};

const rolling = (size: AnalyzerSampleSize, count: number, symbol = 'R_10') => {
    const window = new RollingTickWindow(symbol, size);
    window.replaceHistory(history(count, symbol));
    return window;
};

describe('Digit Analyzer highest-score and tie detection (Chunk 6.3)', () => {
    it('uses an explicitly documented, tiny, positive absolute tolerance', () => {
        expect(DIGIT_PATTERN_LEADER_TOLERANCE).toBe(1e-9);
        expect(Number.isFinite(DIGIT_PATTERN_LEADER_TOLERANCE)).toBe(true);
        expect(DIGIT_PATTERN_LEADER_TOLERANCE).toBeGreaterThan(0);
        expect(DIGIT_PATTERN_LEADER_TOLERANCE).toBeLessThan(0.0001);
    });

    it.each([0, 1, 17, 50, 99])(
        'returns zero leaders and no highest score below 100 observations (%i)',
        count => {
            const selected = detectDigitPatternLeaders(uniformResult(count));
            expect(selected).toEqual({
                status: 'insufficient-data',
                symbol: 'R_10',
                modelVersion: model.version,
                observedTicks: count,
                highestScore: null,
                leaderDigits: [],
                isTie: false,
            });
        }
    );

    it('recognizes that all ten digits are tied in an exactly uniform 100-tick sample', () => {
        const ranking = detectDigitPatternLeaders(uniformResult(100));
        expect(ranking.status).toBe('ready');
        expect(ranking.highestScore).toBe(50);
        expect(ranking.leaderDigits).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(ranking.isTie).toBe(true);
        expect(ranking.observedTicks).toBe(100);
    });

    it('selects digit 7 as the ONLY leader when 100 genuine observations end in 7', () => {
        const input = Array.from({ length: 100 }, (_, index) => digitTick(index, 7));
        const scored = calculateDigitPatternScores({ symbol: 'R_10', ticks: input });
        const ranking = detectDigitPatternLeaders(scored);
        expect(ranking).toEqual({
            status: 'ready',
            symbol: 'R_10',
            modelVersion: model.version,
            observedTicks: 100,
            highestScore: 87.5,
            leaderDigits: [7],
            isTie: false,
        });
    });

    it('selects digit 0 when it has the genuine top score (zero is not falsy)', () => {
        const input = Array.from({ length: 100 }, (_, index) => digitTick(index, 0));
        const result = detectDigitPatternLeaders(calculateDigitPatternScores({
            symbol: 'R_10', ticks: input,
        }));
        expect(result.leaderDigits).toEqual([0]);
        expect(result.isTie).toBe(false);
    });

    it('detects two scores that differ only by sub-nanopoint numerical noise as a tie', () => {
        const score = Array(10).fill(40);
        score[2] = 70;
        score[8] = 70 - DIGIT_PATTERN_LEADER_TOLERANCE / 2;
        score[4] = 70 - 2 * DIGIT_PATTERN_LEADER_TOLERANCE;
        const ranking = detectDigitPatternLeaders(withScores(uniformResult(), score));
        expect(ranking.leaderDigits).toEqual([2, 8]);
        expect(ranking.highestScore).toBe(70);
        expect(ranking.isTie).toBe(true);
    });

    it('does not create a false tie when two distinct scores round to the same UI label', () => {
        const score = Array(10).fill(40);
        score[0] = 72.041;
        score[5] = 72.039;
        expect(score[0].toFixed(1)).toBe(score[5].toFixed(1));
        const ranking = detectDigitPatternLeaders(withScores(uniformResult(), score));
        expect(ranking.leaderDigits).toEqual([0]);
        expect(ranking.highestScore).toBe(72.041);
        expect(ranking.isTie).toBe(false);
    });

    it('reports a three-way maximum in ascending digit order, never picking an arbitrary first', () => {
        const scores = Array(10).fill(23);
        scores[9] = 88;
        scores[1] = 88;
        scores[5] = 88;
        const ranking = detectDigitPatternLeaders(withScores(uniformResult(), scores));
        expect(ranking.leaderDigits).toEqual([1, 5, 9]);
        expect(ranking.highestScore).toBe(88);
        expect(ranking.isTie).toBe(true);
    });

    it('does not accidentally classify all non-maximum equal scores as joint leaders', () => {
        const scores = Array(10).fill(42);
        scores[6] = 42.001;
        expect(detectDigitPatternLeaders(withScores(uniformResult(), scores)).leaderDigits)
            .toEqual([6]);
    });

    it.each([100, 500, 1000] as const)(
        'works for a complete %i-tick rolling window without changing its state',
        size => {
            const window = rolling(size, size);
            const oldSnapshot = window.getSnapshot();
            const oldSnapshotJson = JSON.stringify(oldSnapshot);
            const ranking = detectRollingDigitPatternLeaders(oldSnapshot);
            expect(ranking.status).toBe('ready');
            expect(ranking.leaderDigits).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            expect(ranking.observedTicks).toBe(size);
            expect(JSON.stringify(window.getSnapshot())).toBe(oldSnapshotJson);
            expect(JSON.stringify(oldSnapshot)).toBe(oldSnapshotJson);
        }
    );

    it('updates the leader when real live ticks change the bounded rolling window', () => {
        const window = new RollingTickWindow('R_10', 100);
        window.replaceHistory(Array.from({ length: 100 }, (_, i) => digitTick(i, 7)));
        expect(detectRollingDigitPatternLeaders(window.getSnapshot()).leaderDigits).toEqual([7]);

        for (let i = 100; i < 200; i += 1) {
            expect(window.appendLive(digitTick(i, 9, 'R_10', 'live'))).toBe(true);
        }

        const snapshot = window.getSnapshot();
        expect(snapshot.count).toBe(100);
        const later = detectRollingDigitPatternLeaders(snapshot);
        expect(later.leaderDigits).toEqual([9]);
        expect(later.observedTicks).toBe(100);
        expect(later.isTie).toBe(false);
    });

    it('uses actual observations after shrinking and expanding 1000 -> 100 -> 500', () => {
        const window = rolling(1000, 1000);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const selected = detectRollingDigitPatternLeaders(window.getSnapshot());
        expect(selected.status).toBe('ready');
        expect(selected.observedTicks).toBe(100);
        expect(selected.leaderDigits).toHaveLength(10);
    });

    it('clears old-market leadership instead of presenting stale green highlights', () => {
        const window = new RollingTickWindow('R_10', 100);
        window.replaceHistory(Array.from({ length: 100 }, (_, i) => digitTick(i, 7)));
        expect(detectRollingDigitPatternLeaders(window.getSnapshot()).leaderDigits).toEqual([7]);
        window.changeMarket('R_75');
        expect(detectRollingDigitPatternLeaders(window.getSnapshot())).toEqual({
            status: 'insufficient-data',
            symbol: 'R_75',
            observedTicks: 0,
            modelVersion: model.version,
            highestScore: null,
            leaderDigits: [],
            isTie: false,
        });

        for (let i = 0; i < 100; i += 1) {
            window.appendLive(digitTick(i, 3, 'R_75', 'live'));
        }
        expect(detectRollingDigitPatternLeaders(window.getSnapshot()).leaderDigits).toEqual([3]);
    });

    it('does not double-count an overlapping history/live tick when choosing a leader', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        session.receiveLive(digitTick(99, 9, 'R_10', 'live'));
        expect(session.completeHistory(token, history(100))).toBe(true);
        const snapshot = session.snapshot();
        expect(snapshot.count).toBe(100);
        const ranking = detectRollingDigitPatternLeaders(snapshot);
        expect(ranking.status).toBe('ready');
        expect(ranking.observedTicks).toBe(100);
        expect(ranking.highestScore).toBe(50);
    });

    it('keeps the original histogram, score order and inputs unchanged', () => {
        const original = uniformResult(500);
        const previous = JSON.stringify(original);
        const first = detectDigitPatternLeaders(original);
        const second = detectDigitPatternLeaders(original);
        expect(first).toEqual(second);
        expect(first).not.toBe(second);
        expect(first.leaderDigits).not.toBe(second.leaderDigits);
        expect(JSON.stringify(original)).toBe(previous);
    });

    it('rejects inconsistent status, version, symbol and insufficient-data metadata', () => {
        const missing = uniformResult(99);
        const invalid: unknown[] = [
            null,
            { ...missing, status: 'unknown' },
            { ...missing, symbol: 'not a symbol!' },
            { ...missing, modelVersion: '0.0.0' },
            { ...missing, observedTicks: 100 },
            { ...missing, minimumRequiredTicks: 10 },
            { ...missing, scores: [50] },
        ];
        for (const result of invalid) {
            expect(() => detectDigitPatternLeaders(result as DigitPatternScoreResult)).toThrow();
        }
    });

    it('rejects incomplete, reordered, duplicated and missing digit score entries', () => {
        const full = ready(uniformResult());
        const invalid = [
            { ...full, scores: [] },
            { ...full, scores: full.scores.slice(0, 9) },
            { ...full, scores: [...full.scores, full.scores[0]] },
            { ...full, scores: [full.scores[1], full.scores[0], ...full.scores.slice(2)] },
            { ...full, scores: full.scores.map((s, index) => ({ ...s, digit: index === 2 ? 1 : s.digit })) },
            { ...full, scores: full.scores.map((s, index) => index === 3 ? null : s) },
        ];
        for (const result of invalid) {
            expect(() => detectDigitPatternLeaders(result as DigitPatternScoreResult)).toThrow();
        }
    });

    it('rejects invalid scores, non-finite components and inconsistent count identities', () => {
        const full = ready(uniformResult());
        const tweak = (index: number, field: string, value: unknown) => ({
            ...full,
            scores: full.scores.map((entry, digit) =>
                digit === index ? { ...entry, [field]: value } : entry),
        });
        const invalid = [
            tweak(0, 'score', NaN),
            tweak(0, 'score', Infinity),
            tweak(0, 'score', -Infinity),
            tweak(0, 'score', -0.1),
            tweak(0, 'score', 100.01),
            tweak(0, 'score', '75'),
            tweak(0, 'trendComponent', NaN),
            tweak(0, 'fullFrequencyComponent', 1.5),
            tweak(0, 'recentFrequencyComponent', -1.5),
            tweak(0, 'earlierCount', 100),
            tweak(0, 'recentCount', -1),
            tweak(0, 'fullCount', 0.5),
            { ...full, observedTicks: 101 },
            { ...full, recentTicks: 100 },
            { ...full, earlierTicks: 75 },
        ];
        for (const result of invalid) {
            expect(() => detectDigitPatternLeaders(result as DigitPatternScoreResult)).toThrow();
        }
    });

    it('matches an independent unrounded maximum reference over 5,500 rolling live ticks', () => {
        const window = new RollingTickWindow('R_10', 1000);
        for (let i = 0; i < 5500; i += 1) {
            const digit = (i * 7 + Math.floor(i / 31)) % 10;
            window.appendLive(digitTick(i, digit, 'R_10', 'live'));

            if (i % 167 === 0 || i === 5499) {
                const scores = calculateRollingDigitPatternScores(window.getSnapshot());
                const leadership = detectDigitPatternLeaders(scores);
                if (scores.status === 'insufficient-data') {
                    expect(leadership.status).toBe('insufficient-data');
                    expect(leadership.leaderDigits).toEqual([]);
                    expect(leadership.highestScore).toBeNull();
                } else {
                    const maximum = scores.scores.reduce(
                        (value, item) => Math.max(value, item.score), -Infinity
                    );
                    const leaders = scores.scores.filter(item =>
                        maximum - item.score <= DIGIT_PATTERN_LEADER_TOLERANCE
                    ).map(item => item.digit);
                    expect(leadership.status).toBe('ready');
                    expect(leadership.highestScore).toBe(maximum);
                    expect(leadership.leaderDigits).toEqual(leaders);
                    expect(leadership.isTie).toBe(leaders.length > 1);
                    expect(leadership.observedTicks).toBe(scores.observedTicks);
                }
            }
        }
    });
});

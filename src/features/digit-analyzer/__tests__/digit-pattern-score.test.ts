import {
    DIGIT_PATTERN_SCORE_MODEL as model,
} from '../services/digit-pattern-score-model';
import type {
    DigitPatternScoreInput,
    DigitPatternScoreResult,
} from '../services/digit-pattern-score-model';
import {
    calculateDigitPatternScores,
    calculateRollingDigitPatternScores,
} from '../services/digit-pattern-score';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const BASE = 1770000000;

const tick = (
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

const ticks = (digits: number[], symbol = 'R_10'): AnalyzerTick[] =>
    digits.map((digit, i) => tick(i, digit, symbol));

const uniform = (count: number, symbol = 'R_10'): AnalyzerTick[] =>
    ticks(Array.from({ length: count }, (_, i) => i % 10), symbol);

const roll = (size: AnalyzerSampleSize, input: AnalyzerTick[]): RollingTickWindow => {
    const window = new RollingTickWindow('R_10', size);
    window.replaceHistory(input);
    return window;
};

const ready = (result: DigitPatternScoreResult) => {
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected ready pattern score');
    return result;
};

/** Independent reference for the published v1.0.0 mathematical specification. */
const independentReference = (input: readonly AnalyzerTick[]) => {
    const n = input.length;
    const r = Math.min(100, Math.floor(n / 2));
    const e = n - r;
    const earlier = input.slice(0, e);
    const recent = input.slice(e);
    return Array.from({ length: 10 }, (_, digit) => {
        const count = (sample: readonly AnalyzerTick[]) =>
            sample.filter(item => item.digit === digit).length;
        const z = (difference: number, variance: number) =>
            Math.max(-1, Math.min(1, difference / Math.sqrt(variance) / 3));
        const p = 0.1;
        const full = count(input);
        const recentCount = count(recent);
        const earlierCount = count(earlier);
        const a = z(full / n - p, p * (1 - p) / n);
        const b = z(recentCount / r - p, p * (1 - p) / r);
        const c = z(
            recentCount / r - earlierCount / e,
            p * (1 - p) * (1 / r + 1 / e)
        );
        return {
            digit, fullCount: full, recentCount, earlierCount,
            fullFrequencyComponent: a,
            recentFrequencyComponent: b,
            trendComponent: c,
            score: Math.max(0, Math.min(100, 50 + 50 * (0.4 * a + 0.35 * b + 0.25 * c))),
        };
    });
};

const expectMatchesReference = (input: readonly AnalyzerTick[], symbol = 'R_10') => {
    const calculated = ready(calculateDigitPatternScores({ symbol, ticks: input }));
    const independent = independentReference(input);
    expect(calculated.scores).toHaveLength(10);
    expect(calculated.scores.map(item => item.digit))
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(calculated.observedTicks).toBe(input.length);
    expect(calculated.recentTicks + calculated.earlierTicks).toBe(input.length);

    calculated.scores.forEach((score, digit) => {
        expect(score.fullCount).toBe(independent[digit].fullCount);
        expect(score.recentCount).toBe(independent[digit].recentCount);
        expect(score.earlierCount).toBe(independent[digit].earlierCount);
        expect(score.recentCount + score.earlierCount).toBe(score.fullCount);
        expect(score.fullFrequencyComponent).toBeCloseTo(independent[digit].fullFrequencyComponent, 12);
        expect(score.recentFrequencyComponent).toBeCloseTo(independent[digit].recentFrequencyComponent, 12);
        expect(score.trendComponent).toBeCloseTo(independent[digit].trendComponent, 12);
        expect(score.score).toBeCloseTo(independent[digit].score, 10);
        expect(score.score).toBeGreaterThanOrEqual(0);
        expect(score.score).toBeLessThanOrEqual(100);
        expect(Number.isFinite(score.score)).toBe(true);
        for (const component of [
            score.fullFrequencyComponent,
            score.recentFrequencyComponent,
            score.trendComponent,
        ]) {
            expect(Number.isFinite(component)).toBe(true);
            expect(component).toBeGreaterThanOrEqual(-1);
            expect(component).toBeLessThanOrEqual(1);
        }
    });
};

describe('Digit Analyzer pattern score calculation engine (Chunk 6.2)', () => {
    it.each([0, 1, 17, 50, 99])(
        'returns NO scores for only %i actual observations',
        count => {
            const result = calculateDigitPatternScores({
                symbol: 'R_10',
                ticks: uniform(count),
            });
            expect(result).toEqual({
                status: 'insufficient-data',
                modelVersion: model.version,
                symbol: 'R_10',
                observedTicks: count,
                minimumRequiredTicks: 100,
                scores: [],
            });
        }
    );

    it.each([100, 500, 1000] as const)(
        'returns exactly 50.0 neutral index for each digit in a uniform %i-tick sample',
        size => {
            const result = ready(calculateDigitPatternScores({
                symbol: 'R_10', ticks: uniform(size),
            }));
            expect(result.scores.map(item => item.score)).toEqual(Array(10).fill(50));
            expect(result.scores.reduce((sum, item) => sum + item.score, 0)).toBe(500);
            expect(result.scores.every(item => item.fullFrequencyComponent === 0 &&
                item.recentFrequencyComponent === 0 && item.trendComponent === 0)).toBe(true);
            expect(result.modelVersion).toBe('1.0.0');
            expect(result.symbol).toBe('R_10');
            expect(result.observedTicks).toBe(size);
            expect(result.recentTicks).toBe(size === 100 ? 50 : 100);
            expect(result.earlierTicks).toBe(size - result.recentTicks);
        }
    );

    it('starts producing 10 scores at exactly 100 ticks, not before', () => {
        const input = uniform(100);
        expect(calculateDigitPatternScores({ symbol: 'R_10', ticks: input.slice(0, 99) }).status)
            .toBe('insufficient-data');
        expect(calculateDigitPatternScores({ symbol: 'R_10', ticks: input }).status)
            .toBe('ready');
    });

    it('uses the last 50 of 100 ticks for the recent signal, disjoint from earlier ticks', () => {
        const digits = [...Array(50).fill(0), ...Array(50).fill(9)];
        const result = ready(calculateDigitPatternScores({
            symbol: 'R_10', ticks: ticks(digits),
        }));
        expect(result.recentTicks).toBe(50);
        expect(result.earlierTicks).toBe(50);
        const nine = result.scores[9];
        expect(nine.fullCount).toBe(50);
        expect(nine.recentCount).toBe(50);
        expect(nine.earlierCount).toBe(0);
        expect(nine.fullFrequencyComponent).toBe(1);
        expect(nine.recentFrequencyComponent).toBe(1);
        expect(nine.trendComponent).toBe(1);
        expect(nine.score).toBe(100);
        expectMatchesReference(ticks(digits));
    });

    it('clips standardized deviations without implying 100% match probability', () => {
        const input = ticks(Array(100).fill(7));
        const result = ready(calculateDigitPatternScores({ symbol: 'R_10', ticks: input }));
        expect(result.scores[7].fullFrequencyComponent).toBe(1);
        expect(result.scores[7].recentFrequencyComponent).toBe(1);
        expect(result.scores[7].trendComponent).toBe(0);
        expect(result.scores[7].score).toBe(87.5);
        expect(result.scores[7].score).not.toBe(100);
        expectMatchesReference(input);
    });

    it('uses unrounded components and scores even when the displayed label will be rounded', () => {
        const input = ticks(Array.from({ length: 101 }, (_, i) => i % 7));
        const result = ready(calculateDigitPatternScores({ symbol: 'R_10', ticks: input }));
        expect(result.recentTicks).toBe(50);
        expect(result.earlierTicks).toBe(51);
        expect(result.scores.some(item =>
            !Number.isInteger(item.score * 10))).toBe(true);
        expectMatchesReference(input);
    });

    it('counts normalized trailing-zero ticks as digit zero and distinct same-second ticks separately', () => {
        const input = uniform(100);
        const repeated = tick(100, 0, 'R_10', 'live', input[99].epoch);
        repeated.quote = '123.450';
        const alsoRepeated = tick(101, 0, 'R_10', 'live', input[99].epoch);
        alsoRepeated.quote = '123.450';
        expectMatchesReference([...input, repeated, alsoRepeated]);
    });

    it.each([100, 500, 1000] as const)(
        'agrees with an independent mathematical implementation for a %i-tick non-uniform sample',
        size => {
            const digits = Array.from({ length: size }, (_, i) =>
                i < size / 3 ? (i % 5) : (i * 7 + 3) % 10
            );
            expectMatchesReference(ticks(digits));
        }
    );

    it('uses actual rolling observations, never pretends a 500-window contains 500 ticks', () => {
        const snapshot = roll(500, uniform(17)).getSnapshot();
        expect(calculateRollingDigitPatternScores(snapshot)).toEqual({
            status: 'insufficient-data',
            modelVersion: '1.0.0',
            symbol: 'R_10',
            observedTicks: 17,
            minimumRequiredTicks: 100,
            scores: [],
        });
    });

    it('recalculates from the current 100-tick window after live rollover and resize', () => {
        const window = roll(1000, uniform(1000));
        expectMatchesReference(window.getSnapshot().ticks);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const first = ready(calculateRollingDigitPatternScores(window.getSnapshot()));
        expect(first.observedTicks).toBe(100);
        expect(first.scores).toHaveLength(10);
        for (let i = 1000; i < 1125; i += 1) {
            expect(window.appendLive(tick(i, i % 4, 'R_10', 'live'))).toBe(true);
        }
        const snapshot = window.getSnapshot();
        expect(snapshot.count).toBe(225);
        expectMatchesReference(snapshot.ticks);
        expect(ready(calculateRollingDigitPatternScores(snapshot)).recentTicks).toBe(100);
    });

    it('uses validated synchronized historical+live ticks without double-counting overlap', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        expect(session.receiveLive(tick(99, 9, 'R_10', 'live'))).toBe(true);
        expect(session.completeHistory(token, uniform(100))).toBe(true);
        expect(session.snapshot().count).toBe(100);
        expectMatchesReference(session.snapshot().ticks);
        session.receiveLive(tick(100, 7, 'R_10', 'live'));
        expectMatchesReference(session.snapshot().ticks);
    });

    it('clears all scores when a market switch drops the prior sample', () => {
        const window = roll(100, uniform(100));
        expect(calculateRollingDigitPatternScores(window.getSnapshot()).status).toBe('ready');
        window.changeMarket('R_75');
        const blank = calculateRollingDigitPatternScores(window.getSnapshot());
        expect(blank.status).toBe('insufficient-data');
        expect(blank.symbol).toBe('R_75');
        expect(blank.scores).toHaveLength(0);
        for (let i = 0; i < 100; i += 1) {
            expect(window.appendLive(tick(i, 7, 'R_75', 'live'))).toBe(true);
        }
        const newResult = ready(calculateRollingDigitPatternScores(window.getSnapshot()));
        expect(newResult.symbol).toBe('R_75');
        expect(newResult.scores[7].fullCount).toBe(100);
        expect(newResult.scores[0].fullCount).toBe(0);
    });

    it('does not mutate the input or share mutable scores across calculations', () => {
        const input = ticks(Array.from({ length: 117 }, (_, i) => (i * 3 + 1) % 10));
        const initial = JSON.stringify(input);
        const a = ready(calculateDigitPatternScores({ symbol: 'R_10', ticks: input }));
        const b = ready(calculateDigitPatternScores({ symbol: 'R_10', ticks: input }));
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(a.scores).not.toBe(b.scores);
        expect(a.scores[0]).not.toBe(b.scores[0]);
        expect(JSON.stringify(input)).toBe(initial);
    });

    it('rejects malformed source container and cross-symbol ticks even under the sample minimum', () => {
        const inputs: unknown[] = [
            null,
            { symbol: '', ticks: [] },
            { symbol: 'R_10', ticks: null },
            { symbol: 'R_10', ticks: {} },
            { symbol: 'R_10', ticks: [tick(0, 1, 'R_75')] },
            { symbol: 'R_10', ticks: [{ ...tick(0, 1), quote: '12.34' }] },
            { symbol: 'R_10', ticks: [{ ...tick(0, 1), digit: 15 }] },
        ];
        for (const input of inputs) {
            expect(() => calculateDigitPatternScores(input as DigitPatternScoreInput)).toThrow();
        }
    });

    it('rejects duplicates, out-of-order epochs, invalid identities and timestamps', () => {
        const first = tick(0, 1);
        const second = tick(1, 7);
        const bad = [
            [first, first],
            [second, first],
            [{ ...first, id: 'history:R_10:1770000001:1' }],
            [{ ...first, id: 'history:R_75:1770000000:1' }],
            [{ ...first, id: 'history:R_10:1:1' }],
            [{ ...first, id: 'history:R_10:1770000000:0' }],
            [{ ...first, id: 'history:R_10:1770000000:garbage' }],
            [{ ...first, epoch: 0 }],
            [{ ...first, epoch: NaN }],
        ];
        for (const sample of bad) {
            expect(() => calculateDigitPatternScores({ symbol: 'R_10', ticks: sample }))
                .toThrow();
        }
    });

    it('refuses inconsistent rolling snapshot counts, last tick, capacity and metadata', () => {
        const original = roll(100, uniform(100)).getSnapshot();
        const malformed = [
            { ...original, count: 101 },
            { ...original, count: 99 },
            { ...original, remaining: 5 },
            { ...original, isFull: false },
            { ...original, latestTick: null },
            { ...original, latestTick: { ...original.latestTick, quote: '99.99' } },
            { ...original, windowSize: 250 },
            { ...original, symbol: 'R_75' },
        ];
        for (const value of malformed) {
            expect(() => calculateRollingDigitPatternScores(
                value as typeof original
            )).toThrow();
        }
    });

    it('rejects corrupt middle ticks even when the first 100 are otherwise legitimate', () => {
        const sample = uniform(500);
        sample[201] = { ...sample[201], quote: 'bad quote' };
        expect(() => calculateDigitPatternScores({ symbol: 'R_10', ticks: sample }))
            .toThrow('Invalid normalized tick');
    });

    it('stays consistent with a naive reference across 3,500 deterministic rolling ticks', () => {
        const window = new RollingTickWindow('R_10', 1000);
        for (let i = 0; i < 3500; i += 1) {
            const digit = ((i * 17 + Math.floor(i / 43)) % 10);
            expect(window.appendLive(tick(i, digit, 'R_10', 'live'))).toBe(true);
            if (i % 127 === 0 || i === 3499) {
                const snapshot = window.getSnapshot();
                const result = calculateRollingDigitPatternScores(snapshot);
                if (snapshot.count < 100) {
                    expect(result.status).toBe('insufficient-data');
                } else {
                    expectMatchesReference(snapshot.ticks);
                    expect(ready(result).scores).toHaveLength(10);
                }
            }
        }
    });
});

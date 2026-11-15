import { evaluateDigitPatternWalkForward } from '../services/digit-pattern-walkforward';
import { calculateDigitPatternScores } from '../services/digit-pattern-score';
import { detectDigitPatternLeaders } from '../services/digit-pattern-leaders';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const firstEpoch = 1770000000;
const makeTicks = (digits: readonly number[], symbol = 'R_10'): AnalyzerTick[] =>
    digits.map((digit, index) => ({
        id: `history:${symbol}:${firstEpoch + index}:${index + 1}`,
        epoch: firstEpoch + index,
        quote: `123.45${digit}`,
        digit,
    }));

const cyclic = (count: number, symbol = 'R_10') =>
    makeTicks(Array.from({ length: count }, (_, i) => i % 10), symbol);

const ready = (result: ReturnType<typeof evaluateDigitPatternWalkForward>) => {
    if (result.status !== 'evaluated') throw new Error('Expected evaluable held-out ticks');
    return result;
};

describe('Digit pattern score chronological walk-forward evaluation (Chunk 6.5)', () => {
    it.each([100, 500, 1000] as const)(
        'requires %i full past ticks AND at least one unseen future tick',
        size => {
            for (const count of [0, 17, 99, size]) {
                const result = evaluateDigitPatternWalkForward('R_10', cyclic(count), size);
                expect(result).toEqual({
                    status: 'insufficient-holdout',
                    symbol: 'R_10',
                    windowSize: size,
                    totalTicks: count,
                    minimumRequiredTicks: size + 1,
                    modelVersion: '1.0.0',
                    evaluatedTicks: 0,
                    model: null,
                    frequencyBaseline: null,
                    holdouts: [],
                });
            }
            const result = ready(evaluateDigitPatternWalkForward(
                'R_10', cyclic(size + 1), size
            ));
            expect(result.evaluatedTicks).toBe(1);
            expect(result.holdouts[0].observedIndex).toBe(size);
        }
    );

    it('uses ONLY the past for every next-tick forecast (no future data leakage)', () => {
        const input = cyclic(160);
        const evaluation = ready(evaluateDigitPatternWalkForward('R_10', input, 100));
        expect(evaluation.holdouts[0].observedIndex).toBe(100);
        const fromExactlyPast = detectDigitPatternLeaders(
            calculateDigitPatternScores({ symbol: 'R_10', ticks: input.slice(0, 100) })
        );
        expect(evaluation.holdouts[0].modelLeaders).toEqual(fromExactlyPast.leaderDigits);
        expect(evaluation.holdouts[0].actualDigit).toBe(input[100].digit);
        expect(evaluation.holdouts.every(entry => entry.observedIndex >= 100)).toBe(true);
        expect(evaluation.holdouts.at(-1)?.observedIndex).toBe(159);
    });

    it('changing a held-out tick cannot alter the ranking formed BEFORE seeing it', () => {
        const before = cyclic(180);
        const changed = makeTicks(before.map((tick, i) =>
            i === 145 ? 9 : tick.digit
        ));
        const a = ready(evaluateDigitPatternWalkForward('R_10', before, 100));
        const b = ready(evaluateDigitPatternWalkForward('R_10', changed, 100));
        expect(a.holdouts.slice(0, 45)).toEqual(b.holdouts.slice(0, 45));
        expect(a.holdouts[45].modelLeaders).toEqual(b.holdouts[45].modelLeaders);
        expect(a.holdouts[45].frequencyLeaders).toEqual(b.holdouts[45].frequencyLeaders);
        expect(a.holdouts[45].actualDigit).toBe(5);
        expect(b.holdouts[45].actualDigit).toBe(9);
        // Later windows may legitimately include the now-observed changed tick.
    });

    it('full uniform samples with ten tied leaders earn 0.1, NEVER a fabricated 100% hit rate', () => {
        const result = ready(evaluateDigitPatternWalkForward('R_10', cyclic(1100), 100));
        expect(result.evaluatedTicks).toBe(1000);
        expect(result.model.creditedHitRate).toBeCloseTo(0.1, 12);
        expect(result.frequencyBaseline.creditedHitRate).toBeCloseTo(0.1, 12);
        expect(result.model.uniquePicks).toBe(0);
        expect(result.model.uniqueHitRate).toBeNull();
        expect(result.frequencyBaseline.uniqueHitRate).toBeNull();
        expect(result.model.tiedPicks).toBe(1000);
        expect(result.frequencyBaseline.tiedPicks).toBe(1000);
        expect(result.holdouts.every(x =>
            x.modelLeaders.length === 10 && x.modelCredit === 0.1
        )).toBe(true);
        expect(result.modelVsBaselinePercentagePoints).toBeCloseTo(0, 12);
    });

    it('a contrived constant-digit stream is correctly scored but NOT evidence of market edge', () => {
        const data = makeTicks(Array(350).fill(7));
        const result = ready(evaluateDigitPatternWalkForward('R_10', data, 100));
        expect(result.evaluatedTicks).toBe(250);
        expect(result.model.uniquePicks).toBe(250);
        expect(result.model.uniqueHits).toBe(250);
        expect(result.model.uniqueHitRate).toBe(1);
        expect(result.model.creditedHitRate).toBe(1);
        expect(result.frequencyBaseline.creditedHitRate).toBe(1);
        expect(result.holdouts.every(t =>
            t.modelLeaders.length === 1 && t.modelLeaders[0] === 7
        )).toBe(true);
        expect(result.modelVsBaselinePercentagePoints).toBe(0);
    });

    it.each([100, 500, 1000] as const)(
        'evaluates exactly N-%i future ticks without training on them',
        size => {
            const result = ready(evaluateDigitPatternWalkForward('R_10', cyclic(1200), size));
            expect(result.evaluatedTicks).toBe(1200 - size);
            expect(result.holdouts[0].observedIndex).toBe(size);
            expect(result.holdouts.at(-1)?.observedIndex).toBe(1199);
            expect(result.model.uniquePicks + result.model.tiedPicks).toBe(result.evaluatedTicks);
            expect(result.frequencyBaseline.uniquePicks + result.frequencyBaseline.tiedPicks)
                .toBe(result.evaluatedTicks);
            expect(result.model.creditedHitRate).toBeGreaterThanOrEqual(0);
            expect(result.model.creditedHitRate).toBeLessThanOrEqual(1);
            expect(result.frequencyBaseline.creditedHitRate).toBeGreaterThanOrEqual(0);
            expect(result.frequencyBaseline.creditedHitRate).toBeLessThanOrEqual(1);
        }
    );

    it('never inflates model accuracy by comparing it with a different time range', () => {
        const digits = Array.from({ length: 350 }, (_, i) =>
            i % 27 === 0 ? 7 : (i * 3 + Math.floor(i / 9)) % 10
        );
        const data = makeTicks(digits);
        const result = ready(evaluateDigitPatternWalkForward('R_10', data, 100));
        expect(result.evaluatedTicks).toBe(result.holdouts.length);
        let sumModel = 0;
        let sumBaseline = 0;
        for (const h of result.holdouts) {
            const past = data.slice(h.observedIndex - 100, h.observedIndex);
            const future = data[h.observedIndex].digit;
            const freq = Array.from({ length: 10 }, (_, d) =>
                past.filter(tick => tick.digit === d).length
            );
            const max = Math.max(...freq);
            const expectedBaseline = freq.flatMap((count, d) => count === max ? [d] : []);
            expect(h.frequencyLeaders).toEqual(expectedBaseline);
            expect(h.frequencyCredit).toBe(expectedBaseline.includes(future)
                ? 1 / expectedBaseline.length : 0);
            expect(h.modelCredit).toBe(h.modelLeaders.includes(future)
                ? 1 / h.modelLeaders.length : 0);
            sumModel += h.modelCredit;
            sumBaseline += h.frequencyCredit;
        }
        expect(result.model.creditedHits).toBeCloseTo(sumModel, 12);
        expect(result.frequencyBaseline.creditedHits).toBeCloseTo(sumBaseline, 12);
        expect(result.modelVsBaselinePercentagePoints).toBeCloseTo(
            (sumModel - sumBaseline) * 100 / result.evaluatedTicks, 12
        );
    });

    it('keeps actual last-digit precision and allows true same-second distinct IDs', () => {
        const data = cyclic(101);
        const sameSecond = { ...data[100], id: 'R_10:1770000099:999', epoch: firstEpoch + 99, quote: '123.450', digit: 0 };
        data[100] = sameSecond;
        const result = ready(evaluateDigitPatternWalkForward('R_10', data, 100));
        expect(result.holdouts[0].actualDigit).toBe(0);
        expect(result.holdouts[0].observedEpoch).toBe(firstEpoch + 99);
    });

    it('never mutates verified input ticks while evaluating or storing trace', () => {
        const input = cyclic(222);
        const json = JSON.stringify(input);
        const a = evaluateDigitPatternWalkForward('R_10', input, 100);
        const b = evaluateDigitPatternWalkForward('R_10', input, 100);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(JSON.stringify(input)).toBe(json);
    });

    it('rejects an invalid window size, cross-market data, duplicates or out-of-order ticks', () => {
        const original = cyclic(110);
        const cases: Array<{ symbol: string; ticks: AnalyzerTick[]; size: AnalyzerSampleSize }> = [
            { symbol: 'R_10', ticks: original, size: 250 as AnalyzerSampleSize },
            { symbol: '', ticks: original, size: 100 },
            { symbol: 'R_75', ticks: original, size: 100 },
            { symbol: 'R_10', ticks: [original[0], original[0]], size: 100 },
            { symbol: 'R_10', ticks: [original[1], original[0]], size: 100 },
            { symbol: 'R_10', ticks: [{ ...original[0], digit: -1 }], size: 100 },
            { symbol: 'R_10', ticks: [{ ...original[0], quote: 'not a price' }], size: 100 },
            { symbol: 'R_10', ticks: [{ ...original[0], id: 'history:R_75:1770000000:1' }], size: 100 },
            { symbol: 'R_10', ticks: [{ ...original[0], epoch: Number.NaN }], size: 100 },
        ];
        for (const input of cases) {
            expect(() => evaluateDigitPatternWalkForward(
                input.symbol, input.ticks, input.size
            )).toThrow();
        }
    });

    it('runs 2000 held-out observations and returns fair, finite empirical rates', () => {
        const input = makeTicks(Array.from({ length: 2100 }, (_, i) =>
            (i * 7 + Math.floor(i / 19) * 3) % 10
        ));
        const result = ready(evaluateDigitPatternWalkForward('R_10', input, 100));
        expect(result.evaluatedTicks).toBe(2000);
        expect(result.holdouts).toHaveLength(2000);
        expect(result.model.creditedHits).toBeGreaterThanOrEqual(0);
        expect(result.model.creditedHits).toBeLessThanOrEqual(result.evaluatedTicks);
        expect(result.frequencyBaseline.creditedHits).toBeGreaterThanOrEqual(0);
        expect(result.frequencyBaseline.creditedHits).toBeLessThanOrEqual(result.evaluatedTicks);
        expect(Number.isFinite(result.modelVsBaselinePercentagePoints)).toBe(true);
        expect(result.modelVersion).toBe('1.0.0');
        expect(result.uniformReferenceRate).toBe(0.1);
    }, 120_000);
});

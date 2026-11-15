import { countDigitFrequencies } from '../services/digit-frequency';
import type { DigitFrequencyResult } from '../services/digit-frequency';
import {
    calculateDigitPercentages,
    calculateRollingDigitPercentages,
} from '../services/digit-percentages';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const makeTick = (
    index: number,
    digit: number,
    source: 'live' | 'history' = 'history',
    symbol = 'R_10',
    epoch = 1770000000 + index
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${index + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const makeWindow = (capacity: AnalyzerSampleSize, count: number) => {
    const window = new RollingTickWindow('R_10', capacity);
    window.replaceHistory(
        Array.from({ length: count }, (_, index) => makeTick(index, index % 10))
    );
    return window;
};

describe('Digit Analyzer observed percentage distribution (Chunk 5.2)', () => {
    it('returns ten 0% values and hasData=false without inventing observations', () => {
        const result = calculateDigitPercentages(countDigitFrequencies([]));
        expect(result).toEqual({
            counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            totalTicks: 0,
            percentages: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            hasData: false,
        });
    });

    it('computes the example 145 / 1000 = 14.5% without rounding underlying data', () => {
        const window = new RollingTickWindow('R_10', 1000);
        window.replaceHistory(Array.from({ length: 1000 }, (_, i) =>
            makeTick(i, i < 145 ? 7 : 2)
        ));
        const result = calculateRollingDigitPercentages(window.getSnapshot());
        expect(result.totalTicks).toBe(1000);
        expect(result.counts[7]).toBe(145);
        expect(result.percentages[7]).toBe(14.5);
        expect(result.counts[2]).toBe(855);
        expect(result.percentages[2]).toBe(85.5);
        expect(result.hasData).toBe(true);
    });

    it.each([100, 500, 1000] as const)(
        'gives ten 10% shares for a complete and uniform %s-tick window',
        size => {
            const result = calculateRollingDigitPercentages(makeWindow(size, size).getSnapshot());
            expect(result.totalTicks).toBe(size);
            expect(result.counts).toEqual(Array(10).fill(size / 10));
            expect(result.percentages).toEqual(Array(10).fill(10));
            expect(result.percentages.reduce((a, b) => a + b, 0)).toBe(100);
        }
    );

    it('uses the observed count rather than the configured window capacity for partial history', () => {
        const result = calculateRollingDigitPercentages(makeWindow(500, 17).getSnapshot());
        expect(result.totalTicks).toBe(17);
        expect(result.counts).toEqual([2, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
        expect(result.percentages[0]).toBeCloseTo(200 / 17, 10);
        expect(result.percentages[9]).toBeCloseTo(100 / 17, 10);
        expect(result.percentages[0]).not.toBe(0.4); // 2 / 500 is NOT the denominator.
        expect(result.percentages.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
    });

    it('does not force a rounded 100.0% displayed total by distorting individual digit shares', () => {
        const ticks = Array.from({ length: 6 }, (_, digit) => makeTick(digit, digit));
        const result = calculateDigitPercentages(countDigitFrequencies(ticks));
        for (let digit = 0; digit < 6; digit += 1) {
            expect(result.percentages[digit]).toBeCloseTo(100 / 6, 12);
            expect(result.percentages[digit].toFixed(1)).toBe('16.7');
        }
        // A separate chart rounds labels independently; the 100.2% label sum
        // is simply rounding, not 100.2% of observations.
        expect(
            result.percentages.reduce((sum, value) => sum + Number(value.toFixed(1)), 0)
        ).toBeCloseTo(100.2, 10);
        expect(result.percentages.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
    });

    it('supports a single valid observation and a digit absent from the sample', () => {
        const result = calculateDigitPercentages(countDigitFrequencies([makeTick(0, 9)]));
        expect(result.totalTicks).toBe(1);
        expect(result.percentages[9]).toBe(100);
        expect(result.percentages.slice(0, 9)).toEqual(Array(9).fill(0));
        expect(result.hasData).toBe(true);
    });

    it('correctly updates percentages on rolling eviction while keeping a fixed denominator', () => {
        const window = makeWindow(100, 100);
        const original = calculateRollingDigitPercentages(window.getSnapshot());
        expect(original.percentages).toEqual(Array(10).fill(10));

        for (let i = 0; i < 7; i += 1) {
            window.appendLive(makeTick(100 + i, 9, 'live'));
        }
        const latest = calculateRollingDigitPercentages(window.getSnapshot());
        expect(latest.totalTicks).toBe(100);
        for (let digit = 0; digit < 7; digit += 1) expect(latest.percentages[digit]).toBe(9);
        for (let digit = 7; digit <= 8; digit += 1) expect(latest.percentages[digit]).toBe(10);
        expect(latest.percentages[9]).toBe(17);
        expect(latest.percentages.reduce((sum, value) => sum + value, 0)).toBe(100);
    });

    it('does not fabricate an expanded sample after 1000 → 100 → 500 resizing', () => {
        const window = makeWindow(1000, 1000);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const result = calculateRollingDigitPercentages(window.getSnapshot());
        expect(result.totalTicks).toBe(100);
        expect(result.percentages).toEqual(Array(10).fill(10));
        expect(result.hasData).toBe(true);
    });

    it('removes all previous market frequencies and percentages on a market switch', () => {
        const window = makeWindow(100, 100);
        window.changeMarket('R_75');
        const result = calculateRollingDigitPercentages(window.getSnapshot());
        expect(result.totalTicks).toBe(0);
        expect(result.hasData).toBe(false);
        window.appendLive(makeTick(100, 4, 'live', 'R_75'));
        const current = calculateRollingDigitPercentages(window.getSnapshot());
        expect(current.percentages[4]).toBe(100);
        expect(current.percentages[0]).toBe(0);
    });

    it('uses the synchronized history/live sample after deduplicating an overlapping observation', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const request = session.beginHistory();
        session.receiveLive(makeTick(99, 9, 'live'));
        session.completeHistory(request, Array.from({ length: 100 }, (_, i) =>
            makeTick(i, i % 10)
        ));
        const first = calculateRollingDigitPercentages(session.snapshot());
        expect(first.totalTicks).toBe(100);
        expect(first.percentages).toEqual(Array(10).fill(10));

        session.receiveLive(makeTick(100, 6, 'live'));
        const later = calculateRollingDigitPercentages(session.snapshot());
        expect(later.totalTicks).toBe(100);
        expect(later.percentages[0]).toBe(9);
        expect(later.percentages[6]).toBe(11);
    });

    it('does not mutate source counts or share mutable percentage arrays across calculations', () => {
        const frequency = countDigitFrequencies([
            makeTick(0, 0),
            makeTick(1, 1),
            makeTick(2, 1),
        ]);
        const before = JSON.stringify(frequency);
        const first = calculateDigitPercentages(frequency);
        const second = calculateDigitPercentages(frequency);
        expect(JSON.stringify(frequency)).toBe(before);
        expect(first.counts).not.toBe(frequency.counts);
        expect(first.counts).not.toBe(second.counts);
        expect(first.percentages).not.toBe(second.percentages);
        (first.percentages as unknown as number[])[1] = 0;
        (first.counts as number[])[1] = 0;
        expect(second.counts[1]).toBe(2);
        expect(second.percentages[1]).toBeCloseTo(200 / 3, 10);
    });

    it('rejects a histogram with fewer or more than exactly 10 digit bins', () => {
        for (const counts of [Array(9).fill(0), Array(11).fill(0), null, undefined]) {
            expect(() => calculateDigitPercentages({
                counts,
                totalTicks: 0,
            } as unknown as DigitFrequencyResult)).toThrow('Invalid digit frequency distribution');
        }
    });

    it('rejects non-integer, negative, infinite, NaN or unsafe frequency counts', () => {
        for (const count of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            const counts = Array(10).fill(0);
            counts[7] = count;
            expect(() => calculateDigitPercentages({
                counts,
                totalTicks: count,
            } as unknown as DigitFrequencyResult)).toThrow(/Invalid digit frequency/);
        }
    });

    it('rejects inconsistent totals rather than silently using a misleading denominator', () => {
        const countArray = [1, 2, 3, 0, 0, 0, 0, 0, 0, 0];
        for (const totalTicks of [0, 5, 7, 1000]) {
            expect(() => calculateDigitPercentages({
                counts: countArray,
                totalTicks,
            } as unknown as DigitFrequencyResult)).toThrow('do not match');
        }
    });

    it('rejects non-finite, non-integer or unsafe total counts', () => {
        for (const totalTicks of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => calculateDigitPercentages({
                counts: Array(10).fill(0),
                totalTicks,
            } as unknown as DigitFrequencyResult)).toThrow('Invalid digit frequency distribution');
        }
    });

    it('rejects precision overflow if otherwise individually valid counts exceed the safe total', () => {
        const counts = Array(10).fill(0);
        counts[0] = Number.MAX_SAFE_INTEGER;
        counts[1] = 1;
        expect(() => calculateDigitPercentages({
            counts,
            totalTicks: Number.MAX_SAFE_INTEGER,
        } as unknown as DigitFrequencyResult)).toThrow('do not match');
    });

    it('agrees with a separate reference calculation during 1500 deterministic rolling events', () => {
        const window = new RollingTickWindow('R_10', 100);
        const reference: number[] = [];
        for (let index = 0; index < 1500; index += 1) {
            const digit = (index * 3 + 8) % 10;
            window.appendLive(makeTick(index, digit, 'live'));
            reference.push(digit);
            if (reference.length > 100) reference.shift();

            if (index % 113 === 0 || index === 1499) {
                const result = calculateRollingDigitPercentages(window.getSnapshot());
                for (let digitValue = 0; digitValue <= 9; digitValue += 1) {
                    const naiveCount = reference.filter(d => d === digitValue).length;
                    expect(result.counts[digitValue]).toBe(naiveCount);
                    expect(result.percentages[digitValue])
                        .toBeCloseTo((naiveCount * 100) / reference.length, 10);
                }
                expect(result.totalTicks).toBe(reference.length);
            }
        }
    });
});

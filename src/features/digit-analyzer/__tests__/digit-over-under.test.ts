import { countDigitFrequencies } from '../services/digit-frequency';
import type { DigitFrequencyResult } from '../services/digit-frequency';
import {
    calculateDigitOverUnder,
    calculateRollingDigitOverUnder,
} from '../services/digit-over-under';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const tick = (
    sequence: number,
    digit: number,
    source: 'history' | 'live' = 'history',
    symbol = 'R_10',
    epoch = 1770000000 + sequence
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${sequence + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const history = (count: number, symbol = 'R_10'): AnalyzerTick[] =>
    Array.from({ length: count }, (_, i) => tick(i, i % 10, 'history', symbol));

const windowWith = (size: AnalyzerSampleSize, actualCount: number): RollingTickWindow => {
    const window = new RollingTickWindow('R_10', size);
    window.replaceHistory(history(actualCount));
    return window;
};

describe('Digit Analyzer Over/Under/Equal statistics (Chunk 5.4)', () => {
    it('treats Over and Under as strict comparisons and keeps equality separate', () => {
        const values = [0, 4, 5, 5, 6, 9];
        const result = calculateDigitOverUnder(
            countDigitFrequencies(values.map((digit, i) => tick(i, digit))),
            5
        );
        expect(result).toEqual({
            threshold: 5,
            over: 2,
            under: 2,
            equal: 2,
            overPercentage: 100 / 3,
            underPercentage: 100 / 3,
            equalPercentage: 100 / 3,
            totalTicks: 6,
            hasData: true,
        });
    });

    it('handles the lower boundary 0: no digit can be Under 0', () => {
        const result = calculateDigitOverUnder(countDigitFrequencies(
            [0, 0, 1, 9].map((digit, i) => tick(i, digit))
        ), 0);
        expect(result.over).toBe(2);
        expect(result.under).toBe(0);
        expect(result.equal).toBe(2);
        expect(result.overPercentage).toBe(50);
        expect(result.underPercentage).toBe(0);
        expect(result.equalPercentage).toBe(50);
    });

    it('handles the upper boundary 9: no digit can be Over 9', () => {
        const result = calculateDigitOverUnder(countDigitFrequencies(
            [0, 8, 9, 9].map((digit, i) => tick(i, digit))
        ), 9);
        expect(result.over).toBe(0);
        expect(result.under).toBe(2);
        expect(result.equal).toBe(2);
        expect(result.overPercentage).toBe(0);
        expect(result.underPercentage).toBe(50);
        expect(result.equalPercentage).toBe(50);
    });

    it('does not confuse the threshold with a digit prediction or trade signal', () => {
        const result = calculateDigitOverUnder(countDigitFrequencies([
            tick(0, 7), tick(1, 7), tick(2, 7),
        ]), 5);
        expect(result.over).toBe(3);
        expect(result.under).toBe(0);
        expect(result.equal).toBe(0);
        expect(result.overPercentage).toBe(100);
        expect(result.underPercentage).toBe(0);
        expect(result.equalPercentage).toBe(0);
    });

    it('uses all ten digits (including zero) as observed outcomes for every threshold', () => {
        const frequency = countDigitFrequencies(history(10));
        for (let threshold = 0; threshold < 10; threshold += 1) {
            const result = calculateDigitOverUnder(frequency, threshold);
            expect(result.threshold).toBe(threshold);
            expect(result.over).toBe(9 - threshold);
            expect(result.under).toBe(threshold);
            expect(result.equal).toBe(1);
            expect(result.over + result.under + result.equal).toBe(10);
            expect(result.overPercentage).toBe((9 - threshold) * 10);
            expect(result.underPercentage).toBe(threshold * 10);
            expect(result.equalPercentage).toBe(10);
        }
    });

    it.each([100, 500, 1000] as const)(
        'returns observed counts and percentages for a full %s-tick window',
        size => {
            const result = calculateRollingDigitOverUnder(
                windowWith(size, size).getSnapshot(), 5
            );
            expect(result.over).toBe(size * 0.4);
            expect(result.under).toBe(size * 0.5);
            expect(result.equal).toBe(size * 0.1);
            expect(result.overPercentage).toBe(40);
            expect(result.underPercentage).toBe(50);
            expect(result.equalPercentage).toBe(10);
            expect(result.totalTicks).toBe(size);
            expect(result.hasData).toBe(true);
        }
    );

    it('does not divide a partially filled window by the selected capacity', () => {
        const result = calculateRollingDigitOverUnder(
            windowWith(500, 17).getSnapshot(), 5
        );
        // 0..9, 0..6: Over 5 = 6,7,8,9,6 => 5; Under 5 = 0..4 twice => 10; Equal = 5 twice.
        expect(result.over).toBe(5);
        expect(result.under).toBe(10);
        expect(result.equal).toBe(2);
        expect(result.totalTicks).toBe(17);
        expect(result.overPercentage).toBeCloseTo(500 / 17, 10);
        expect(result.underPercentage).toBeCloseTo(1000 / 17, 10);
        expect(result.equalPercentage).toBeCloseTo(200 / 17, 10);
        expect(result.overPercentage + result.underPercentage + result.equalPercentage)
            .toBeCloseTo(100, 10);
    });

    it('identifies an empty rolling sample without claiming historical 0% odds', () => {
        const result = calculateRollingDigitOverUnder(
            windowWith(1000, 0).getSnapshot(), 5
        );
        expect(result).toEqual({
            threshold: 5,
            over: 0,
            under: 0,
            equal: 0,
            overPercentage: 0,
            underPercentage: 0,
            equalPercentage: 0,
            totalTicks: 0,
            hasData: false,
        });
    });

    it('preserves exact raw percentages instead of distorting independently rounded labels', () => {
        const result = calculateDigitOverUnder(countDigitFrequencies([
            tick(0, 0), tick(1, 5), tick(2, 9),
        ]), 5);
        expect(result.overPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.underPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.equalPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.overPercentage.toFixed(1)).toBe('33.3');
        expect(result.overPercentage + result.underPercentage + result.equalPercentage)
            .toBeCloseTo(100, 10);
    });

    it('recalculates instantly for a changed threshold without touching the sample', () => {
        const frequency = countDigitFrequencies(history(100));
        const original = JSON.stringify(frequency);
        const t0 = calculateDigitOverUnder(frequency, 0);
        const t5 = calculateDigitOverUnder(frequency, 5);
        const t9 = calculateDigitOverUnder(frequency, 9);
        expect([t0.over, t0.under, t0.equal]).toEqual([90, 0, 10]);
        expect([t5.over, t5.under, t5.equal]).toEqual([40, 50, 10]);
        expect([t9.over, t9.under, t9.equal]).toEqual([0, 90, 10]);
        expect(JSON.stringify(frequency)).toBe(original);
    });

    it('updates counts when old observations leave the rolling window', () => {
        const window = windowWith(100, 100);
        for (let i = 0; i < 10; i += 1) {
            // Ten fresh digits all Over 5 replace one of each digit 0..9.
            expect(window.appendLive(tick(100 + i, 9, 'live'))).toBe(true);
        }
        const result = calculateRollingDigitOverUnder(window.getSnapshot(), 5);
        expect(result.over).toBe(46);
        expect(result.under).toBe(45);
        expect(result.equal).toBe(9);
        expect(result.overPercentage).toBe(46);
        expect(result.underPercentage).toBe(45);
        expect(result.equalPercentage).toBe(9);
        expect(result.totalTicks).toBe(100);
    });

    it('keeps only genuine observations on 1000 → 100 → 500 resize', () => {
        const window = windowWith(1000, 1000);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const result = calculateRollingDigitOverUnder(window.getSnapshot(), 5);
        expect(result.totalTicks).toBe(100);
        expect(result.over).toBe(40);
        expect(result.under).toBe(50);
        expect(result.equal).toBe(10);
    });

    it('clears old market observations before reporting new symbol comparisons', () => {
        const window = windowWith(100, 100);
        window.changeMarket('R_75');
        expect(calculateRollingDigitOverUnder(window.getSnapshot(), 5).hasData).toBe(false);
        window.appendLive(tick(0, 9, 'live', 'R_75'));
        const result = calculateRollingDigitOverUnder(window.getSnapshot(), 5);
        expect(result.over).toBe(1);
        expect(result.under).toBe(0);
        expect(result.equal).toBe(0);
        expect(result.totalTicks).toBe(1);
    });

    it('counts same-second real ticks separately while ignoring repeated IDs upstream', () => {
        const window = new RollingTickWindow('R_10', 100);
        const first = tick(0, 5, 'live', 'R_10', 1770000000);
        const second = tick(1, 6, 'live', 'R_10', 1770000000);
        expect(window.appendLive(first)).toBe(true);
        expect(window.appendLive(first)).toBe(false);
        expect(window.appendLive(second)).toBe(true);
        expect(calculateRollingDigitOverUnder(window.getSnapshot(), 5)).toMatchObject({
            over: 1,
            under: 0,
            equal: 1,
            totalTicks: 2,
        });
    });

    it('uses deduplicated historical and live ticks from the synchronized window', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        session.receiveLive(tick(99, 9, 'live'));
        expect(session.completeHistory(token, history(100))).toBe(true);
        const first = calculateRollingDigitOverUnder(session.snapshot(), 5);
        expect([first.over, first.under, first.equal, first.totalTicks])
            .toEqual([40, 50, 10, 100]);

        session.receiveLive(tick(100, 6, 'live'));
        const second = calculateRollingDigitOverUnder(session.snapshot(), 5);
        expect([second.over, second.under, second.equal, second.totalTicks])
            .toEqual([41, 49, 10, 100]);
    });

    it('rejects non-integer and out-of-range thresholds before accepting statistics', () => {
        const valid = countDigitFrequencies(history(10));
        for (const threshold of [
            -1, 10, -Infinity, Infinity, NaN, 0.5, 9.5,
            null, undefined, '5', {}, [],
        ]) {
            expect(() => calculateDigitOverUnder(valid, threshold as number))
                .toThrow('threshold must be an integer from 0 through 9');
        }
    });

    it('rejects malformed ten-bin frequencies and inconsistent totals instead of fabricating results', () => {
        const good = countDigitFrequencies(history(10));
        const malformed = [
            { ...good, counts: Array(9).fill(1) },
            { ...good, counts: Array(11).fill(1) },
            { ...good, counts: Array(10).fill(1).map((x, i) => i === 1 ? -1 : x) },
            { ...good, counts: Array(10).fill(1).map((x, i) => i === 1 ? NaN : x) },
            { ...good, counts: Array(10).fill(1).map((x, i) => i === 1 ? 1.5 : x) },
            { ...good, totalTicks: 9 },
            { ...good, totalTicks: 11 },
            { ...good, totalTicks: NaN },
            { ...good, totalTicks: -1 },
        ];
        for (const item of malformed) {
            expect(() => calculateDigitOverUnder(item as DigitFrequencyResult, 5)).toThrow();
        }
        expect(() => calculateDigitOverUnder(null as unknown as DigitFrequencyResult, 5))
            .toThrow('Invalid digit frequency distribution');
    });

    it('does not mutate the supplied histogram', () => {
        const original = countDigitFrequencies(history(100));
        const copy = JSON.stringify(original);
        const a = calculateDigitOverUnder(original, 5);
        const b = calculateDigitOverUnder(original, 5);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(JSON.stringify(original)).toBe(copy);
    });

    it('matches an independent naive reference for all thresholds over 6500 rolling ticks', () => {
        const window = new RollingTickWindow('R_10', 1000);
        const observed: number[] = [];
        for (let i = 0; i < 6500; i += 1) {
            const digit = (i * 7 + 3) % 10;
            window.appendLive(tick(i, digit, 'live'));
            observed.push(digit);
            if (observed.length > 1000) observed.shift();

            if (i % 199 === 0 || i === 6499) {
                const snapshot = window.getSnapshot();
                for (let threshold = 0; threshold <= 9; threshold += 1) {
                    const over = observed.filter(d => d > threshold).length;
                    const under = observed.filter(d => d < threshold).length;
                    const equal = observed.filter(d => d === threshold).length;
                    const result = calculateRollingDigitOverUnder(snapshot, threshold);
                    expect(result.over).toBe(over);
                    expect(result.under).toBe(under);
                    expect(result.equal).toBe(equal);
                    expect(result.over + result.under + result.equal).toBe(observed.length);
                    expect(result.totalTicks).toBe(observed.length);
                    expect(result.overPercentage).toBeCloseTo(100 * over / observed.length, 10);
                    expect(result.underPercentage).toBeCloseTo(100 * under / observed.length, 10);
                    expect(result.equalPercentage).toBeCloseTo(100 * equal / observed.length, 10);
                }
            }
        }
    });
});

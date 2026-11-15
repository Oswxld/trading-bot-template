import { countDigitFrequencies } from '../services/digit-frequency';
import type { DigitFrequencyResult } from '../services/digit-frequency';
import { calculateDigitParity, calculateRollingDigitParity } from '../services/digit-parity';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const makeTick = (
    sequence: number, digit: number,
    source: 'history' | 'live' = 'history',
    symbol = 'R_10',
    epoch = 1770000000 + sequence
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${sequence + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const historicalTicks = (size: number, symbol = 'R_10'): AnalyzerTick[] =>
    Array.from({ length: size }, (_, index) => makeTick(index, index % 10, 'history', symbol));

const sampleWindow = (capacity: AnalyzerSampleSize, count: number) => {
    const window = new RollingTickWindow('R_10', capacity);
    window.replaceHistory(historicalTicks(count));
    return window;
};

describe('Digit Analyzer Even/Odd statistics (Chunk 5.3)', () => {
    it('returns empty counts, empty percentages and an explicit no-data state', () => {
        expect(calculateDigitParity(countDigitFrequencies([]))).toEqual({
            even: 0, odd: 0, evenPercentage: 0, oddPercentage: 0,
            totalTicks: 0, hasData: false,
        });
        expect(calculateRollingDigitParity(sampleWindow(1000, 0).getSnapshot()).hasData).toBe(false);
    });

    it('treats 0 as even, counting 0,2,4,6,8 against 1,3,5,7,9', () => {
        const digits = [0, 0, 2, 4, 6, 8, 1, 3, 5, 7, 9];
        const frequencies = countDigitFrequencies(
            digits.map((digit, index) => makeTick(index, digit))
        );
        const result = calculateDigitParity(frequencies);
        expect(result).toEqual({
            even: 6, odd: 5,
            evenPercentage: (6 * 100) / 11,
            oddPercentage: (5 * 100) / 11,
            totalTicks: 11, hasData: true,
        });
        expect(result.even + result.odd).toBe(result.totalTicks);
        expect(result.evenPercentage + result.oddPercentage).toBeCloseTo(100, 10);
    });

    it('correctly handles a single zero digit as 100% even, 0% odd', () => {
        expect(calculateDigitParity(countDigitFrequencies([makeTick(0, 0)]))).toEqual({
            even: 1, odd: 0, evenPercentage: 100, oddPercentage: 0,
            totalTicks: 1, hasData: true,
        });
    });

    it('correctly handles a single 9 digit as 0% even, 100% odd', () => {
        expect(calculateDigitParity(countDigitFrequencies([makeTick(0, 9)]))).toEqual({
            even: 0, odd: 1, evenPercentage: 0, oddPercentage: 100,
            totalTicks: 1, hasData: true,
        });
    });

    it.each([100, 500, 1000] as const)(
        'calculates 50/50 statistics from a uniform %s-tick sample',
        size => {
            const result = calculateRollingDigitParity(sampleWindow(size, size).getSnapshot());
            expect(result.even).toBe(size / 2);
            expect(result.odd).toBe(size / 2);
            expect(result.evenPercentage).toBe(50);
            expect(result.oddPercentage).toBe(50);
            expect(result.totalTicks).toBe(size);
            expect(result.hasData).toBe(true);
        }
    );

    it('uses actual observed ticks, not the chosen 500-tick capacity', () => {
        const result = calculateRollingDigitParity(sampleWindow(500, 17).getSnapshot());
        expect(result.even).toBe(9);
        expect(result.odd).toBe(8);
        expect(result.totalTicks).toBe(17);
        expect(result.evenPercentage).toBeCloseTo((9 * 100) / 17, 10);
        expect(result.oddPercentage).toBeCloseTo((8 * 100) / 17, 10);
        expect(result.evenPercentage).not.toBe(1.8); // 9 / 500 is incorrect.
    });

    it('does not alter underlying observed percentages to make rounded labels sum to 100%', () => {
        const data = [0, 1, 1].map((digit, index) => makeTick(index, digit));
        const result = calculateDigitParity(countDigitFrequencies(data));
        expect(result.even).toBe(1);
        expect(result.odd).toBe(2);
        expect(result.evenPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.oddPercentage).toBeCloseTo(200 / 3, 12);
        expect(result.evenPercentage.toFixed(1)).toBe('33.3');
        expect(result.oddPercentage.toFixed(1)).toBe('66.7');
        expect(result.evenPercentage + result.oddPercentage).toBeCloseTo(100, 10);
    });

    it('updates count and percentage after evicting 10 balanced ticks in a 100-tick window', () => {
        const window = sampleWindow(100, 100);
        for (let index = 0; index < 10; index += 1) {
            expect(window.appendLive(makeTick(100 + index, 0, 'live'))).toBe(true);
        }
        const result = calculateRollingDigitParity(window.getSnapshot());
        expect(result.even).toBe(55);
        expect(result.odd).toBe(45);
        expect(result.evenPercentage).toBe(55);
        expect(result.oddPercentage).toBe(45);
        expect(result.totalTicks).toBe(100);
    });

    it('does not double-count repeated tick IDs but counts real same-second ticks', () => {
        const window = new RollingTickWindow('R_10', 100);
        const first = makeTick(0, 2, 'live', 'R_10', 1770000000);
        const second = makeTick(1, 3, 'live', 'R_10', 1770000000);
        expect(window.appendLive(first)).toBe(true);
        expect(window.appendLive(first)).toBe(false);
        expect(window.appendLive(second)).toBe(true);
        expect(calculateRollingDigitParity(window.getSnapshot())).toEqual({
            even: 1, odd: 1, evenPercentage: 50, oddPercentage: 50,
            totalTicks: 2, hasData: true,
        });
    });

    it('retains only real observations after shrinking and then expanding a window', () => {
        const window = sampleWindow(1000, 1000);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const result = calculateRollingDigitParity(window.getSnapshot());
        expect(result.totalTicks).toBe(100);
        expect(result.even).toBe(50);
        expect(result.odd).toBe(50);
    });

    it('clears the previous symbol before reporting new market parity', () => {
        const window = sampleWindow(100, 100);
        window.changeMarket('R_75');
        expect(calculateRollingDigitParity(window.getSnapshot()).hasData).toBe(false);
        window.appendLive(makeTick(0, 7, 'live', 'R_75'));
        const result = calculateRollingDigitParity(window.getSnapshot());
        expect(result).toEqual({
            even: 0, odd: 1, evenPercentage: 0, oddPercentage: 100,
            totalTicks: 1, hasData: true,
        });
    });

    it('uses one synchronized history/live sample, excluding the overlapping first live tick', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        session.receiveLive(makeTick(99, 9, 'live'));
        expect(session.completeHistory(token, historicalTicks(100))).toBe(true);
        expect(calculateRollingDigitParity(session.snapshot())).toEqual({
            even: 50, odd: 50, evenPercentage: 50, oddPercentage: 50,
            totalTicks: 100, hasData: true,
        });
        session.receiveLive(makeTick(100, 1, 'live'));
        const updated = calculateRollingDigitParity(session.snapshot());
        expect(updated.even).toBe(49);
        expect(updated.odd).toBe(51);
        expect(updated.totalTicks).toBe(100);
    });

    it('does not mutate the supplied frequency distribution', () => {
        const frequency = countDigitFrequencies([
            makeTick(0, 0), makeTick(1, 2), makeTick(2, 5),
        ]);
        const before = JSON.stringify(frequency);
        const a = calculateDigitParity(frequency);
        const b = calculateDigitParity(frequency);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(JSON.stringify(frequency)).toBe(before);
    });

    it('rejects malformed counts, missing bins and mismatched totals', () => {
        const good = countDigitFrequencies(historicalTicks(10));
        const malformed = [
            { ...good, counts: Array(9).fill(1) },
            { ...good, counts: Array(11).fill(1) },
            { ...good, counts: Array(10).fill(1).map((n, i) => i === 2 ? -1 : n) },
            { ...good, counts: Array(10).fill(1).map((n, i) => i === 2 ? 0.5 : n) },
            { ...good, counts: Array(10).fill(1).map((n, i) => i === 2 ? NaN : n) },
            { ...good, counts: Array(10).fill(1).map((n, i) => i === 2 ? Infinity : n) },
            { ...good, totalTicks: 11 },
            { ...good, totalTicks: NaN },
            { ...good, totalTicks: -1 },
        ];
        for (const invalid of malformed) {
            expect(() => calculateDigitParity(invalid as DigitFrequencyResult)).toThrow();
        }
        expect(() => calculateDigitParity(null as unknown as DigitFrequencyResult)).toThrow();
    });

    it('agrees with a naive parity reference through 6,500 deterministic rolling observations', () => {
        const window = new RollingTickWindow('R_10', 1000);
        const observed: number[] = [];

        for (let i = 0; i < 6500; i += 1) {
            const digit = (i * 7 + 3) % 10;
            window.appendLive(makeTick(i, digit, 'live'));
            observed.push(digit);
            if (observed.length > 1000) observed.shift();

            if (i % 199 === 0 || i === 6499) {
                const expectedEven = observed.filter(value => value % 2 === 0).length;
                const result = calculateRollingDigitParity(window.getSnapshot());
                expect(result.even).toBe(expectedEven);
                expect(result.odd).toBe(observed.length - expectedEven);
                expect(result.even + result.odd).toBe(result.totalTicks);
                expect(result.totalTicks).toBe(observed.length);
                expect(result.evenPercentage).toBeCloseTo((100 * expectedEven) / observed.length, 10);
                expect(result.oddPercentage).toBeCloseTo((100 * (observed.length - expectedEven)) / observed.length, 10);
            }
        }
    });
});

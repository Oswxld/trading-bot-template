import { countDigitFrequencies, countRollingDigitFrequencies } from '../services/digit-frequency';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const tick = (
    sequence: number, digit: number, symbol = 'R_10',
    source: 'live' | 'history' = 'live', epoch = 1770000000 + sequence
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${sequence + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const uniform = (count: number, source: 'live' | 'history' = 'history'): AnalyzerTick[] =>
    Array.from({ length: count }, (_, index) => tick(index, index % 10, 'R_10', source));

describe('Digit frequency engine (Chunk 5.1)', () => {
    it('produces ten zeros and zero observations when the market is empty', () => {
        expect(countDigitFrequencies([])).toEqual({
            counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            totalTicks: 0,
        });
    });

    it('counts every digit in its exact position from 0 through 9', () => {
        const data = [0, 2, 2, 7, 9, 9, 9].map((digit, i) => tick(i, digit));
        expect(countDigitFrequencies(data)).toEqual({
            counts: [1, 0, 2, 0, 0, 0, 0, 1, 0, 3],
            totalTicks: 7,
        });
    });

    it('counts trailing zeros from preserved quote precision', () => {
        const data = [
            { ...tick(0, 0), quote: '123.450' },
            { ...tick(1, 0), quote: '40.000' },
            { ...tick(2, 5), quote: '40.005' },
        ];
        expect(countDigitFrequencies(data).counts).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    });

    it.each([100, 500, 1000] as const)(
        'tallies a complete %s-tick historical sample precisely',
        (size: AnalyzerSampleSize) => {
            const window = new RollingTickWindow('R_10', size);
            window.replaceHistory(uniform(size));
            const result = countRollingDigitFrequencies(window.getSnapshot());
            expect(result.totalTicks).toBe(size);
            expect(result.counts).toEqual(Array(10).fill(size / 10));
            expect(result.counts.reduce((sum, n) => sum + n, 0)).toBe(size);
        }
    );

    it.each([100, 500, 1000] as const)(
        'removes evicted digits when a %s-tick window receives seven new ticks',
        (size: AnalyzerSampleSize) => {
            const window = new RollingTickWindow('R_10', size);
            window.replaceHistory(uniform(size));
            for (let i = 0; i < 7; i += 1) window.appendLive(tick(size + i, 9));

            const expected = Array(10).fill(size / 10);
            for (let i = 0; i < 7; i += 1) expected[i] -= 1;
            expected[9] += 7;
            const result = countRollingDigitFrequencies(window.getSnapshot());
            expect(result.totalTicks).toBe(size);
            expect(result.counts).toEqual(expected);
        }
    );

    it('counts partial samples without pretending to have the requested total', () => {
        const window = new RollingTickWindow('R_10', 500);
        window.replaceHistory(uniform(17));
        expect(countRollingDigitFrequencies(window.getSnapshot())).toEqual({
            counts: [2, 2, 2, 2, 2, 2, 2, 1, 1, 1],
            totalTicks: 17,
        });
    });

    it('counts separate same-second identical-price events without replaying a duplicate ID', () => {
        const window = new RollingTickWindow('R_10', 100);
        const first = tick(0, 8, 'R_10', 'live', 1770000000);
        const second = tick(1, 8, 'R_10', 'live', 1770000000);
        expect(window.appendLive(first)).toBe(true);
        expect(window.appendLive(first)).toBe(false);
        expect(window.appendLive(second)).toBe(true);
        expect(countRollingDigitFrequencies(window.getSnapshot())).toEqual({
            counts: [0, 0, 0, 0, 0, 0, 0, 0, 2, 0], totalTicks: 2,
        });
    });

    it('does not create 400 invented observations on 100 → 500 expansion', () => {
        const window = new RollingTickWindow('R_10', 1000);
        window.replaceHistory(uniform(1000));
        window.setWindowSize(100);
        expect(countRollingDigitFrequencies(window.getSnapshot()).counts).toEqual(Array(10).fill(10));
        window.setWindowSize(500);
        expect(countRollingDigitFrequencies(window.getSnapshot()).totalTicks).toBe(100);
        for (let i = 1000; i < 1400; i += 1) window.appendLive(tick(i, 6));
        const result = countRollingDigitFrequencies(window.getSnapshot());
        expect(result.totalTicks).toBe(500);
        expect(result.counts).toEqual([10, 10, 10, 10, 10, 10, 410, 10, 10, 10]);
    });

    it('clears all frequencies on a market switch', () => {
        const window = new RollingTickWindow('R_10', 100);
        window.replaceHistory(uniform(100));
        window.changeMarket('R_75');
        expect(countRollingDigitFrequencies(window.getSnapshot()).counts).toEqual(Array(10).fill(0));
        window.appendLive(tick(0, 4, 'R_75'));
        expect(countRollingDigitFrequencies(window.getSnapshot())).toEqual({
            counts: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0], totalTicks: 1,
        });
    });

    it('reads the synchronized historical and live sample without double-counting overlap', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const request = session.beginHistory();
        session.receiveLive(tick(99, 9));
        session.completeHistory(request, uniform(100));
        expect(countRollingDigitFrequencies(session.snapshot()).counts).toEqual(Array(10).fill(10));
        session.receiveLive(tick(100, 5));
        expect(countRollingDigitFrequencies(session.snapshot())).toEqual({
            counts: [9, 10, 10, 10, 10, 11, 10, 10, 10, 10],
            totalTicks: 100,
        });
    });

    it('does not mutate the source list or reuse count arrays across invocations', () => {
        const source = uniform(10);
        const before = JSON.stringify(source);
        const a = countDigitFrequencies(source);
        const b = countDigitFrequencies(source);
        expect(a).toEqual(b);
        expect(a.counts).not.toBe(b.counts);
        expect(JSON.stringify(source)).toBe(before);
        (a.counts as unknown as number[])[0] = 999;
        expect(b.counts[0]).toBe(1);
    });

    it('rejects missing or invalid last digits and mismatching formatted prices', () => {
        const valid = tick(0, 5);
        const invalid = [
            { ...valid, digit: -1 },
            { ...valid, digit: 10 },
            { ...valid, digit: 2.5 },
            { ...valid, digit: NaN },
            { ...valid, digit: undefined },
            { ...valid, quote: '123.450' },
            { ...valid, quote: '12e+3' },
            { ...valid, quote: '' },
            null,
        ];
        for (const entry of invalid) {
            expect(() => countDigitFrequencies([valid, entry as AnalyzerTick]))
                .toThrow('Invalid normalized tick');
        }
        expect(() => countDigitFrequencies(null as unknown as AnalyzerTick[]))
            .toThrow('Digit frequency input must be an array');
    });

    it('rejects inconsistent rolling snapshot metadata rather than emitting misleading counts', () => {
        const window = new RollingTickWindow('R_10', 100);
        window.replaceHistory(uniform(5));
        const good = window.getSnapshot();
        expect(countRollingDigitFrequencies(good).totalTicks).toBe(5);
        for (const broken of [
            { ...good, count: 6 },
            { ...good, count: -1 },
            { ...good, count: NaN },
            { ...good, windowSize: 1 as AnalyzerSampleSize },
            { ...good, ticks: null as unknown as AnalyzerTick[] },
        ]) {
            expect(() => countRollingDigitFrequencies(broken)).toThrow('Invalid rolling tick snapshot');
        }
    });

    it('matches a naive FIFO reference histogram over 6,500 deterministic live observations', () => {
        const window = new RollingTickWindow('R_10', 1000);
        const history: number[] = [];
        const reference = Array(10).fill(0);
        for (let i = 0; i < 6500; i += 1) {
            const digit = (i * 7 + 3) % 10;
            window.appendLive(tick(i, digit));
            history.push(digit);
            reference[digit] += 1;
            if (history.length > 1000) {
                const removed = history.shift();
                if (removed !== undefined) reference[removed] -= 1;
            }
            if (i % 199 === 0 || i === 6499) {
                const actual = countRollingDigitFrequencies(window.getSnapshot());
                expect(actual.counts).toEqual(reference);
                expect(actual.totalTicks).toBe(history.length);
                expect(actual.counts.reduce((sum, n) => sum + n, 0)).toBe(history.length);
            }
        }
    });
});

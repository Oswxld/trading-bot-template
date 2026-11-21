import { countDigitFrequencies } from '../services/digit-frequency';
import type { DigitFrequencyResult } from '../services/digit-frequency';
import {
    calculateDigitMatchesDiffers,
    calculateRollingDigitMatchesDiffers,
} from '../services/digit-matches-differs';
import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const tick = (
    index: number,
    digit: number,
    source: 'history' | 'live' = 'history',
    symbol = 'R_10',
    epoch = 1770000000 + index
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${index + 1}`,
    epoch,
    quote: `123.45${digit}`,
    digit,
});

const historical = (count: number, symbol = 'R_10'): AnalyzerTick[] =>
    Array.from({ length: count }, (_, index) => tick(index, index % 10, 'history', symbol));

const sample = (size: AnalyzerSampleSize, count: number): RollingTickWindow => {
    const window = new RollingTickWindow('R_10', size);
    window.replaceHistory(historical(count));
    return window;
};

describe('Digit Analyzer Matches/Differs statistics (Chunk 5.5)', () => {
    it('counts exactly the selected last digit as Matches and all others as Differs', () => {
        const digits = [7, 0, 7, 9, 5, 7, 6, 3];
        const result = calculateDigitMatchesDiffers(
            countDigitFrequencies(digits.map((digit, index) => tick(index, digit))),
            7
        );
        expect(result).toEqual({
            selectedDigit: 7,
            matches: 3,
            differs: 5,
            matchesPercentage: 37.5,
            differsPercentage: 62.5,
            totalTicks: 8,
            hasData: true,
        });
        expect(result.matches + result.differs).toBe(result.totalTicks);
    });

    it('does not treat zero as no digit and counts zero matches correctly', () => {
        const frequency = countDigitFrequencies([tick(0, 0), tick(1, 0), tick(2, 9)]);
        expect(calculateDigitMatchesDiffers(frequency, 0)).toEqual({
            selectedDigit: 0,
            matches: 2,
            differs: 1,
            matchesPercentage: 200 / 3,
            differsPercentage: 100 / 3,
            totalTicks: 3,
            hasData: true,
        });
    });

    it('handles nine as a valid selected digit and counts 0–8 as differing', () => {
        const frequency = countDigitFrequencies([tick(0, 9), tick(1, 0), tick(2, 8)]);
        const result = calculateDigitMatchesDiffers(frequency, 9);
        expect(result.matches).toBe(1);
        expect(result.differs).toBe(2);
        expect(result.matchesPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.differsPercentage).toBeCloseTo(200 / 3, 12);
    });

    it('returns zero observations and an explicit hasData=false state for an empty window', () => {
        expect(calculateRollingDigitMatchesDiffers(sample(1000, 0).getSnapshot(), 5)).toEqual({
            selectedDigit: 5,
            matches: 0,
            differs: 0,
            matchesPercentage: 0,
            differsPercentage: 0,
            totalTicks: 0,
            hasData: false,
        });
    });

    it('reports an observed 0% match rate without confusing it with the no-data state', () => {
        const result = calculateDigitMatchesDiffers(countDigitFrequencies([
            tick(0, 1), tick(1, 3), tick(2, 9),
        ]), 7);
        expect(result.matches).toBe(0);
        expect(result.differs).toBe(3);
        expect(result.matchesPercentage).toBe(0);
        expect(result.differsPercentage).toBe(100);
        expect(result.hasData).toBe(true);
    });

    it('reports a 100% match rate when all genuine observed ticks end in one digit', () => {
        const result = calculateDigitMatchesDiffers(countDigitFrequencies([
            tick(0, 4), tick(1, 4), tick(2, 4),
        ]), 4);
        expect(result.matches).toBe(3);
        expect(result.differs).toBe(0);
        expect(result.matchesPercentage).toBe(100);
        expect(result.differsPercentage).toBe(0);
        expect(result.hasData).toBe(true);
    });

    it.each([100, 500, 1000] as const)(
        'returns empirical 10% Matches and 90% Differs for a uniform %s-tick window',
        size => {
            const result = calculateRollingDigitMatchesDiffers(sample(size, size).getSnapshot(), 7);
            expect(result.selectedDigit).toBe(7);
            expect(result.matches).toBe(size / 10);
            expect(result.differs).toBe(size * 0.9);
            expect(result.matchesPercentage).toBe(10);
            expect(result.differsPercentage).toBe(90);
            expect(result.totalTicks).toBe(size);
            expect(result.hasData).toBe(true);
        }
    );

    it('uses the observed sample size, not the configured 500-tick capacity', () => {
        const result = calculateRollingDigitMatchesDiffers(sample(500, 17).getSnapshot(), 6);
        expect(result.matches).toBe(2);
        expect(result.differs).toBe(15);
        expect(result.totalTicks).toBe(17);
        expect(result.matchesPercentage).toBeCloseTo(200 / 17, 10);
        expect(result.differsPercentage).toBeCloseTo(1500 / 17, 10);
        expect(result.matchesPercentage).not.toBe(0.4);
        expect(result.matchesPercentage + result.differsPercentage).toBeCloseTo(100, 10);
    });

    it('preserves unrounded observed percentages when displayed labels must be rounded', () => {
        const result = calculateDigitMatchesDiffers(countDigitFrequencies([
            tick(0, 5), tick(1, 7), tick(2, 9),
        ]), 5);
        expect(result.matchesPercentage).toBeCloseTo(100 / 3, 12);
        expect(result.differsPercentage).toBeCloseTo(200 / 3, 12);
        expect(result.matchesPercentage.toFixed(1)).toBe('33.3');
        expect(result.differsPercentage.toFixed(1)).toBe('66.7');
        expect(result.matchesPercentage + result.differsPercentage).toBeCloseTo(100, 10);
    });

    it('computes every digit selection independently and exhaustively from the same sample', () => {
        const frequency = countDigitFrequencies(historical(10));
        const before = JSON.stringify(frequency);
        let sumMatches = 0;
        for (let selectedDigit = 0; selectedDigit < 10; selectedDigit += 1) {
            const result = calculateDigitMatchesDiffers(frequency, selectedDigit);
            expect(result.selectedDigit).toBe(selectedDigit);
            expect(result.matches).toBe(1);
            expect(result.differs).toBe(9);
            expect(result.matchesPercentage).toBe(10);
            expect(result.differsPercentage).toBe(90);
            expect(result.matches + result.differs).toBe(10);
            sumMatches += result.matches;
        }
        expect(sumMatches).toBe(10);
        expect(JSON.stringify(frequency)).toBe(before);
    });

    it('recalculates immediately when the user changes selection without modifying tick data', () => {
        const window = sample(100, 100);
        const baseline = window.getSnapshot();
        const before = JSON.stringify(baseline);
        const d0 = calculateRollingDigitMatchesDiffers(baseline, 0);
        const d5 = calculateRollingDigitMatchesDiffers(baseline, 5);
        const d9 = calculateRollingDigitMatchesDiffers(baseline, 9);
        expect([d0.matches, d5.matches, d9.matches]).toEqual([10, 10, 10]);
        expect([d0.differs, d5.differs, d9.differs]).toEqual([90, 90, 90]);
        expect(JSON.stringify(baseline)).toBe(before);
    });

    it('updates counts correctly after ten old observations are evicted', () => {
        const window = sample(100, 100);
        for (let i = 0; i < 10; i += 1) {
            expect(window.appendLive(tick(100 + i, 7, 'live'))).toBe(true);
        }
        const result = calculateRollingDigitMatchesDiffers(window.getSnapshot(), 7);
        expect(result.matches).toBe(19); // One old 7 was removed; ten 7s arrived.
        expect(result.differs).toBe(81);
        expect(result.matchesPercentage).toBe(19);
        expect(result.differsPercentage).toBe(81);
        expect(result.totalTicks).toBe(100);
    });

    it('does not fabricate more ticks after a 1000 → 100 → 500 window change', () => {
        const window = sample(1000, 1000);
        window.setWindowSize(100);
        window.setWindowSize(500);
        const result = calculateRollingDigitMatchesDiffers(window.getSnapshot(), 7);
        expect(result.totalTicks).toBe(100);
        expect(result.matches).toBe(10);
        expect(result.differs).toBe(90);
        expect(result.matchesPercentage).toBe(10);
    });

    it('never carries another market’s matches into the selected market', () => {
        const window = sample(100, 100);
        window.changeMarket('R_75');
        expect(calculateRollingDigitMatchesDiffers(window.getSnapshot(), 7).hasData).toBe(false);
        window.appendLive(tick(0, 9, 'live', 'R_75'));
        const result = calculateRollingDigitMatchesDiffers(window.getSnapshot(), 7);
        expect(result.matches).toBe(0);
        expect(result.differs).toBe(1);
        expect(result.totalTicks).toBe(1);
        expect(result.hasData).toBe(true);
        expect(calculateRollingDigitMatchesDiffers(window.getSnapshot(), 9).matches).toBe(1);
    });

    it('counts distinct same-second ticks but not an exact duplicate live tick ID', () => {
        const window = new RollingTickWindow('R_10', 100);
        const first = tick(0, 7, 'live', 'R_10', 1770000000);
        const second = tick(1, 7, 'live', 'R_10', 1770000000);
        const third = tick(2, 4, 'live', 'R_10', 1770000000);
        expect(window.appendLive(first)).toBe(true);
        expect(window.appendLive(first)).toBe(false);
        expect(window.appendLive(second)).toBe(true);
        expect(window.appendLive(third)).toBe(true);
        const result = calculateRollingDigitMatchesDiffers(window.getSnapshot(), 7);
        expect(result.matches).toBe(2);
        expect(result.differs).toBe(1);
        expect(result.totalTicks).toBe(3);
    });

    it('uses synchronized live/history ticks without double-counting their overlap', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const generation = session.beginHistory();
        session.receiveLive(tick(99, 9, 'live'));
        expect(session.completeHistory(generation, historical(100))).toBe(true);
        const result = calculateRollingDigitMatchesDiffers(session.snapshot(), 9);
        expect(result.matches).toBe(10);
        expect(result.differs).toBe(90);
        expect(result.totalTicks).toBe(100);

        session.receiveLive(tick(100, 9, 'live'));
        const updated = calculateRollingDigitMatchesDiffers(session.snapshot(), 9);
        expect(updated.matches).toBe(11);
        expect(updated.differs).toBe(89);
        expect(updated.totalTicks).toBe(100);
    });

    it('rejects every non-integer or out-of-range selected digit', () => {
        const frequency = countDigitFrequencies(historical(10));
        for (const invalid of [
            -1, 10, NaN, Infinity, -Infinity, 0.5, 9.5,
            null, undefined, '7', {}, [],
        ]) {
            expect(() => calculateDigitMatchesDiffers(frequency, invalid as number))
                .toThrow('selected digit must be an integer from 0 through 9');
        }
    });

    it('rejects malformed histograms and mismatched totals instead of producing false results', () => {
        const valid = countDigitFrequencies(historical(10));
        const bad = [
            { ...valid, counts: Array(9).fill(1) },
            { ...valid, counts: Array(11).fill(1) },
            { ...valid, counts: Array(10).fill(1).map((x, i) => i === 1 ? -1 : x) },
            { ...valid, counts: Array(10).fill(1).map((x, i) => i === 1 ? NaN : x) },
            { ...valid, counts: Array(10).fill(1).map((x, i) => i === 1 ? 0.5 : x) },
            { ...valid, totalTicks: 9 },
            { ...valid, totalTicks: 11 },
            { ...valid, totalTicks: -1 },
            { ...valid, totalTicks: NaN },
        ];
        for (const input of bad) {
            expect(() => calculateDigitMatchesDiffers(input as DigitFrequencyResult, 7))
                .toThrow();
        }
        expect(() => calculateDigitMatchesDiffers(null as unknown as DigitFrequencyResult, 7))
            .toThrow('Invalid digit frequency distribution');
    });

    it('does not mutate frequency counts or share a mutable result object between calculations', () => {
        const frequency = countDigitFrequencies(historical(17));
        const before = JSON.stringify(frequency);
        const first = calculateDigitMatchesDiffers(frequency, 7);
        const second = calculateDigitMatchesDiffers(frequency, 7);
        expect(first).toEqual(second);
        expect(first).not.toBe(second);
        expect(JSON.stringify(frequency)).toBe(before);
    });

    it('matches an independent reference for all ten selected digits across 6500 rolling ticks', () => {
        const window = new RollingTickWindow('R_10', 1000);
        const observed: number[] = [];
        for (let i = 0; i < 6500; i += 1) {
            const digit = (i * 7 + 3) % 10;
            window.appendLive(tick(i, digit, 'live'));
            observed.push(digit);
            if (observed.length > 1000) observed.shift();

            if (i % 199 === 0 || i === 6499) {
                const snapshot = window.getSnapshot();
                for (let selected = 0; selected <= 9; selected += 1) {
                    const expectedMatches = observed.filter(value => value === selected).length;
                    const result = calculateRollingDigitMatchesDiffers(snapshot, selected);
                    expect(result.matches).toBe(expectedMatches);
                    expect(result.differs).toBe(observed.length - expectedMatches);
                    expect(result.matches + result.differs).toBe(result.totalTicks);
                    expect(result.totalTicks).toBe(observed.length);
                    expect(result.matchesPercentage)
                        .toBeCloseTo((100 * expectedMatches) / observed.length, 10);
                    expect(result.differsPercentage)
                        .toBeCloseTo((100 * (observed.length - expectedMatches)) / observed.length, 10);
                }
            }
        }
    });
});

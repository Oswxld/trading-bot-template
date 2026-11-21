import { normalizeHistoricalTicks } from '../utils/normalize-history';
import { normalizeLiveTick } from '../utils/normalize-tick';
import { countDigitFrequencies, countRollingDigitFrequencies } from '../services/digit-frequency';
import { calculateDigitPercentages, calculateRollingDigitPercentages } from '../services/digit-percentages';
import { calculateDigitParity, calculateRollingDigitParity } from '../services/digit-parity';
import { calculateDigitOverUnder, calculateRollingDigitOverUnder } from '../services/digit-over-under';
import { calculateDigitMatchesDiffers, calculateRollingDigitMatchesDiffers } from '../services/digit-matches-differs';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { RollingTickSnapshot } from '../services/rolling-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const BASE = 1770000000;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const history = (count: AnalyzerSampleSize, symbol = 'R_10', first = 0): AnalyzerTick[] =>
    normalizeHistoricalTicks({
        msg_type: 'history',
        echo_req: { ticks_history: symbol, count, end: 'latest', style: 'ticks' },
        pip_size: 3,
        history: {
            prices: Array.from({ length: count }, (_, i) =>
                Number((140 + ((i + first) % 1000) / 1000).toFixed(3))),
            times: Array.from({ length: count }, (_, i) => BASE + first + i),
        },
    }, symbol, count);

const live = (index: number, symbol = 'R_10', pipSize = 3): AnalyzerTick => {
    const tick = normalizeLiveTick({
        msg_type: 'tick',
        tick: {
            symbol,
            epoch: BASE + index,
            pip_size: pipSize,
            quote: Number((140 + (index % 1000) / (10 ** pipSize)).toFixed(pipSize)),
        },
    }, symbol, index + 1);
    if (!tick) throw new Error('Regression fixture produced an invalid real-shaped live tick');
    return tick;
};

/**
 * Intentionally independent model: scans raw observations directly rather
 * than relying on the histogram used by the production calculation engines.
 * All numbers below MUST come from the same snapshot and sum to its count.
 */
const expectConsistentStatistics = (
    snapshot: RollingTickSnapshot,
    thresholds = DIGITS,
    selectedDigits = DIGITS
): void => {
    const expectedCounts = DIGITS.map(digit =>
        snapshot.ticks.filter(tick => tick.digit === digit).length
    );
    const total = snapshot.ticks.length;
    const frequencies = countRollingDigitFrequencies(snapshot);
    const percentages = calculateRollingDigitPercentages(snapshot);
    const parity = calculateRollingDigitParity(snapshot);
    const expectedEven = snapshot.ticks.filter(tick => tick.digit % 2 === 0).length;

    expect(snapshot.count).toBe(total);
    expect(snapshot.remaining).toBe(snapshot.windowSize - total);
    expect(snapshot.isFull).toBe(total === snapshot.windowSize);
    expect(frequencies.totalTicks).toBe(total);
    expect(frequencies.counts).toEqual(expectedCounts);
    expect(expectedCounts.reduce((sum, n) => sum + n, 0)).toBe(total);
    expect(percentages.counts).toEqual(expectedCounts);
    expect(percentages.hasData).toBe(total > 0);
    expect(parity.hasData).toBe(total > 0);
    expect(parity.even).toBe(expectedEven);
    expect(parity.odd).toBe(total - expectedEven);
    expect(parity.even + parity.odd).toBe(total);

    for (const digit of DIGITS) {
        expect(percentages.percentages[digit]).toBeCloseTo(
            total > 0 ? expectedCounts[digit] * 100 / total : 0, 10
        );
    }
    if (total > 0) {
        expect(percentages.percentages.reduce((sum, n) => sum + n, 0)).toBeCloseTo(100, 10);
        expect(parity.evenPercentage + parity.oddPercentage).toBeCloseTo(100, 10);
    } else {
        expect(percentages.percentages).toEqual(Array(10).fill(0));
        expect(parity.evenPercentage).toBe(0);
        expect(parity.oddPercentage).toBe(0);
    }

    for (const threshold of thresholds) {
        const result = calculateRollingDigitOverUnder(snapshot, threshold);
        const expectedOver = snapshot.ticks.filter(t => t.digit > threshold).length;
        const expectedUnder = snapshot.ticks.filter(t => t.digit < threshold).length;
        const expectedEqual = snapshot.ticks.filter(t => t.digit === threshold).length;
        expect(result.threshold).toBe(threshold);
        expect(result.over).toBe(expectedOver);
        expect(result.under).toBe(expectedUnder);
        expect(result.equal).toBe(expectedEqual);
        expect(result.totalTicks).toBe(total);
        expect(result.over + result.under + result.equal).toBe(total);
        if (total > 0) {
            expect(result.overPercentage).toBeCloseTo(expectedOver * 100 / total, 10);
            expect(result.underPercentage).toBeCloseTo(expectedUnder * 100 / total, 10);
            expect(result.equalPercentage).toBeCloseTo(expectedEqual * 100 / total, 10);
            expect(result.overPercentage + result.underPercentage + result.equalPercentage)
                .toBeCloseTo(100, 10);
        } else {
            expect(result.hasData).toBe(false);
        }
    }

    for (const selected of selectedDigits) {
        const result = calculateRollingDigitMatchesDiffers(snapshot, selected);
        const expectedMatches = snapshot.ticks.filter(t => t.digit === selected).length;
        expect(result.selectedDigit).toBe(selected);
        expect(result.matches).toBe(expectedMatches);
        expect(result.differs).toBe(total - expectedMatches);
        expect(result.matches + result.differs).toBe(total);
        expect(result.totalTicks).toBe(total);
        if (total > 0) {
            expect(result.matchesPercentage).toBeCloseTo(expectedMatches * 100 / total, 10);
            expect(result.differsPercentage).toBeCloseTo((total - expectedMatches) * 100 / total, 10);
            expect(result.matchesPercentage + result.differsPercentage).toBeCloseTo(100, 10);
        } else {
            expect(result.hasData).toBe(false);
        }
    }
};

describe('Digit Analyzer: whole-pipeline statistical regression (Chunk 5.7)', () => {
    it.each([100, 500, 1000] as const)(
        'calculates five consistent statistics from real-shaped %s historical ticks + 140 live events',
        size => {
            const session = new SynchronizedTickWindow('R_10', size);
            const generation = session.beginHistory(size);
            const samples = history(size);
            expect(session.completeHistory(generation, samples)).toBe(true);
            expectConsistentStatistics(session.snapshot());

            for (let i = size; i < size + 140; i += 1) {
                expect(session.receiveLive(live(i))).toBe(true);
                if (i % 53 === 0) expectConsistentStatistics(session.snapshot(), [0, 4, 5, 9], [0, 5, 9]);
            }
            const latest = session.snapshot();
            expect(latest.count).toBe(size);
            expect(latest.ticks[0].epoch).toBe(BASE + 140);
            expect(latest.latestTick?.epoch).toBe(BASE + size + 139);
            expectConsistentStatistics(latest);
        }
    );

    it('reconciles the history/live race and produces ONE shared sample for all five calculations', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory(100);
        const buffered = [live(98), live(99), live(100), live(101)];
        for (const tick of buffered) expect(session.receiveLive(tick)).toBe(true);
        expectConsistentStatistics(session.snapshot());

        expect(session.completeHistory(token, history(100))).toBe(true);
        const snapshot = session.snapshot();
        expect(snapshot.count).toBe(100);
        expect(snapshot.ticks[0].epoch).toBe(BASE + 2);
        expect(snapshot.latestTick?.epoch).toBe(BASE + 101);
        expect(snapshot.ticks.filter(t => t.epoch === BASE + 99)).toHaveLength(1);
        expect(snapshot.ticks.filter(t => t.epoch === BASE + 100)).toHaveLength(1);
        expectConsistentStatistics(snapshot);
    });

    it('accepts multiple distinct same-second observations and preserves trailing-zero digits', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory(100);
        const historic = history(100);
        expect(session.completeHistory(token, historic)).toBe(true);
        const t = live(100);
        const sameSecond = { ...t, id: `R_10:${t.epoch}:99999`, quote: '140.000', digit: 0 };
        expect(session.receiveLive(t)).toBe(true);
        expect(session.receiveLive(t)).toBe(false);
        expect(session.receiveLive(sameSecond)).toBe(true);
        const snapshot = session.snapshot();
        expect(snapshot.count).toBe(100);
        expect(snapshot.ticks.at(-2)?.epoch).toBe(snapshot.ticks.at(-1)?.epoch);
        expect(snapshot.latestTick?.quote).toBe('140.000');
        expectConsistentStatistics(snapshot);
    });

    it('handles 100 → 500 → 1000 → 100 reloads with obsolete history callbacks', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token100 = session.beginHistory(100);
        session.receiveLive(live(100));
        const token500 = session.beginHistory(500);
        session.receiveLive(live(101));
        const token1000 = session.beginHistory(1000);
        session.receiveLive(live(102));

        expect(session.completeHistory(token500, history(500))).toBe(false);
        expect(session.completeHistory(token100, history(100))).toBe(false);
        expect(session.completeHistory(token1000, history(1000))).toBe(true);
        expectConsistentStatistics(session.snapshot());

        const tokenSmall = session.beginHistory(100);
        expect(session.snapshot().count).toBe(100);
        expectConsistentStatistics(session.snapshot());
        const newHistory = history(100, 'R_10', 903);
        expect(session.completeHistory(tokenSmall, newHistory)).toBe(true);
        expect(session.snapshot().count).toBe(100);
        expectConsistentStatistics(session.snapshot());
    });

    it('keeps all previously verified figures intact if malformed history or a stale snapshot arrives', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const initial = session.beginHistory();
        session.completeHistory(initial, history(100));
        const initialSnapshot = session.snapshot();
        const baseline = countRollingDigitFrequencies(initialSnapshot);
        const token = session.beginHistory(100);
        const malformed = history(100);
        malformed[60] = { ...malformed[60], digit: -1 };
        expect(() => session.completeHistory(token, malformed)).toThrow('Invalid normalized tick');
        expect(session.snapshot()).toEqual(initialSnapshot);
        expect(countRollingDigitFrequencies(session.snapshot())).toEqual(baseline);
        expect(session.failHistory(token)).toBe(true);

        const stale = session.beginHistory(100);
        expect(() => session.completeHistory(stale, history(100, 'R_10', -200)))
            .toThrow('older than the current verified sample');
        expect(session.failHistory(stale)).toBe(true);
        expect(session.snapshot()).toEqual(initialSnapshot);
        expectConsistentStatistics(session.snapshot());
    });

    it('switches markets without retaining even one prior frequency or comparison', () => {
        const old = new SynchronizedTickWindow('R_10', 100);
        const oldGen = old.beginHistory();
        old.completeHistory(oldGen, history(100));
        expect(old.snapshot().count).toBe(100);

        // The hook creates a fresh session per market. Late old-market replies
        // are invalidated when the old session is disposed.
        old.dispose();
        expect(old.receiveLive(live(999))).toBe(false);
        const fresh = new SynchronizedTickWindow('R_75', 500);
        expectConsistentStatistics(fresh.snapshot());
        const newGen = fresh.beginHistory(500);
        const newHistory = history(500, 'R_75');
        expect(fresh.completeHistory(newGen, newHistory)).toBe(true);
        expect(fresh.snapshot().ticks.every(t => t.id.includes('R_75:'))).toBe(true);
        expect(fresh.snapshot().count).toBe(500);
        expectConsistentStatistics(fresh.snapshot());
        expect(old.completeHistory(oldGen, history(100))).toBe(false);
    });

    it('retains valid live-only statistical results after history failure', () => {
        const session = new SynchronizedTickWindow('R_10', 500);
        const token = session.beginHistory();
        for (let i = 0; i < 34; i += 1) session.receiveLive(live(i));
        const before = session.snapshot();
        expect(before.count).toBe(34);
        expect(session.failHistory(token)).toBe(true);
        expectConsistentStatistics(session.snapshot());
        for (let i = 34; i < 75; i += 1) session.receiveLive(live(i));
        expect(session.snapshot().count).toBe(75);
        expectConsistentStatistics(session.snapshot());
    });

    it('rejects inconsistent histogram inputs equally across ALL four derived calculations', () => {
        const valid = countDigitFrequencies(history(100));
        const corrupt = {
            counts: [99, 1, 0, 0, 0, 0, 0, 0, 0, 0] as typeof valid.counts,
            totalTicks: 99,
        };
        expect(() => calculateDigitPercentages(corrupt)).toThrow('do not match');
        expect(() => calculateDigitParity(corrupt)).toThrow('do not match');
        expect(() => calculateDigitOverUnder(corrupt, 5)).toThrow('do not match');
        expect(() => calculateDigitMatchesDiffers(corrupt, 5)).toThrow('do not match');
    });

    it('keeps all calculations referentially pure and does not mutate live/history input', () => {
        const source = history(100);
        const original = JSON.stringify(source);
        const frequency = countDigitFrequencies(source);
        const baseCounts = JSON.stringify(frequency);
        calculateDigitPercentages(frequency);
        calculateDigitParity(frequency);
        for (const digit of DIGITS) {
            calculateDigitOverUnder(frequency, digit);
            calculateDigitMatchesDiffers(frequency, digit);
        }
        expect(JSON.stringify(frequency)).toBe(baseCounts);
        expect(JSON.stringify(source)).toBe(original);
    });

    it('survives 15,000 deterministic live observations with all statistics matching a naive reference', () => {
        const session = new SynchronizedTickWindow('R_10', 1000);
        const sequence = 15000;
        let currentCapacity: AnalyzerSampleSize = 1000;
        const manuallyRetained: AnalyzerTick[] = [];

        // This reference is intentionally independent of ring-buffer operations.
        // During resizing (without history refetch) it retains only the newest
        // observations, exactly as the selected capacity dictates.
        for (let index = 0; index < sequence; index += 1) {
            if (index === 3200 || index === 8700 || index === 11200) {
                currentCapacity = index === 3200 ? 100 : index === 8700 ? 500 : 1000;
                const token = session.beginHistory(currentCapacity);
                // Resizing and a failed one-time history request leave verified
                // live observations intact, with no fictional backfill.
                expect(session.failHistory(token)).toBe(true);
                manuallyRetained.splice(0, Math.max(0, manuallyRetained.length - currentCapacity));
            }
            const observation = live(index);
            expect(session.receiveLive(observation)).toBe(true);
            manuallyRetained.push(observation);
            if (manuallyRetained.length > currentCapacity) manuallyRetained.shift();

            if (index % 503 === 0 || index === sequence - 1) {
                const snapshot = session.snapshot();
                expect(snapshot.windowSize).toBe(currentCapacity);
                expect(snapshot.ticks).toEqual(manuallyRetained);
                expectConsistentStatistics(snapshot);
            }
        }
    }, 120_000);
});

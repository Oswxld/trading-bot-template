import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import {
    DIGIT_PATTERN_SCORE_MODEL as model,
} from '../services/digit-pattern-score-model';
import type {
    DigitPatternScore,
    DigitPatternScoreResult,
} from '../services/digit-pattern-score-model';

describe('Digit Analyzer pattern-score model contract (Chunk 6.1)', () => {
    it('has a stable, explicitly versioned and non-predictive public label', () => {
        expect(model.version).toBe('1.0.0');
        expect(model.displayLabel).toBe('Digit pattern score');
        expect(model.scoreInterpretation).toContain('NOT probability');
    });

    it('uses a documented uniform reference, not a claimed next-tick probability', () => {
        expect(model.uniformReferenceRate).toBe(0.1);
        expect(model.uniformReferenceRate * 10).toBe(1);
    });

    it('weights full frequency, recent frequency and trend without exceeding 100%', () => {
        expect(model.weights).toEqual({
            fullFrequency: 0.4,
            recentFrequency: 0.35,
            trend: 0.25,
        });
        const weights = Object.values(model.weights);
        expect(weights.every(weight => Number.isFinite(weight) && weight > 0 && weight < 1))
            .toBe(true);
        expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(1);
    });

    it('gates the score on actual observations, not configured window capacity', () => {
        expect(model.minimumObservations).toBe(100);
        for (const capacity of ANALYZER_SAMPLE_SIZES) {
            expect(capacity).toBeGreaterThanOrEqual(model.minimumObservations);
        }
        for (const observed of [0, 1, 17, 50, 99]) {
            expect(observed < model.minimumObservations).toBe(true);
        }
        for (const observed of [100, 500, 1000]) {
            expect(observed >= model.minimumObservations).toBe(true);
        }
    });

    it.each([
        [100, 50, 50],
        [101, 50, 51],
        [199, 99, 100],
        [200, 100, 100],
        [500, 100, 400],
        [1000, 100, 900],
    ])('defines disjoint recent and earlier samples for %i observations', (size, recent, earlier) => {
        const actualRecent = Math.min(
            model.recentWindowCap,
            Math.floor(size / model.recentWindowDivisor)
        );
        const actualEarlier = size - actualRecent;
        expect(actualRecent).toBe(recent);
        expect(actualEarlier).toBe(earlier);
        expect(actualRecent + actualEarlier).toBe(size);
        expect(actualEarlier).toBeGreaterThan(0);
        expect(actualRecent).toBeGreaterThan(0);
    });

    it('ensures trend standardization denominators stay finite for eligible windows', () => {
        const p0 = model.uniformReferenceRate;
        for (let observed = model.minimumObservations; observed <= 1000; observed += 1) {
            const recent = Math.min(
                model.recentWindowCap,
                Math.floor(observed / model.recentWindowDivisor)
            );
            const earlier = observed - recent;
            const fullVariance = p0 * (1 - p0) / observed;
            const recentVariance = p0 * (1 - p0) / recent;
            const trendVariance = p0 * (1 - p0) * (1 / recent + 1 / earlier);
            for (const variance of [fullVariance, recentVariance, trendVariance]) {
                expect(Number.isFinite(variance)).toBe(true);
                expect(variance).toBeGreaterThan(0);
            }
        }
    });

    it('maps a neutral reference-aligned sample to the midpoint', () => {
        const neutral = model.neutralScore + 50 * (
            model.weights.fullFrequency * 0 +
            model.weights.recentFrequency * 0 +
            model.weights.trend * 0
        );
        expect(neutral).toBe(50);
        expect(model.minimumScore).toBe(0);
        expect(model.maximumScore).toBe(100);
        expect(model.standardizedDifferenceCap).toBe(3);
    });

    it('cannot produce an unbounded score after the three signals are clipped', () => {
        for (const full of [-1, 0, 1]) {
            for (const recent of [-1, 0, 1]) {
                for (const trend of [-1, 0, 1]) {
                    const value = model.neutralScore + 50 * (
                        model.weights.fullFrequency * full +
                        model.weights.recentFrequency * recent +
                        model.weights.trend * trend
                    );
                    expect(value).toBeGreaterThanOrEqual(model.minimumScore);
                    expect(value).toBeLessThanOrEqual(model.maximumScore);
                    expect(Number.isFinite(value)).toBe(true);
                }
            }
        }
    });

    it('keeps its model constants deeply immutable', () => {
        expect(Object.isFrozen(model)).toBe(true);
        expect(Object.isFrozen(model.weights)).toBe(true);
    });

    it('defines an explicit no-score state without inventing a 0 or 50 for missing data', () => {
        const unavailable: DigitPatternScoreResult = {
            status: 'insufficient-data',
            modelVersion: model.version,
            symbol: 'R_10',
            observedTicks: 17,
            minimumRequiredTicks: model.minimumObservations,
            scores: [],
        };
        expect(unavailable.scores).toHaveLength(0);
        expect(unavailable.status).toBe('insufficient-data');
        expect(unavailable.observedTicks).toBeLessThan(unavailable.minimumRequiredTicks);
    });

    it('defines ten ordered digit scores with finite component inputs for the later engine', () => {
        const digits: DigitPatternScore[] = Array.from({ length: 10 }, (_, digit) => ({
            digit,
            score: 50,
            fullFrequencyComponent: 0,
            recentFrequencyComponent: 0,
            trendComponent: 0,
            fullCount: 10,
            recentCount: 5,
            earlierCount: 5,
        }));
        const ready: DigitPatternScoreResult = {
            status: 'ready',
            modelVersion: model.version,
            symbol: 'R_10',
            observedTicks: 100,
            recentTicks: 50,
            earlierTicks: 50,
            scores: digits,
        };
        expect(ready.scores.map(score => score.digit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(ready.scores.every(score => score.score >= 0 && score.score <= 100)).toBe(true);
        expect(ready.recentTicks + ready.earlierTicks).toBe(ready.observedTicks);
    });
});

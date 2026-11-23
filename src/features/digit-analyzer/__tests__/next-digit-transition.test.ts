import {
    calculateNextDigitPrediction,
    NEXT_DIGIT_MIN_TICKS,
    NEXT_DIGIT_MIN_TRANSITIONS,
} from '../services/next-digit-transition';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

const ticksFor = (digits: number[], symbol = 'R_100'): AnalyzerTick[] =>
    digits.map((digit, index) => ({
        id: `history:${symbol}:${1700000000 + index}:1`,
        epoch: 1700000000 + index,
        quote: `123.40${digit}`,
        digit,
    }));

describe('next digit: real-tick conditional transitions', () => {
    it('requires at least 100 observed ticks (no manufactured scores)', () => {
        expect(NEXT_DIGIT_MIN_TICKS).toBe(100);
        const result = calculateNextDigitPrediction('R_100', ticksFor([1, 2, 3]));
        expect(result.status).toBe('insufficient-data');
        expect(result.nextDigit).toBeNull();
        expect(result.candidates).toHaveLength(0);
    });

    it('ranks observed immediate successors after the latest digit, including repeated digits', () => {
        const digits = Array.from({ length: 16 }, () => [7, 3, 7, 3, 7, 5, 7, 3, 7, 7, 2, 1]).flat();
        digits.push(7);
        const result = calculateNextDigitPrediction('R_100', ticksFor(digits));
        expect(result.status).toBe('ready');
        expect(result.entryDigit).toBe(7);
        expect(result.nextDigit).toBe(3);
        expect(result.transitionCount).toBeGreaterThan(NEXT_DIGIT_MIN_TRANSITIONS);
        expect(result.candidates[0].count).toBeGreaterThan(result.candidates[1].count);
        expect(result.candidates.map(item => item.observedShare)
            .reduce((sum, share) => sum + share, 0)).toBeCloseTo(100);
    });

    it('rejects cross-market ticks and invalid future or duplicate observations', () => {
        const input = ticksFor([4, 1, 4]);
        expect(() => calculateNextDigitPrediction('R_75', input)).toThrow();
        expect(() => calculateNextDigitPrediction('R_100', [...input, input[0]])).toThrow();
        expect(() => calculateNextDigitPrediction('R_100', [{ ...input[0], digit: 9 }])).toThrow();
    });

    it('does not pick a digit when the latest trigger lacks transition support', () => {
        const digits = Array.from({ length: 110 }, (_, i) => i % 2);
        digits.push(9);
        const result = calculateNextDigitPrediction('R_100', ticksFor(digits));
        expect(result.status).toBe('insufficient-data');
        expect(result.transitionCount).toBe(0);
        expect(result.nextDigit).toBeNull();
    });

    it('selects deterministically on exact frequency ties instead of guessing a win probability', () => {
        const digits = Array.from({ length: 14 }, () => [4, 3, 4, 7]).flat();
        digits.push(...Array.from({ length: 50 }, (_, i) => i % 2 ? 2 : 8), 4);
        const result = calculateNextDigitPrediction('R_100', ticksFor(digits));
        expect(result.status).toBe('ready');
        expect(result.nextDigit).toBe(3);
        expect(result.candidates[0].observedShare).toBeLessThan(100);
    });
});

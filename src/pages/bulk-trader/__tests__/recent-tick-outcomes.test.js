import { getRecentTickOutcome } from '../recent-tick-outcomes';

describe('Bulk Trader recent tick badges', () => {
    const symbols = (digits, type, prediction = '5') =>
        digits.map(digit => getRecentTickOutcome(digit, type, prediction).letter).join('');

    it('shows Matches/Differs relative to the selected prediction', () => {
        expect(symbols([1, 5, 0, 5, 9], 'MATCH_DIFF')).toBe('DMDMD');
        expect(getRecentTickOutcome(5, 'MATCH_DIFF', '5')).toEqual({
            letter: 'M', tone: 'secondary', description: 'Matches',
        });
        expect(getRecentTickOutcome(1, 'MATCH_DIFF', '5').tone).toBe('primary');
    });

    it('changes to Under/Over and never mislabels equality as a win side', () => {
        expect(symbols([1, 4, 5, 6, 9], 'OVER_UNDER')).toBe('UU=OO');
        expect(getRecentTickOutcome(4, 'OVER_UNDER', '5').tone).toBe('primary');
        expect(getRecentTickOutcome(6, 'OVER_UNDER', '5').tone).toBe('secondary');
        expect(getRecentTickOutcome(5, 'OVER_UNDER', '5').tone).toBe('neutral');
        expect(symbols([5, 6, 7], 'OVER_UNDER', '7')).toBe('UU=');
    });

    it('shows Even/Odd regardless of the prediction (including zero)', () => {
        expect(symbols([0, 1, 2, 3, 8, 9], 'EVEN_ODD')).toBe('EOEOEO');
        expect(getRecentTickOutcome(0, 'EVEN_ODD', 'not-a-number').tone).toBe('primary');
        expect(getRecentTickOutcome(9, 'EVEN_ODD', '5').tone).toBe('secondary');
    });

    it('does not invent Rise/Fall direction from only the last digit', () => {
        expect(symbols([0, 6, 9], 'RISE_FALL')).toBe('069');
        expect(getRecentTickOutcome(9, 'RISE_FALL', '5').tone).toBe('neutral');
    });

    it('renders invalid tick digits and barriers as neutral', () => {
        expect(getRecentTickOutcome(NaN, 'MATCH_DIFF', '5').tone).toBe('neutral');
        expect(getRecentTickOutcome(2, 'OVER_UNDER', 'not-a-number').tone).toBe('neutral');
    });
});

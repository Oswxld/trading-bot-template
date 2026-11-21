import { parseFiniteBalance } from '../balance-utils';

describe('real-account balance parsing', () => {
    it('accepts funded real balances returned as strings or numbers', () => {
        expect(parseFiniteBalance('10.28')).toBe(10.28);
        expect(parseFiniteBalance(10.28)).toBe(10.28);
    });

    it('treats an explicit zero as a valid broker balance', () => {
        expect(parseFiniteBalance('0.00')).toBe(0);
        expect(parseFiniteBalance(0)).toBe(0);
    });

    it('does not turn missing or invalid responses into a misleading zero', () => {
        for (const value of [undefined, null, '', '  ', NaN, Infinity, 'not a balance', {}]) {
            expect(parseFiniteBalance(value)).toBeNull();
        }
    });
});

import { normalizeLiveTick } from '../utils/normalize-tick';

const tickMessage = (overrides: Record<string, unknown> = {}) => ({
    msg_type: 'tick',
    subscription: { id: 'stream-R_75' },
    tick: {
        symbol: 'R_75',
        epoch: 1770000000,
        quote: 123.45,
        pip_size: 3,
        ...overrides,
    },
});

describe('normalizeLiveTick (never infer the last digit from unformatted floats)', () => {
    it('respects Deriv tick pip_size as decimal-place count and retains trailing zeros', () => {
        expect(normalizeLiveTick(tickMessage(), 'R_75', 1)).toEqual({
            id: 'R_75:1770000000:1',
            epoch: 1770000000,
            quote: '123.450',
            digit: 0,
        });
    });

    it('uses tick pip_size rather than catalog pip_size price increments', () => {
        const normalized = normalizeLiveTick(tickMessage({ pip_size: 5, quote: 1.085 }), 'R_75', 2);
        expect(normalized?.quote).toBe('1.08500');
        expect(normalized?.digit).toBe(0);
    });

    it('formats integer precision zero correctly', () => {
        expect(normalizeLiveTick(tickMessage({ quote: 234, pip_size: 0 }), 'R_75', 1)?.digit).toBe(4);
    });

    it('accepts clean decimal-string quotes, including negative quotes', () => {
        expect(normalizeLiveTick(tickMessage({ quote: '-12.50', pip_size: 2 }), 'R_75', 1)?.quote).toBe('-12.50');
        expect(normalizeLiveTick(tickMessage({ quote: '-12.50', pip_size: 2 }), 'R_75', 1)?.digit).toBe(0);
    });

    it('rejects another instrument or a non-tick event', () => {
        expect(normalizeLiveTick(tickMessage(), 'R_10', 1)).toBeNull();
        expect(normalizeLiveTick({ msg_type: 'history', tick: tickMessage().tick }, 'R_75', 1)).toBeNull();
        expect(normalizeLiveTick({ msg_type: 'tick' }, 'R_75', 1)).toBeNull();
    });

    it('does not guess when required timestamp, precision or quote data is missing', () => {
        expect(normalizeLiveTick(tickMessage({ epoch: undefined }), 'R_75', 1)).toBeNull();
        expect(normalizeLiveTick(tickMessage({ pip_size: undefined }), 'R_75', 1)).toBeNull();
        expect(normalizeLiveTick(tickMessage({ quote: undefined }), 'R_75', 1)).toBeNull();
    });

    it('rejects invalid and excessive tick precision or unsafe price numbers', () => {
        for (const pip_size of [-1, 13, NaN, 0.1, '2']) {
            expect(normalizeLiveTick(tickMessage({ pip_size }), 'R_75', 1)).toBeNull();
        }
        expect(normalizeLiveTick(tickMessage({ quote: Infinity }), 'R_75', 1)).toBeNull();
        expect(normalizeLiveTick(tickMessage({ quote: '12e+3' }), 'R_75', 1)).toBeNull();
        expect(normalizeLiveTick(tickMessage({ quote: 10 ** 22 }), 'R_75', 1)).toBeNull();
    });

    it('uses a per-stream sequence to avoid duplicate IDs for ticks in the same second', () => {
        const first = normalizeLiveTick(tickMessage(), 'R_75', 1);
        const second = normalizeLiveTick(tickMessage(), 'R_75', 2);
        expect(first?.id).not.toBe(second?.id);
        expect(normalizeLiveTick(tickMessage(), 'R_75', 0)).toBeNull();
    });
});

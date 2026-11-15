import { normalizeHistoricalTicks } from '../utils/normalize-history';
import type { PublicMarketResponse } from '../services/public-market-data-client';

const fixture = (overrides: Record<string, unknown> = {}): PublicMarketResponse => ({
    msg_type: 'history',
    echo_req: { ticks_history: '1HZ10V', count: 100, end: 'latest', style: 'ticks' },
    pip_size: 3,
    history: {
        prices: [123.45, 123.456, 123.45],
        times: [1770000000, 1770000001, 1770000001],
    },
    ...overrides,
});

describe('Digit Analyzer historical snapshot normalization', () => {
    it('uses the response pip_size (decimal places) and retains ending zeros', () => {
        const ticks = normalizeHistoricalTicks(fixture(), '1HZ10V', 100);
        expect(ticks).toEqual([
            { id: 'history:1HZ10V:1770000000:1', quote: '123.450', digit: 0, epoch: 1770000000 },
            { id: 'history:1HZ10V:1770000001:2', quote: '123.456', digit: 6, epoch: 1770000001 },
            { id: 'history:1HZ10V:1770000001:3', quote: '123.450', digit: 0, epoch: 1770000001 },
        ]);
    });

    it('preserves chronological order and does not invent rows when fewer than requested exist', () => {
        const ticks = normalizeHistoricalTicks(fixture(), '1HZ10V', 100);
        expect(ticks).toHaveLength(3);
        expect(ticks.map(t => t.epoch)).toEqual([1770000000, 1770000001, 1770000001]);
    });

    it('allows a real empty snapshot while keeping missing arrays an error', () => {
        expect(normalizeHistoricalTicks(fixture({
            history: { prices: [], times: [] },
        }), '1HZ10V', 100)).toEqual([]);
        expect(() => normalizeHistoricalTicks(fixture({
            history: { prices: [], times: undefined },
        }), '1HZ10V', 100)).toThrow('missing prices or times');
        expect(() => normalizeHistoricalTicks(fixture({
            history: undefined,
        }), '1HZ10V', 100)).toThrow('missing prices or times');
    });

    it('uses distinct IDs for multiple ticks in the same second', () => {
        const ticks = normalizeHistoricalTicks(fixture(), '1HZ10V', 100);
        expect(new Set(ticks.map(t => t.id)).size).toBe(3);
        expect(ticks.every(t => t.id.startsWith('history:'))).toBe(true);
    });

    it('rejects arrays with unequal lengths or more ticks than requested', () => {
        expect(() => normalizeHistoricalTicks(fixture({
            history: { prices: [1, 2], times: [1770000000] },
        }), '1HZ10V', 100)).toThrow('mismatched or excessive');

        expect(() => normalizeHistoricalTicks(fixture({
            history: {
                prices: Array.from({ length: 101 }, () => 1.25),
                times: Array.from({ length: 101 }, (_, i) => 1770000000 + i),
            },
        }), '1HZ10V', 100)).toThrow('mismatched or excessive');
    });

    it('rejects unsorted, fractional, invalid or negative timestamps', () => {
        for (const times of [
            [1770000002, 1770000000, 1770000001],
            [1770000000, 1770000000.5, 1770000001],
            [1770000000, '1770000001', 1770000002],
            [1770000000, -1, 1770000002],
        ]) {
            expect(() => normalizeHistoricalTicks(fixture({
                history: { prices: [1, 2, 3], times },
            }), '1HZ10V', 100)).toThrow('timestamps');
        }
    });

    it('rejects malformed prices rather than quietly skewing the analysis', () => {
        for (const quote of [null, NaN, Infinity, '1e9', {}, 'not-a-price']) {
            expect(() => normalizeHistoricalTicks(fixture({
                history: { prices: [123.45, quote], times: [1770000000, 1770000001] },
            }), '1HZ10V', 100)).toThrow('malformed quote at index 1');
        }
    });

    it('rejects missing, negative or unreasonably large pip precision', () => {
        for (const pip_size of [-1, 13, 1.5, NaN, '3', null, undefined]) {
            expect(() => normalizeHistoricalTicks(fixture({ pip_size }), '1HZ10V', 100)).toThrow('precision');
        }
    });

    it('checks that echo_req identifies the same market and requested count', () => {
        const wrongEchoes = [
            { ticks_history: 'R_75', count: 100, end: 'latest', style: 'ticks' },
            { ticks_history: '1HZ10V', count: 500, end: 'latest', style: 'ticks' },
            { ticks_history: '1HZ10V', count: 100, end: 1770000000, style: 'ticks' },
            { ticks_history: '1HZ10V', count: 100, end: 'latest', style: 'candles' },
            { ticks_history: '1HZ10V', count: 100, end: 'latest', style: 'ticks', subscribe: 1 },
        ];
        for (const echo_req of wrongEchoes) {
            expect(() => normalizeHistoricalTicks(fixture({ echo_req }), '1HZ10V', 100))
                .toThrow('does not match');
        }
    });

    it('rejects subscriptions and non-history message types', () => {
        expect(() => normalizeHistoricalTicks(fixture({
            subscription: { id: 'unexpected-stream' },
        }), '1HZ10V', 100)).toThrow('unexpectedly created a subscription');
        expect(() => normalizeHistoricalTicks(fixture({ msg_type: 'tick' }), '1HZ10V', 100))
            .toThrow('expected tick history');
    });

    it('supports integer quote precision and fractional windows of 500 or 1000', () => {
        for (const count of [500, 1000] as const) {
            const ticks = normalizeHistoricalTicks(fixture({
                pip_size: 0,
                echo_req: { ticks_history: '1HZ10V', count, end: 'latest', style: 'ticks' },
                history: { prices: [25], times: [1770000000] },
            }), '1HZ10V', count);
            expect(ticks[0].quote).toBe('25');
            expect(ticks[0].digit).toBe(5);
        }
    });
});

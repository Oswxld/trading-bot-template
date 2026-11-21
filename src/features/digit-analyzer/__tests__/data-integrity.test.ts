import RollingTickWindow from '../services/rolling-tick-window';
import SynchronizedTickWindow, { reconcileBufferedLive } from '../services/synchronized-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const tick = (
    sequence: number,
    source: 'history' | 'live' = 'live',
    symbol = 'R_10',
    epoch = 1770000000 + sequence,
    quote = (100 + sequence / 100).toFixed(2)
): AnalyzerTick => ({
    id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${sequence + 1}`,
    epoch,
    quote,
    digit: Number(quote.at(-1)),
});

const history = (start: number, count: number, symbol = 'R_10') =>
    Array.from({ length: count }, (_, i) => tick(start + i, 'history', symbol));

describe('Digit Analyzer: 4.4 data integrity and failure scenarios', () => {
    it('rejects stale historical responses without replacing a more recent verified sample', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const first = session.beginHistory();
        expect(session.completeHistory(first, history(100, 20))).toBe(true);
        const prior = session.snapshot();
        const stale = session.beginHistory();
        expect(() => session.completeHistory(stale, history(0, 100)))
            .toThrow('older than the current verified sample');
        expect(session.snapshot()).toEqual(prior);
        expect(session.phase).toBe('loading');
        expect(session.failHistory(stale)).toBe(true);
        expect(session.phase).toBe('error');
        expect(session.snapshot()).toEqual(prior);
    });

    it('does not wipe valid previously observed history when a new API snapshot returns empty', () => {
        const session = new SynchronizedTickWindow('R_10', 500);
        const first = session.beginHistory();
        session.completeHistory(first, history(0, 50));
        const before = session.snapshot();
        const second = session.beginHistory();
        expect(() => session.completeHistory(second, []))
            .toThrow('older than the current verified sample');
        session.failHistory(second);
        expect(session.snapshot()).toEqual(before);
    });

    it('rejects ambiguous same-second historical replacements rather than rewinding the last quote', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const epoch = 1770000050;
        const a = tick(1, 'history', 'R_10', epoch, '100.11');
        const b = tick(2, 'history', 'R_10', epoch, '100.12');
        const c = tick(3, 'history', 'R_10', epoch, '100.10');

        const first = session.beginHistory();
        session.completeHistory(first, [a, b]);
        const before = session.snapshot();

        const second = session.beginHistory();
        expect(() => session.completeHistory(second, [a, c]))
            .toThrow('ambiguous same-second ordering');
        expect(session.snapshot()).toEqual(before);
        session.failHistory(second);
        expect(session.snapshot().latestTick?.quote).toBe('100.12');
    });

    it('accepts new same-second history only when it includes the previously verified quote', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const epoch = 1770000050;
        const old = tick(1, 'history', 'R_10', epoch, '100.11');
        const next = tick(2, 'history', 'R_10', epoch, '100.12');
        const first = session.beginHistory();
        session.completeHistory(first, [old]);
        const second = session.beginHistory();
        expect(session.completeHistory(second, [old, next])).toBe(true);
        expect(session.snapshot().ticks.map(t => t.quote)).toEqual(['100.11', '100.12']);
    });

    it('allows genuinely empty history with live-only data, retaining every confirmed observation', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const load = session.beginHistory();
        session.receiveLive(tick(1));
        session.receiveLive(tick(2));
        expect(session.completeHistory(load, [])).toBe(true);
        expect(session.phase).toBe('ready');
        expect(session.snapshot().ticks.map(t => t.quote))
            .toEqual([tick(1).quote, tick(2).quote]);
    });

    it('refuses all post-disposal callbacks, invalidates request tokens, and never resurrects ticks', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const old = session.beginHistory();
        session.receiveLive(tick(1));
        session.dispose();
        session.dispose(); // idempotent
        expect(session.receiveLive(tick(2))).toBe(false);
        expect(session.completeHistory(old, history(0, 100))).toBe(false);
        expect(session.failHistory(old)).toBe(false);
        expect(() => session.beginHistory()).toThrow('disposed');
        expect(session.snapshot().count).toBe(0);
        expect(session.phase).toBe('idle');
    });

    it('handles delayed history replies for obsolete sample sizes without changing latest state', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token100 = session.beginHistory(100);
        session.receiveLive(tick(3));
        const token500 = session.beginHistory(500);
        session.receiveLive(tick(4));
        const token1000 = session.beginHistory(1000);
        session.receiveLive(tick(5));

        expect(session.completeHistory(token100, history(0, 100))).toBe(false);
        expect(session.failHistory(token500)).toBe(false);
        expect(session.completeHistory(token1000, history(0, 6))).toBe(true);
        expect(session.snapshot().windowSize).toBe(1000);
        expect(session.snapshot().count).toBe(6);
        expect(session.snapshot().latestTick?.quote).toBe(tick(5).quote);
    });

    it('keeps live quotes when history normalization fails and succeeds on a later valid retry', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const first = session.beginHistory();
        session.receiveLive(tick(5));
        const broken = history(0, 6);
        broken[3] = { ...broken[3], digit: 99 };
        const before = session.snapshot();
        expect(() => session.completeHistory(first, broken)).toThrow('Invalid normalized tick');
        expect(session.snapshot()).toEqual(before);
        expect(session.failHistory(first)).toBe(true);
        expect(session.receiveLive(tick(6))).toBe(true);

        const retry = session.beginHistory();
        expect(session.completeHistory(retry, history(0, 7))).toBe(true);
        expect(session.snapshot().count).toBe(7);
        expect(session.snapshot().latestTick?.epoch).toBe(tick(6).epoch);
    });

    it('conservatively avoids same-second history/live double counts with no reliable sequence match', () => {
        const h = [
            tick(1, 'history', 'R_10', 1770000010, '123.41'),
            tick(2, 'history', 'R_10', 1770000010, '123.42'),
        ];
        const noMatch = [
            tick(3, 'live', 'R_10', 1770000010, '123.43'),
            tick(4, 'live', 'R_10', 1770000011, '123.44'),
        ];
        expect(reconcileBufferedLive(h, noMatch)).toEqual([noMatch[1]]);

        const overlap = [
            tick(1, 'live', 'R_10', 1770000010, '123.41'),
            tick(2, 'live', 'R_10', 1770000010, '123.42'),
            tick(3, 'live', 'R_10', 1770000010, '123.43'),
            tick(4, 'live', 'R_10', 1770000011, '123.44'),
        ];
        expect(reconcileBufferedLive(h, overlap)).toEqual(overlap.slice(2));
    });

    it('bounds in-flight memory to the configured window even during a flood of valid ticks', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        for (let i = 0; i < 10_000; i += 1) session.receiveLive(tick(i));
        const privateState = session as unknown as { bufferedLive: AnalyzerTick[] };
        expect(privateState.bufferedLive.length).toBeLessThanOrEqual(200);
        expect(session.snapshot().count).toBe(100);
        expect(session.completeHistory(token, history(0, 100))).toBe(true);
        expect(session.snapshot().count).toBe(100);
        expect(session.snapshot().latestTick?.epoch).toBe(tick(9999).epoch);
    });

    it('does not leak tick references from its read-only snapshots under adversarial mutation', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const source = tick(1);
        session.receiveLive(source);
        const one = session.snapshot();
        one.ticks[0].quote = '000.00';
        one.ticks[0].digit = 0;
        one.ticks.push(tick(2));
        if (one.latestTick) one.latestTick.id = 'tampered';
        source.id = 'tampered';
        source.quote = '000.00';
        expect(session.snapshot().ticks).toEqual([tick(1)]);
    });
});

describe('RollingTickWindow: deterministic long-running model validation', () => {
    const sizes: AnalyzerSampleSize[] = [100, 500, 1000];

    it.each(sizes)('remains equivalent to a simple FIFO reference model after 6,000 events (size=%s)', size => {
        const window = new RollingTickWindow('R_10', size);
        const expected: AnalyzerTick[] = [];
        const seen = new Set<string>();

        // Deterministic "random" events: 1s and same-second ticks, repeats,
        // and intentionally delayed timestamps. No randomness across CI runs.
        for (let i = 1; i <= 6000; i += 1) {
            const epoch = 1770000000 + Math.floor(i / 3);
            const candidate = tick(i, 'live', 'R_10', epoch, (100 + (i % 11) / 100).toFixed(2));
            const older = tick(i, 'live', 'R_10', epoch - 4, candidate.quote);
            const input = i % 23 === 0 ? older : i % 17 === 0 ? expected[expected.length - 1] ?? candidate : candidate;

            const lastEpoch = expected[expected.length - 1]?.epoch ?? 0;
            const shouldAdd = !!input && !seen.has(input.id) && input.epoch >= lastEpoch;
            const accepted = window.appendLive(input);
            expect(accepted).toBe(shouldAdd);
            if (shouldAdd) {
                expected.push(input);
                seen.add(input.id);
                if (expected.length > size) {
                    const removed = expected.shift();
                    if (removed) seen.delete(removed.id);
                }
            }

            if (i % 103 === 0 || i === 6000) {
                const actual = window.getSnapshot();
                expect(actual.count).toBe(expected.length);
                expect(actual.ticks).toEqual(expected);
                expect(actual.remaining).toBe(size - expected.length);
                expect(actual.isFull).toBe(expected.length === size);
                expect(actual.ticks.every((t, j) => j === 0 || t.epoch >= actual.ticks[j - 1].epoch)).toBe(true);
            }
        }
    });

    it('atomically rejects malformed historical data after thousands of ticks', () => {
        const window = new RollingTickWindow('R_10', 100);
        for (let i = 0; i < 3000; i += 1) window.appendLive(tick(i));
        const before = window.getSnapshot();
        const broken = history(0, 100);
        broken[99] = { ...broken[99], quote: 'not-price' };
        expect(() => window.replaceHistory(broken)).toThrow('Invalid normalized tick');
        expect(window.getSnapshot()).toEqual(before);
    });
});

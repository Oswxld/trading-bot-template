import SynchronizedTickWindow, { reconcileBufferedLive } from '../services/synchronized-tick-window';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

const tick = (
    number: number,
    kind: 'live' | 'history' = 'live',
    symbol = 'R_10',
    epoch = 1770000000 + number,
    quote = (100 + number / 100).toFixed(2)
): AnalyzerTick => ({
    id: `${kind === 'history' ? 'history:' : ''}${symbol}:${epoch}:${number + 1}`,
    epoch,
    quote,
    digit: Number(quote.charAt(quote.length - 1)),
});

const history = (from: number, count: number, symbol = 'R_10'): AnalyzerTick[] =>
    Array.from({ length: count }, (_, index) => tick(from + index, 'history', symbol));

describe('SynchronizedTickWindow: historical snapshots and live observation reconciliation', () => {
    it('starts without data and does not create synthetic ticks', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        expect(session.phase).toBe('idle');
        expect(session.snapshot().count).toBe(0);
        expect(session.snapshot().remaining).toBe(100);
    });

    it('reconciles a live tick already included at the tail of history', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const load = session.beginHistory();
        expect(session.receiveLive(tick(3))).toBe(true);
        expect(session.receiveLive(tick(4))).toBe(true);
        expect(session.snapshot().count).toBe(2);
        expect(session.completeHistory(load, history(0, 5))).toBe(true);
        expect(session.phase).toBe('ready');
        expect(session.snapshot().count).toBe(5);
        expect(session.snapshot().ticks.map(t => t.epoch)).toEqual(
            [1770000000, 1770000001, 1770000002, 1770000003, 1770000004]
        );
    });

    it('appends genuinely new live ticks after the overlapping history suffix', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        session.receiveLive(tick(3));
        session.receiveLive(tick(4));
        session.receiveLive(tick(5));
        session.completeHistory(token, history(0, 5));
        const snap = session.snapshot();
        expect(snap.count).toBe(6);
        expect(snap.latestTick?.id).toBe(tick(5).id);
        expect(snap.ticks.filter(t => t.quote === tick(4).quote)).toHaveLength(1);
    });

    it('detects a history suffix inside the buffered live stream, not only at its start', () => {
        const series = history(3, 3);
        const buffered = [tick(2), tick(3), tick(4), tick(5), tick(6)];
        expect(reconcileBufferedLive(series, buffered).map(t => t.id)).toEqual([tick(6).id]);
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        buffered.forEach(t => session.receiveLive(t));
        session.completeHistory(token, series);
        expect(session.snapshot().ticks.map(t => t.epoch)).toEqual(
            [1770000003, 1770000004, 1770000005, 1770000006]
        );
    });

    it('handles repeated identical quotes and distinct genuine events in one second', () => {
        const t = 1770000010;
        const h0 = tick(1, 'history', 'R_10', t, '100.11');
        const h1 = tick(2, 'history', 'R_10', t, '100.12');
        const live0 = tick(1, 'live', 'R_10', t, '100.11');
        const live1 = tick(2, 'live', 'R_10', t, '100.12');
        const live2 = tick(3, 'live', 'R_10', t, '100.12');
        const live3 = tick(4, 'live', 'R_10', t, '100.13');
        expect(reconcileBufferedLive([h0, h1], [live0, live1, live2, live3]))
            .toEqual([live2, live3]);

        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        [live0, live1, live2, live3].forEach(x => session.receiveLive(x));
        session.completeHistory(token, [h0, h1]);
        expect(session.snapshot().count).toBe(4);
        expect(session.snapshot().ticks.map(x => x.quote))
            .toEqual(['100.11', '100.12', '100.12', '100.13']);
    });

    it('conservatively excludes ambiguous same-second ticks when no overlap is provable', () => {
        const h = tick(1, 'history', 'R_10', 1770000000, '100.11');
        const sameSecond = tick(2, 'live', 'R_10', 1770000000, '100.12');
        const newer = tick(3, 'live', 'R_10', 1770000001, '100.13');
        expect(reconcileBufferedLive([h], [sameSecond, newer])).toEqual([newer]);
    });

    it('preserves live-only observations when the historical request fails', () => {
        const session = new SynchronizedTickWindow('R_10', 500);
        const token = session.beginHistory();
        session.receiveLive(tick(1));
        session.receiveLive(tick(2));
        expect(session.failHistory(token)).toBe(true);
        expect(session.phase).toBe('error');
        expect(session.snapshot().count).toBe(2);
        expect(session.receiveLive(tick(3))).toBe(true);
        expect(session.snapshot().count).toBe(3);
    });

    it('rejects obsolete history results from a rapid window change', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const old = session.beginHistory();
        session.receiveLive(tick(5));
        const current = session.beginHistory(500);
        expect(session.size).toBe(500);
        expect(session.completeHistory(old, history(0, 100))).toBe(false);
        expect(session.failHistory(old)).toBe(false);
        expect(session.phase).toBe('loading');
        session.receiveLive(tick(6));
        expect(session.completeHistory(current, history(0, 7))).toBe(true);
        expect(session.snapshot().count).toBe(7);
        expect(session.snapshot().windowSize).toBe(500);
        expect(session.snapshot().latestTick?.epoch).toBe(1770000006);
    });

    it('resizing from 1000 to 100 and back to 500 never restores evicted ticks', () => {
        const session = new SynchronizedTickWindow('R_10', 1000);
        const initial = session.beginHistory();
        session.completeHistory(initial, history(0, 1000));
        expect(session.snapshot().count).toBe(1000);

        const narrow = session.beginHistory(100);
        expect(session.snapshot().count).toBe(100);
        expect(session.snapshot().ticks[0].epoch).toBe(1770000900);
        // While the replacement request is loading, only actual retained
        // ticks are available. The future snapshot may fill the larger size.
        expect(session.failHistory(narrow)).toBe(true);
        const wider = session.beginHistory(500);
        expect(session.snapshot().count).toBe(100);
        expect(session.snapshot().remaining).toBe(400);
        session.completeHistory(wider, history(500, 500));
        expect(session.snapshot().count).toBe(500);
        expect(session.snapshot().ticks[0].epoch).toBe(1770000500);
    });

    it('remains bounded to 100, 500 and 1000 ticks under live streams', () => {
        for (const size of [100, 500, 1000] as const) {
            const session = new SynchronizedTickWindow('R_10', size);
            const token = session.beginHistory();
            for (let index = 0; index < 1500; index += 1) session.receiveLive(tick(index));
            expect(session.snapshot().count).toBe(size);
            session.completeHistory(token, history(0, 100));
            expect(session.snapshot().count).toBe(size);
            expect(session.snapshot().latestTick?.epoch).toBe(1770001499);
            expect(session.snapshot().ticks[0].epoch).toBe(1770001500 - size);
        }
    });

    it('does not partially corrupt the state on malformed snapshots', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        session.receiveLive(tick(6));
        const token = session.beginHistory();
        const before = session.snapshot();
        const corrupted = history(0, 7);
        corrupted[2] = { ...corrupted[2], digit: 99 };
        expect(() => session.completeHistory(token, corrupted)).toThrow('Invalid normalized tick');
        expect(session.snapshot()).toEqual(before);
        expect(session.phase).toBe('loading');
        expect(session.failHistory(token)).toBe(true);
        expect(session.snapshot().count).toBe(1);
    });

    it('isolates market snapshots and rejects other symbols', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        const wrongMarketHistory = history(0, 5, 'R_75');
        expect(() => session.completeHistory(token, wrongMarketHistory)).toThrow('another market');
        expect(() => session.receiveLive(tick(7, 'live', 'R_75'))).toThrow('another market');
        expect(session.snapshot().count).toBe(0);
    });

    it('does not mutate source history/live arrays or expose internal history snapshots', () => {
        const h = history(0, 3);
        const live = [tick(2), tick(3)];
        const originalHistory = JSON.stringify(h);
        const originalLive = JSON.stringify(live);
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        live.forEach(x => session.receiveLive(x));
        session.completeHistory(token, h);
        expect(JSON.stringify(h)).toBe(originalHistory);
        expect(JSON.stringify(live)).toBe(originalLive);
        const external = session.snapshot();
        external.ticks[0].quote = '999.99';
        expect(session.snapshot().ticks[0].quote).not.toBe('999.99');
    });

    it('clears and invalidates pending work on disposal', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        const token = session.beginHistory();
        session.receiveLive(tick(1));
        session.dispose();
        expect(session.phase).toBe('idle');
        expect(session.snapshot().count).toBe(0);
        expect(session.completeHistory(token, history(0, 5))).toBe(false);
        expect(session.snapshot().count).toBe(0);
    });

    it('does not require a history snapshot to accept the first live price', () => {
        const session = new SynchronizedTickWindow('R_10', 100);
        session.receiveLive(tick(1));
        expect(session.snapshot().count).toBe(1);
        expect(session.snapshot().latestTick?.quote).toBe(tick(1).quote);
    });
});

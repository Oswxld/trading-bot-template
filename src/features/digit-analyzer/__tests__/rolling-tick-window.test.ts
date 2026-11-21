import RollingTickWindow from '../services/rolling-tick-window';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

const makeTick = (index: number, symbol = '1HZ10V', source: 'history' | 'live' = 'live'): AnalyzerTick => {
    const epoch = 1770000000 + index;
    // Leading zero and trailing decimals are retained in normalized prices.
    const quote = (100 + index / 100).toFixed(2);
    return {
        id: `${source === 'history' ? 'history:' : ''}${symbol}:${epoch}:${index + 1}`,
        epoch,
        quote,
        digit: Number(quote.at(-1)),
    };
};

const historyBatch = (amount: number, symbol = '1HZ10V'): AnalyzerTick[] =>
    Array.from({ length: amount }, (_, index) => makeTick(index, symbol, 'history'));

describe('RollingTickWindow: bounded, deterministic real-tick storage (Chunk 4.2)', () => {
    it('starts empty and never invents observations to fill a selected window', () => {
        const window = new RollingTickWindow('1HZ10V');
        expect(window.symbol).toBe('1HZ10V');
        expect(window.windowSize).toBe(1000);
        expect(window.count).toBe(0);
        expect(window.getSnapshot()).toEqual({
            symbol: '1HZ10V',
            windowSize: 1000,
            ticks: [],
            count: 0,
            remaining: 1000,
            isFull: false,
            latestTick: null,
        });
    });

    it.each([100, 500, 1000] as const)(
        'fills a %s-tick window with the most recent real ticks (never more)',
        (size: AnalyzerSampleSize) => {
            const window = new RollingTickWindow('1HZ10V', size);
            window.replaceHistory(historyBatch(1000));

            const snapshot = window.getSnapshot();
            expect(snapshot.windowSize).toBe(size);
            expect(snapshot.ticks).toHaveLength(size);
            expect(snapshot.count).toBe(size);
            expect(snapshot.remaining).toBe(0);
            expect(snapshot.isFull).toBe(true);
            expect(snapshot.ticks[0].id).toBe(makeTick(1000 - size, '1HZ10V', 'history').id);
            expect(snapshot.latestTick).toEqual(makeTick(999, '1HZ10V', 'history'));
        }
    );

    it.each([100, 500, 1000] as const)(
        'evicts the oldest tick at %s capacity while preserving chronological order',
        (size: AnalyzerSampleSize) => {
            const window = new RollingTickWindow('1HZ10V', size);
            window.replaceHistory(historyBatch(size));
            for (let index = size; index < size + 75; index += 1) {
                expect(window.appendLive(makeTick(index))).toBe(true);
            }

            const ticks = window.getSnapshot().ticks;
            expect(ticks).toHaveLength(size);
            expect(ticks[0].epoch).toBe(1770000000 + 75);
            expect(ticks.at(-1)?.epoch).toBe(1770000000 + size + 74);
            expect(window.count).toBe(size);
            expect(new Set(ticks.map(tick => tick.id)).size).toBe(size);
            expect(ticks.every((tick, i) => !i || tick.epoch >= ticks[i - 1].epoch)).toBe(true);
        }
    );

    it('keeps a real partial historical batch and accounts for missing observations', () => {
        const window = new RollingTickWindow('1HZ10V', 500);
        window.replaceHistory(historyBatch(32));
        const snapshot = window.getSnapshot();
        expect(snapshot.count).toBe(32);
        expect(snapshot.remaining).toBe(468);
        expect(snapshot.isFull).toBe(false);
        expect(snapshot.ticks).toHaveLength(32);
        expect(snapshot.latestTick?.quote).toBe(makeTick(31, '1HZ10V', 'history').quote);
    });

    it('accepts true same-second identical-price events with distinct IDs but ignores duplicate ID replay', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        const first = makeTick(1);
        const anotherActualTick = { ...first, id: '1HZ10V:1770000001:999' };
        expect(window.appendLive(first)).toBe(true);
        expect(window.appendLive(first)).toBe(false);
        expect(window.appendLive(anotherActualTick)).toBe(true);
        expect(window.count).toBe(2);
        expect(window.getSnapshot().ticks.map(tick => tick.id))
            .toEqual([first.id, anotherActualTick.id]);
    });

    it('refuses delayed older live ticks without changing the current window', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        window.replaceHistory(historyBatch(8));
        const original = window.getSnapshot();
        expect(window.appendLive(makeTick(5))).toBe(false);
        expect(window.getSnapshot()).toEqual(original);
    });

    it('rejects mixed-market data, missing price precision, and invalid digits atomically', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        window.replaceHistory(historyBatch(5));
        const before = window.getSnapshot();
        const wrongMarket = makeTick(6, 'R_75');
        expect(() => window.appendLive(wrongMarket)).toThrow('another market');
        expect(() => window.appendLive({ ...makeTick(6), digit: 4 })).toThrow('Invalid normalized tick');
        expect(() => window.appendLive({ ...makeTick(6), quote: '100.2e0' })).toThrow('Invalid normalized tick');
        expect(() => window.appendLive({ ...makeTick(6), id: '1HZ10V:1770000006:not-an-id' }))
            .toThrow('Invalid tick identity');
        expect(() => window.appendLive(makeTick(6, '1HZ10V', 'history')))
            .toThrow('Live append requires a live tick ID');
        expect(window.getSnapshot()).toEqual(before);
    });

    it('validates all historical rows before replacing state, including rows that would be truncated', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        window.replaceHistory(historyBatch(20));
        const before = window.getSnapshot();

        const malformed = historyBatch(120);
        malformed[0] = { ...malformed[0], digit: 5 };
        expect(() => window.replaceHistory(malformed)).toThrow('Invalid normalized tick');
        expect(window.getSnapshot()).toEqual(before);

        const outOfOrder = historyBatch(15);
        [outOfOrder[3], outOfOrder[4]] = [outOfOrder[4], outOfOrder[3]];
        expect(() => window.replaceHistory(outOfOrder)).toThrow('chronological order');
        expect(window.getSnapshot()).toEqual(before);

        const duplicate = historyBatch(15);
        duplicate[7] = duplicate[6];
        expect(() => window.replaceHistory(duplicate)).toThrow('duplicate tick ID');
        expect(window.getSnapshot()).toEqual(before);

        const withLive = historyBatch(15);
        withLive[4] = makeTick(4);
        expect(() => window.replaceHistory(withLive)).toThrow('historical tick IDs');
        expect(window.getSnapshot()).toEqual(before);

        expect(() => window.replaceHistory(null as unknown as AnalyzerTick[])).toThrow('Invalid historical tick batch');
        expect(window.getSnapshot()).toEqual(before);
    });

    it('resizes 1000 → 100 → 500 without recovering dropped data or fabricating rows', () => {
        const window = new RollingTickWindow('1HZ10V', 1000);
        window.replaceHistory(historyBatch(1000));
        window.setWindowSize(100);
        expect(window.getSnapshot().ticks).toHaveLength(100);
        expect(window.getSnapshot().ticks[0].id).toBe(makeTick(900, '1HZ10V', 'history').id);

        window.setWindowSize(500);
        expect(window.getSnapshot().count).toBe(100);
        expect(window.getSnapshot().remaining).toBe(400);
        expect(window.getSnapshot().isFull).toBe(false);

        for (let index = 1000; index < 1400; index += 1) window.appendLive(makeTick(index));
        const snapshot = window.getSnapshot();
        expect(snapshot.count).toBe(500);
        expect(snapshot.remaining).toBe(0);
        expect(snapshot.ticks[0].id).toBe(makeTick(900, '1HZ10V', 'history').id);
        expect(snapshot.latestTick?.id).toBe(makeTick(1399).id);
    });

    it('repeated resize and wrap preserve newest ticks and no duplicate identifiers', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        for (let index = 0; index < 1200; index += 1) window.appendLive(makeTick(index));
        window.setWindowSize(500);
        for (let index = 1200; index < 1750; index += 1) window.appendLive(makeTick(index));
        window.setWindowSize(100);
        const snap = window.getSnapshot();
        expect(snap.count).toBe(100);
        expect(snap.ticks[0].id).toBe(makeTick(1650).id);
        expect(snap.latestTick?.id).toBe(makeTick(1749).id);
        expect(new Set(snap.ticks.map(t => t.id)).size).toBe(100);
        expect(snap.ticks.every((tick, index) => !index || tick.epoch >= snap.ticks[index - 1].epoch))
            .toBe(true);
    });

    it('market changes and clears erase old ticks without changing the selected window size', () => {
        const window = new RollingTickWindow('1HZ10V', 500);
        window.replaceHistory(historyBatch(50));
        window.changeMarket('R_75');
        expect(window.symbol).toBe('R_75');
        expect(window.windowSize).toBe(500);
        expect(window.getSnapshot().ticks).toEqual([]);
        expect(window.getSnapshot().remaining).toBe(500);

        expect(() => window.appendLive(makeTick(100))).toThrow('another market');
        expect(window.appendLive(makeTick(100, 'R_75'))).toBe(true);
        window.changeMarket('R_75'); // Re-selecting the same market does not wipe valid ticks.
        expect(window.count).toBe(1);

        window.clear();
        expect(window.count).toBe(0);
        expect(window.getSnapshot().latestTick).toBeNull();
    });

    it('rejects unsupported window sizes or market identifiers without disturbing state', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        window.replaceHistory(historyBatch(3));
        const before = window.getSnapshot();
        for (const size of [0, 99, 101, 5000, NaN, 0.5]) {
            expect(() => window.setWindowSize(size as AnalyzerSampleSize)).toThrow('100, 500 or 1000');
        }
        for (const symbol of ['R 75', 'R_75?token=secret', '', 'a']) {
            expect(() => window.changeMarket(symbol)).toThrow('Invalid rolling tick market symbol');
        }
        expect(() => new RollingTickWindow('R_75', 50 as AnalyzerSampleSize))
            .toThrow('100, 500 or 1000');
        expect(() => new RollingTickWindow('', 100)).toThrow('Invalid rolling tick market symbol');
        expect(window.getSnapshot()).toEqual(before);
    });

    it('does not expose its mutable internal array or tick objects through snapshots', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        const first = makeTick(1);
        window.appendLive(first);
        first.quote = '999.99';
        first.digit = 9;
        expect(window.getSnapshot().ticks[0].quote).not.toBe('999.99');

        const snap = window.getSnapshot();
        snap.ticks[0].quote = '000.00';
        snap.ticks.push(makeTick(2));
        if (snap.latestTick) snap.latestTick.digit = 0;
        expect(window.getSnapshot().ticks).toHaveLength(1);
        expect(window.getSnapshot().ticks[0].quote).toBe(makeTick(1).quote);
        expect(window.getSnapshot().latestTick?.digit).toBe(makeTick(1).digit);
    });

    it('allows the evicted tick identity to be reused only when chronological order permits', () => {
        const window = new RollingTickWindow('1HZ10V', 100);
        for (let index = 0; index < 101; index += 1) window.appendLive(makeTick(index));
        expect(window.count).toBe(100);
        expect(window.appendLive(makeTick(0))).toBe(false); // Too old even after leaving ID set.
        expect(window.count).toBe(100);
        expect(window.getSnapshot().ticks[0].id).toBe(makeTick(1).id);
    });

    it('replacing with a new empty history snapshot clears the previous window', () => {
        const window = new RollingTickWindow('1HZ10V', 500);
        window.replaceHistory(historyBatch(6));
        window.replaceHistory([]);
        expect(window.getSnapshot()).toEqual({
            symbol: '1HZ10V', windowSize: 500,
            ticks: [], count: 0, remaining: 500, isFull: false, latestTick: null,
        });
    });
});

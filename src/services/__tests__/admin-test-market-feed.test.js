import {
    enterAdminTest, exitAdminTest, createAdminTestApi,
} from '../admin-test-kit';

const open = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('Admin Test Kit: shared synthetic market-data clock', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        enterAdminTest();
    });
    afterEach(() => {
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('answers repeated history requests from one stable snapshot, with chronological seconds', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const first = await api.send({ ticks_history: 'R_100', count: 1000, style: 'ticks' });
            const again = await api.send({ ticks_history: 'R_100', count: 1000, style: 'ticks' });
            expect(again.history).toEqual(first.history);
            expect(first.history.times).toHaveLength(1000);
            for (let i = 1; i < first.history.times.length; i++) {
                expect(first.history.times[i]).toBe(first.history.times[i - 1] + 1);
            }
            expect(first.history.prices.every(x => Number.isFinite(x))).toBe(true);
        } finally {
            api.disconnect();
        }
    });

    it('broadcasts exactly the same tick to overlapping Bot Builder, Bulk Trader and direct tick subscribers', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const first = await api.send({ ticks_history: 'R_100', count: 25, style: 'ticks', subscribe: 1 });
            const second = await api.send({ ticks_history: 'R_100', count: 25, style: 'ticks', subscribe: 1 });
            const direct = await api.send({ ticks: 'R_100', subscribe: 1 });
            expect(first.history).toEqual(second.history);
            expect(direct.tick.quote).toBe(first.history.prices.at(-1));
            expect(direct.tick.epoch).toBe(first.history.times.at(-1));

            const events = [];
            const listener = api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'tick') events.push(data);
            });
            await wait(1150);
            const forSub = id => events.filter(event => event.subscription?.id === id);
            const ids = [first.subscription.id, second.subscription.id, direct.subscription.id];
            ids.forEach(id => expect(forSub(id)).toHaveLength(1));
            const observations = ids.map(id => forSub(id)[0].tick);
            expect(new Set(observations.map(tick => tick.epoch)).size).toBe(1);
            expect(new Set(observations.map(tick => tick.quote)).size).toBe(1);
            expect(observations[0].epoch).toBeGreaterThan(direct.tick.epoch);
            const newest = await api.send({ ticks_history: 'R_100', count: 1, style: 'ticks' });
            expect(newest.history.times[0]).toBe(observations[0].epoch);
            expect(newest.history.prices[0]).toBe(observations[0].quote);
            listener.unsubscribe();
        } finally {
            api.disconnect();
        }
    }, 6000);

    it('stops only forgotten tick listeners while preserving candles on the same symbol', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const ticks = await api.send({ ticks_history: 'R_75', count: 10, style: 'ticks', subscribe: 1 });
            const candles = await api.send({ ticks_history: 'R_75', count: 10,
                style: 'candles', granularity: 60, subscribe: 1 });
            const seen = [];
            const listener = api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'tick' || data.msg_type === 'ohlc') seen.push(data);
            });
            expect((await api.forgetAll('ticks')).forget_all).toEqual([ticks.subscription.id]);
            await wait(1150);
            expect(seen.some(event => event.msg_type === 'tick' &&
                event.subscription?.id === ticks.subscription.id)).toBe(false);
            const ohlc = seen.find(event => event.msg_type === 'ohlc' &&
                event.subscription?.id === candles.subscription.id);
            expect(ohlc).toBeDefined();
            expect(ohlc.ohlc.high).toBeGreaterThanOrEqual(ohlc.ohlc.close);
            expect(ohlc.ohlc.low).toBeLessThanOrEqual(ohlc.ohlc.close);
            expect(ohlc.ohlc.open_time % 60).toBe(0);
            listener.unsubscribe();
        } finally {
            api.disconnect();
        }
    }, 6000);

    it('constructs aligned, chronological candles with valid OHLC values and live current-bucket updates', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const history = await api.send({ ticks_history: 'R_100', style: 'candles', granularity: 60, count: 1000 });
            expect(history.candles).toHaveLength(1000);
            for (let i = 0; i < history.candles.length; i++) {
                const candle = history.candles[i];
                expect(candle.epoch % 60).toBe(0);
                expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
                expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
                if (i) expect(candle.epoch - history.candles[i - 1].epoch).toBe(60);
            }
            const again = await api.send({ ticks_history: 'R_100', style: 'candles', granularity: 60, count: 1000 });
            expect(again.candles).toEqual(history.candles);
        } finally {
            api.disconnect();
        }
    });

    it('keeps separate symbols independent and rejects symbols not advertised by the simulator', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const marketA = await api.send({ ticks_history: 'R_100', style: 'ticks', count: 20, subscribe: 1 });
            const marketB = await api.send({ ticks_history: 'R_75', style: 'ticks', count: 20, subscribe: 1 });
            expect(marketA.history.prices).not.toEqual(marketB.history.prices);
            expect((await api.send({ ticks_history: 'MADE_UP', style: 'ticks' })).error.code).toBe('InvalidSymbol');
            expect((await api.send({ ticks: 'MADE_UP' })).error.code).toBe('InvalidSymbol');
            const missing = await api.send({ forget: marketA.subscription.id });
            expect(missing.forget).toBe(1);
        } finally {
            api.disconnect();
        }
    });
});

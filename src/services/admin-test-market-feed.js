/**
 * Shared market-data engine for the LOCAL-ONLY Admin Test Kit.
 *
 * Each symbol has ONE synthetic price clock and a bounded tick history.
 * History responses, direct tick subscriptions, Bot Builder ticks_history
 * subscriptions and OHLC streams all read from the same per-symbol timeline.
 *
 * This is deliberately NOT wired into any genuine Deriv API/WebSocket.
 * Contract pricing and settlement are completed in Step 4.
 */
const TICK_INTERVAL_MS = 1000;
const HISTORY_LIMIT = 5000;
const STREAM_KINDS = new Set(['ticks', 'candles']);

const seedFor = symbol =>
    [...symbol].reduce((seed, char) => ((seed * 31 + char.charCodeAt(0)) >>> 0), 17);

const priceAt = (symbol, epoch) => {
    const seed = seedFor(symbol);
    const base = symbol.includes('75') ? 1750 : symbol.includes('50') ? 1250 :
        symbol.includes('25') ? 1125 : symbol.includes('10') ? 1010 : 2000;
    // Stable for a given symbol and epoch; tests and subscribers see the SAME
    // last digit rather than generating new prices each time history is read.
    const a = Math.sin(epoch * 0.073 + seed * 0.001) * 6;
    const b = Math.sin(epoch * 0.61 + seed * 0.003) * 1.9;
    const c = Math.sin(epoch * 2.17 + seed * 0.013) * 0.32;
    return Number((base + a + b + c).toFixed(2));
};
const tickAt = (symbol, epoch) => ({
    symbol, epoch, quote: priceAt(symbol, epoch), pip_size: 2,
});

const normalizedGranularity = value => Math.max(60, Math.floor(Number(value) || 60));

export const createAdminTestMarketFeed = ({ emit, subscriptions }) => {
    const markets = new Map();
    let closed = false;

    const stateFor = symbol => {
        if (!markets.has(symbol)) {
            const now = Math.floor(Date.now() / 1000);
            const history = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
                tickAt(symbol, now - HISTORY_LIMIT + i + 1)
            );
            markets.set(symbol, { history, last: history[history.length - 1], timer: null });
        }
        return markets.get(symbol);
    };

    const recentTick = symbol => ({ ...stateFor(symbol).last });

    const historyFor = (symbol, count) => {
        const ticks = stateFor(symbol).history.slice(-count);
        return {
            prices: ticks.map(tick => tick.quote),
            times: ticks.map(tick => tick.epoch),
        };
    };

    const candleFromTicks = (symbol, start, granularity, currentEpoch, ticks = []) => {
        const end = Math.min(start + granularity - 1, currentEpoch);
        const startQuote = priceAt(symbol, start);
        const endQuote = priceAt(symbol, end);
        let high = Math.max(startQuote, endQuote);
        let low = Math.min(startQuote, endQuote);
        // Sample the whole period to fill older candle history efficiently.
        // Incorporate EVERY cached live tick so OHLC always encloses the
        // market prices actually delivered to the Bot Builder.
        for (let i = 1; i < 8; i++) {
            const epoch = start + Math.floor((end - start) * i / 8);
            const quote = priceAt(symbol, epoch);
            high = Math.max(high, quote);
            low = Math.min(low, quote);
        }
        ticks.forEach(tick => {
            high = Math.max(high, tick.quote);
            low = Math.min(low, tick.quote);
        });
        return {
            epoch: start,
            open: startQuote,
            high,
            low,
            close: endQuote,
        };
    };

    const candlesFor = (symbol, count, granularityValue) => {
        const granularity = normalizedGranularity(granularityValue);
        const state = stateFor(symbol);
        const latestBucket = Math.floor(state.last.epoch / granularity) * granularity;
        const firstBucket = latestBucket - (count - 1) * granularity;
        const cached = new Map();
        for (const tick of state.history) {
            const bucket = Math.floor(tick.epoch / granularity) * granularity;
            if (bucket < firstBucket) continue;
            if (!cached.has(bucket)) cached.set(bucket, []);
            cached.get(bucket).push(tick);
        }
        return Array.from({ length: count }, (_, i) => {
            const start = firstBucket + i * granularity;
            return candleFromTicks(symbol, start, granularity, state.last.epoch, cached.get(start));
        });
    };

    const hasSubscribers = symbol => [...subscriptions.values()].some(
        sub => sub.symbol === symbol && STREAM_KINDS.has(sub.kind)
    );

    const publishTick = symbol => {
        if (closed) return;
        const state = stateFor(symbol);
        // Bot Builder's TicksService ignores repeated integer-second epochs.
        // One emission per second with a strictly increasing epoch prevents
        // "Waiting for signal" stalls caused by discarded duplicate ticks.
        const epoch = Math.max(Math.floor(Date.now() / 1000), state.last.epoch + 1);
        const tick = tickAt(symbol, epoch);
        state.last = tick;
        state.history.push(tick);
        if (state.history.length > HISTORY_LIMIT) state.history.shift();

        for (const [id, sub] of subscriptions) {
            if (sub.symbol !== symbol) continue;
            const subscription = { id };
            if (sub.kind === 'ticks') {
                emit({ msg_type: 'tick', tick: { ...tick, id }, subscription });
            } else if (sub.kind === 'candles') {
                const granularity = normalizedGranularity(sub.granularity);
                const current = candlesFor(symbol, 1, granularity)[0];
                emit({
                    msg_type: 'ohlc',
                    ohlc: {
                        ...current,
                        symbol,
                        granularity,
                        id,
                        open_time: current.epoch,
                    },
                    subscription,
                });
            }
        }
    };

    const subscriptionChanged = symbol => {
        if (!symbol || closed) return;
        const state = stateFor(symbol);
        if (hasSubscribers(symbol)) {
            if (!state.timer) state.timer = setInterval(() => publishTick(symbol), TICK_INTERVAL_MS);
        } else if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }
    };

    const close = () => {
        closed = true;
        markets.forEach(state => {
            if (state.timer) clearInterval(state.timer);
            state.timer = null;
        });
        markets.clear();
    };

    return { recentTick, historyFor, candlesFor, subscriptionChanged, close };
};

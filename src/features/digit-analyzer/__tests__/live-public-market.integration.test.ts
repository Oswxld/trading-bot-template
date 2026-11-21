/** @jest-environment node */
import { fetchSyntheticMarketCatalog } from '../services/market-catalog';
import { fetchHistoricalTicks } from '../services/historical-ticks';
import { countDigitFrequencies } from '../services/digit-frequency';
import { calculateDigitPercentages } from '../services/digit-percentages';
import { calculateDigitParity } from '../services/digit-parity';
import { calculateDigitOverUnder } from '../services/digit-over-under';
import { calculateDigitMatchesDiffers } from '../services/digit-matches-differs';
import { evaluateDigitPatternWalkForward } from '../services/digit-pattern-walkforward';
import { LiveTickStream } from '../services/live-tick-stream';
import PublicMarketDataClient, { DERIV_PUBLIC_MARKET_WS_URL } from '../services/public-market-data-client';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

/**
 * Opt-in *real network* probe, not an API fixture.
 *
 * RUN_DERIV_LIVE_PROBE=1 npx jest --runInBand --coverage=false \
 *   src/features/digit-analyzer/__tests__/live-public-market.integration.test.ts
 *
 * This test sends ONLY active_symbols, ticks, forget, and the existing public
 * client's keepalive. It does not access accounts, tokens or trading endpoints.
 *
 * The test is intentionally excluded from everyday offline Jest runs.
 * An actual failure (DNS, handshake, API rejection, bad payload or timeout)
 * MUST fail this workflow; never silently substitute fake market data.
 */
const liveTest = process.env.RUN_DERIV_LIVE_PROBE === '1' ? it : it.skip;

liveTest('connects to Deriv public WebSocket, loads markets, receives ticks and forgets subscription', async () => {
    if (typeof WebSocket !== 'function') {
        throw new Error('Node.js runtime does not expose the native WebSocket client');
    }

    const client = new PublicMarketDataClient({ requestTimeoutMs: 20_000 });
    const stateChanges: string[] = [];
    const removeStateListener = client.onStateChange(state => stateChanges.push(state));
    const messageTypes: string[] = [];
    const removeMessageListener = client.onMessage(message => {
        if (message.msg_type && messageTypes.length < 12) messageTypes.push(message.msg_type);
    });
    let stream: LiveTickStream | undefined;

    try {
        console.log('[DERIV LIVE] public endpoint:', DERIV_PUBLIC_MARKET_WS_URL);
        // The public catalog helper calls connect() and request() on the REAL
        // transport. No test-specific factory or network interception is used.
        const markets = await fetchSyntheticMarketCatalog(client);
        expect(client.getState()).toBe('live');
        expect(markets.length).toBeGreaterThan(0);

        const selectable = markets.filter(market => market.isOpen !== false);
        expect(selectable.length).toBeGreaterThan(0);
        // Prefer a one-second synthetic instrument for predictable arrival.
        // Fallback remains data-driven from the currently available catalog.
        const chosen = selectable.find(market => market.symbol === '1HZ10V') ??
            selectable.find(market => market.symbol === '1HZ100V') ??
            selectable.find(market => market.symbol === 'R_10') ??
            selectable[0];
        expect(chosen.symbol).toMatch(/^[A-Za-z0-9_]{2,30}$/);
        console.log('[DERIV LIVE] synthetic markets:', markets.length,
            '| open/available:', selectable.length,
            '| chosen:', chosen.symbol, chosen.displayName,
            '| symbol pip increment:', chosen.pipSize ?? 'unknown');

        const ticks: AnalyzerTick[] = [];
        let resolveTwoTicks: (() => void) | undefined;
        const twoTicks = new Promise<void>(resolve => { resolveTwoTicks = resolve; });
        stream = new LiveTickStream(client);

        // The LiveTickStream validates the correlated subscription response,
        // quote precision, ID and symbol before calling this callback.
        await stream.subscribe(chosen.symbol, tick => {
            ticks.push(tick);
            if (ticks.length >= 2) resolveTwoTicks?.();
        });
        let tickTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                twoTicks,
                new Promise<never>((_, reject) => {
                    tickTimeout = setTimeout(() => reject(new Error('No second real tick arrived within 25 seconds')), 25_000);
                }),
            ]);
        } finally {
            if (tickTimeout) clearTimeout(tickTimeout);
        }

        expect(ticks.length).toBeGreaterThanOrEqual(2);
        for (const tick of ticks) {
            expect(tick.id).toMatch(new RegExp(`^${chosen.symbol}:`));
            expect(tick.epoch).toBeGreaterThan(1_000_000_000);
            expect(tick.quote).toMatch(/^-?\d+(?:\.\d+)?$/);
            expect(tick.digit).toBe(Number(tick.quote.charAt(tick.quote.length - 1)));
            expect(tick.digit).toBeGreaterThanOrEqual(0);
            expect(tick.digit).toBeLessThanOrEqual(9);
        }
        const liveHistogram = countDigitFrequencies(ticks);
        expect(liveHistogram.totalTicks).toBe(ticks.length);
        expect(liveHistogram.counts.reduce((sum, count) => sum + count, 0)).toBe(ticks.length);
        expect(calculateDigitParity(liveHistogram).even + calculateDigitParity(liveHistogram).odd)
            .toBe(ticks.length);

        console.log('[DERIV LIVE] two verified ticks:',
            ticks.slice(0, 2).map(t => ({ quote: t.quote, lastDigit: t.digit, epoch: t.epoch })));
        expect(messageTypes).toContain('active_symbols');
        expect(messageTypes).toContain('tick');

        // Actual forget confirmation is required. If Deriv rejects or does
        // not acknowledge cancellation, the stream closes its public socket.
        await stream.stop();
        const countAfterStop = ticks.length;
        await new Promise(resolve => setTimeout(resolve, 1800));
        expect(ticks.length).toBe(countAfterStop);
        expect(messageTypes).toContain('forget');
        console.log('[DERIV LIVE] forget confirmed; no post-stop ticks; states:', stateChanges.join(' -> '));
    } finally {
        removeMessageListener();
        removeStateListener();
        // close() is immediate and terminates all subscriptions even if
        // stop() previously failed. Never leave a live anonymous socket open.
        client.dispose();
        if (stream) await stream.dispose();
        expect(client.getState()).toBe('idle');
    }
}, 105_000);

/**
 * Real history validation deliberately runs separately from live subscriptions.
 * A plain ticks_history request MUST NOT create a second subscription.
 */
liveTest('fetches 100 / 500 / 1000 authentic historical ticks with exact quote precision', async () => {
    const client = new PublicMarketDataClient({ requestTimeoutMs: 25_000 });
    const historyResponses: Array<{ hasSubscription: boolean; messageType: string | undefined }> = [];
    const unsubscribe = client.onMessage(message => {
        if (message.msg_type === 'history') {
            historyResponses.push({
                hasSubscription: !!message.subscription,
                messageType: message.msg_type,
            });
        }
    });
    try {
        const catalog = await fetchSyntheticMarketCatalog(client);
        const markets = catalog.filter(market => market.isOpen !== false);
        expect(markets.length).toBeGreaterThan(0);
        const selected = markets.find(m => m.symbol === '1HZ10V') ?? markets[0];
        console.log('[DERIV HISTORY] market:', selected.symbol, '| public channel:', DERIV_PUBLIC_MARKET_WS_URL);

        for (const count of [100, 500, 1000] as const) {
            const ticks = await fetchHistoricalTicks(client, selected.symbol, count);
            expect(ticks.length).toBeGreaterThan(0);
            expect(ticks.length).toBeLessThanOrEqual(count);
            expect(ticks.every(t => t.id.startsWith(`history:${selected.symbol}:`))).toBe(true);
            expect(ticks.every(t => /^[0-9]$/.test(t.quote.charAt(t.quote.length - 1)))).toBe(true);
            expect(ticks.every(t => t.digit === Number(t.quote.charAt(t.quote.length - 1)))).toBe(true);
            expect(ticks.every((t, index) => index === 0 || t.epoch >= ticks[index - 1].epoch)).toBe(true);

            // Full statistical pipeline from unmodified, authentic Deriv
            // prices: compare every derived result to an independent scan.
            const frequencies = countDigitFrequencies(ticks);
            const distribution = calculateDigitPercentages(frequencies);
            const parity = calculateDigitParity(frequencies);
            expect(frequencies.totalTicks).toBe(ticks.length);
            expect(frequencies.counts.reduce((sum, n) => sum + n, 0)).toBe(ticks.length);
            expect(distribution.hasData).toBe(true);
            expect(distribution.percentages.reduce((sum, n) => sum + n, 0)).toBeCloseTo(100, 8);
            expect(parity.even).toBe(ticks.filter(t => t.digit % 2 === 0).length);
            expect(parity.odd).toBe(ticks.filter(t => t.digit % 2 === 1).length);
            for (let selectedDigit = 0; selectedDigit <= 9; selectedDigit += 1) {
                const overUnder = calculateDigitOverUnder(frequencies, selectedDigit);
                const matchesDiffers = calculateDigitMatchesDiffers(frequencies, selectedDigit);
                expect(overUnder.over).toBe(ticks.filter(t => t.digit > selectedDigit).length);
                expect(overUnder.under).toBe(ticks.filter(t => t.digit < selectedDigit).length);
                expect(overUnder.equal).toBe(ticks.filter(t => t.digit === selectedDigit).length);
                expect(overUnder.over + overUnder.under + overUnder.equal).toBe(ticks.length);
                expect(matchesDiffers.matches).toBe(overUnder.equal);
                expect(matchesDiffers.differs).toBe(ticks.length - overUnder.equal);
                expect(matchesDiffers.matches + matchesDiffers.differs).toBe(ticks.length);
            }
            console.log('[DERIV STATS] genuine ticks:', ticks.length,
                '| even:', parity.even, '| odd:', parity.odd,
                '| digit 7:', frequencies.counts[7],
                '| complete invariant checks for thresholds/digits 0..9: passed');
            console.log('[DERIV HISTORY] requested:', count, '| received:', ticks.length,
                '| oldest:', ticks[0].epoch, '| newest:', ticks[ticks.length - 1].epoch,
                '| newest quote:', ticks[ticks.length - 1].quote,
                '| last digit:', ticks[ticks.length - 1].digit);
        }
        expect(historyResponses).toHaveLength(3);
        expect(historyResponses.every(x => x.messageType === 'history' && !x.hasSubscription)).toBe(true);
        expect(client.getState()).toBe('live');
    } finally {
        unsubscribe();
        client.dispose();
        expect(client.getState()).toBe('idle');
    }
}, 105_000);


/**
 * Opt-in public-data walk-forward audit, with ZERO fabricated market outcomes.
 * These are short observational snapshots for diagnostic benchmarking, not
 * demonstrations of statistically significant or profitable predictions.
 *
 * The 1,000-tick API limit permits 900 one-tick holdouts for the 100-tick
 * strategy and 500 for the 500-tick strategy. A 1,000-tick strategy requires
 * at least 1,001 ticks; this probe must honestly return insufficient-holdout.
 */
liveTest('walk-forward tests real Deriv next ticks with a frequency-only baseline', async () => {
    const client = new PublicMarketDataClient({ requestTimeoutMs: 25_000 });
    try {
        const catalog = await fetchSyntheticMarketCatalog(client);
        const open = catalog.filter(market => market.isOpen !== false);
        const first = open.find(market => market.symbol === '1HZ10V') ??
            open.find(market => market.symbol === 'R_10') ?? open[0];
        const second = open.find(market =>
            market.symbol === '1HZ100V' && market.symbol !== first.symbol
        ) ?? open.find(market =>
            market.symbol === 'R_75' && market.symbol !== first.symbol
        ) ?? open.find(market => market.symbol !== first.symbol);
        if (!first || !second) {
            throw new Error('Two distinct genuine public synthetic instruments are required');
        }

        for (const market of [first, second]) {
            // Unmodified, real one-off history. Never subscribe, authorize or buy.
            const ticks = await fetchHistoricalTicks(client, market.symbol, 1000);
            expect(ticks).toHaveLength(1000);
            expect(ticks.every(tick =>
                tick.id.startsWith(`history:${market.symbol}:`)
            )).toBe(true);

            for (const size of [100, 500, 1000] as const) {
                const backtest = evaluateDigitPatternWalkForward(market.symbol, ticks, size);
                if (size === 1000) {
                    expect(backtest.status).toBe('insufficient-holdout');
                    expect(backtest.evaluatedTicks).toBe(0);
                    console.log('[DERIV WALKFORWARD]', market.symbol, '| window:', size,
                        '| no held-out tick (requires at least 1001 real ticks)');
                    continue;
                }
                expect(backtest.status).toBe('evaluated');
                if (backtest.status !== 'evaluated') throw new Error('Expected a real holdout sample');
                expect(backtest.evaluatedTicks).toBe(1000 - size);
                expect(backtest.holdouts[0].observedIndex).toBe(size);
                expect(backtest.holdouts.at(-1)?.observedIndex).toBe(999);
                expect(backtest.uniformReferenceRate).toBe(0.1);
                for (const method of [backtest.model, backtest.frequencyBaseline]) {
                    expect(method.creditedHitRate).toBeGreaterThanOrEqual(0);
                    expect(method.creditedHitRate).toBeLessThanOrEqual(1);
                    expect(method.uniquePicks + method.tiedPicks).toBe(backtest.evaluatedTicks);
                }
                console.log('[DERIV WALKFORWARD]',
                    '| market:', market.symbol,
                    '| window:', size,
                    '| genuine held-out ticks:', backtest.evaluatedTicks,
                    '| pattern tie-adjusted hit:', (100 * backtest.model.creditedHitRate).toFixed(2) + '%',
                    '| simple frequency baseline:', (100 * backtest.frequencyBaseline.creditedHitRate).toFixed(2) + '%',
                    '| equal-digit reference: 10.00%',
                    '| model unique predictions:', backtest.model.uniquePicks,
                    '| model ties:', backtest.model.tiedPicks,
                    '| exploratory only, NOT validated probability or proven edge');
            }
        }
        expect(client.getState()).toBe('live');
    } finally {
        client.dispose();
        expect(client.getState()).toBe('idle');
    }
}, 140_000);

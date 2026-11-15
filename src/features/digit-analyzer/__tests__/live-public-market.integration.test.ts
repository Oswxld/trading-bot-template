/** @jest-environment node */
import { fetchSyntheticMarketCatalog } from '../services/market-catalog';
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

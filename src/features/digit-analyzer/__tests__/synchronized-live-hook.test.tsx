import { act, renderHook, waitFor } from '@testing-library/react';
import { useLiveTicks } from '../hooks/use-live-ticks';
import PublicMarketDataClient from '../services/public-market-data-client';
import { countDigitFrequencies } from '../services/digit-frequency';
import { calculateDigitPercentages } from '../services/digit-percentages';
import { calculateDigitParity } from '../services/digit-parity';
import { calculateDigitOverUnder } from '../services/digit-over-under';
import { calculateDigitMatchesDiffers } from '../services/digit-matches-differs';
import type { AnalyzerSampleSize } from '../types/digit-analyzer.types';

class MultiRequestSocket {
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    closeCount = 0;

    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.closeCount += 1; this.readyState = 3; }
    send(payload: string) {
        const request = JSON.parse(payload) as Record<string, unknown>;
        this.sent.push(request);
        if (request.forget) {
            queueMicrotask(() => this.reply({ msg_type: 'forget', req_id: request.req_id, forget: 1 }));
        }
    }
    reply(message: unknown) {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    }
    findRequest(key: 'ticks' | 'ticks_history', symbol: string, count?: number) {
        const entry = [...this.sent].reverse().find(item =>
            item[key] === symbol && (count === undefined || item.count === count)
        );
        if (!entry) throw new Error(`Missing ${key} request for ${symbol} ${count ?? ''}`);
        return entry;
    }
    history(symbol: string, count: number, {
        start = 1770000000,
        prices,
    }: {
        start?: number;
        prices?: number[];
    } = {}) {
        const request = this.findRequest('ticks_history', symbol, count);
        const data = prices ?? Array.from({ length: count }, (_, i) => 120 + i / 100);
        this.reply({
            msg_type: 'history',
            req_id: request.req_id,
            pip_size: 2,
            echo_req: { ticks_history: symbol, count, end: 'latest', style: 'ticks' },
            history: { prices: data, times: data.map((_, index) => start + index) },
        });
    }
    ack(symbol: string, epoch: number, price: number) {
        const request = this.findRequest('ticks', symbol);
        this.reply({
            msg_type: 'tick',
            req_id: request.req_id,
            subscription: { id: 'stream-' + symbol },
            tick: { symbol, epoch, quote: price, pip_size: 2 },
        });
    }
    tick(symbol: string, epoch: number, price: number) {
        this.reply({
            msg_type: 'tick',
            subscription: { id: 'stream-' + symbol },
            tick: { symbol, epoch, quote: price, pip_size: 2 },
        });
    }
}

describe('useLiveTicks: historical + live rolling window integration', () => {
    let client: PublicMarketDataClient;
    let socket: MultiRequestSocket;

    beforeEach(async () => {
        socket = new MultiRequestSocket();
        client = new PublicMarketDataClient({
            socketFactory: () => socket as unknown as WebSocket,
        });
        const opening = client.connect();
        socket.open();
        await opening;
    });
    afterEach(() => client.dispose());

    const awaitInitial = async (symbol: string, count: number) => {
        await waitFor(() => expect(socket.sent.some(r => r.ticks === symbol)).toBe(true));
        await waitFor(() => expect(socket.sent.some(r =>
            r.ticks_history === symbol && r.count === count)).toBe(true));
    };

    it('loads 100 history ticks, de-duplicates the overlapping first live tick, then rolls', async () => {
        const { result, unmount } = renderHook(() => useLiveTicks(client, 'R_10', true, 100));
        await awaitInitial('R_10', 100);

        // Live first, while history is pending.
        act(() => socket.ack('R_10', 1770000099, 120.99));
        await waitFor(() => expect(result.current.sampleCount).toBe(1));
        expect(result.current.status).toBe('streaming');
        expect(result.current.historyPhase).toBe('loading');

        // The final historical observation is that same real tick.
        act(() => socket.history('R_10', 100));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.sampleCount).toBe(100); // NOT 101
        expect(result.current.recentTicks[0].quote).toBe('120.99');
        expect(result.current.recentTicks).toHaveLength(20);
        expect(result.current.rollingTicks).toHaveLength(100);
        expect(result.current.rollingTicks[0].epoch).toBe(1770000000);

        act(() => socket.tick('R_10', 1770000100, 121.00));
        expect(result.current.sampleCount).toBe(100);
        expect(result.current.rollingTicks[0].epoch).toBe(1770000001);
        expect(result.current.latestTick?.quote).toBe('121.00');
        unmount();
    });

    it('changes sample size 100 → 500 without creating a second stream', async () => {
        const { result, rerender } = renderHook(
            ({ count }: { count: AnalyzerSampleSize }) => useLiveTicks(client, 'R_10', true, count),
            { initialProps: { count: 100 as AnalyzerSampleSize } }
        );
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000099, 120.99));
        act(() => socket.history('R_10', 100));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.sampleCount).toBe(100);

        rerender({ count: 500 });
        expect(result.current.historyPhase).toBe('loading');
        expect(result.current.sampleCount).toBe(100);
        await waitFor(() => expect(socket.sent.some(r => r.ticks_history === 'R_10' && r.count === 500)).toBe(true));

        act(() => socket.tick('R_10', 1770000100, 121.00));
        act(() => socket.history('R_10', 500, { start: 1769999600 }));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.sampleCount).toBe(500);
        expect(result.current.latestTick?.quote).toBe('121.00');
        expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(1);
        expect(socket.sent.filter(r => r.ticks_history === 'R_10')).toHaveLength(2);
        expect(socket.sent.filter(r => !!r.subscribe)).toHaveLength(1);
    });

    it('ignores a late 500 response after a rapid 500 → 1000 resize', async () => {
        const { result, rerender } = renderHook(
            ({ count }: { count: AnalyzerSampleSize }) => useLiveTicks(client, 'R_10', true, count),
            { initialProps: { count: 100 as AnalyzerSampleSize } }
        );
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000200, 120.00));

        rerender({ count: 500 });
        rerender({ count: 1000 });
        await waitFor(() => expect(socket.sent.some(r => r.ticks_history === 'R_10' && r.count === 1000)).toBe(true));

        act(() => socket.history('R_10', 500, { start: 1770000000 }));
        expect(result.current.historyPhase).toBe('loading');
        act(() => socket.history('R_10', 1000, { start: 1769999201 }));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.sampleCount).toBe(1000);
        expect(result.current.rollingTicks.every(t => t.epoch >= 1769999201)).toBe(true);
        expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(1);
    });

    it('never shows R_10 history or quotes after selecting R_75', async () => {
        const { result, rerender } = renderHook(
            ({ symbol }) => useLiveTicks(client, symbol, true, 100),
            { initialProps: { symbol: 'R_10' } }
        );
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000099, 120.99));
        await waitFor(() => expect(result.current.status).toBe('streaming'));

        rerender({ symbol: 'R_75' });
        expect(result.current.sampleCount).toBe(0);
        expect(result.current.latestTick).toBeNull();
        expect(result.current.recentTicks).toEqual([]);
        await awaitInitial('R_75', 100);

        act(() => socket.history('R_10', 100)); // Late response from obsolete market.
        act(() => socket.ack('R_75', 1770000100, 456.78));
        act(() => socket.history('R_75', 100, { start: 1770000000 }));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.sampleCount).toBe(100);
        expect(result.current.latestTick?.quote).toBe('456.78');
        expect(result.current.rollingTicks.every(t => t.id.includes('R_75:'))).toBe(true);
        expect(socket.sent.filter(r => r.ticks === 'R_75')).toHaveLength(1);
    });

    it('preserves live data and reports an error when the historical API fails', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true, 100));
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000100, 121.00));
        const req = socket.findRequest('ticks_history', 'R_10', 100);
        act(() => socket.reply({ req_id: req.req_id, error: { message: 'History rate limited' } }));
        await waitFor(() => expect(result.current.historyPhase).toBe('error'));
        expect(result.current.historyError).toBe('History rate limited');
        expect(result.current.sampleCount).toBe(1);
        expect(result.current.status).toBe('streaming');

        act(() => socket.tick('R_10', 1770000101, 121.01));
        expect(result.current.sampleCount).toBe(2);
        expect(result.current.latestTick?.quote).toBe('121.01');
    });

    it('preserves verified live quotes when a corrupted historical payload arrives', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true, 100));
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000100, 121.00));
        await waitFor(() => expect(result.current.sampleCount).toBe(1));

        const request = socket.findRequest('ticks_history', 'R_10', 100);
        act(() => socket.reply({
            msg_type: 'history',
            req_id: request.req_id,
            history: { prices: [1.23, 1.24], times: [1770000000, 1770000001] },
            // Missing required pip_size: never infer an unverified last digit.
        }));
        await waitFor(() => expect(result.current.historyPhase).toBe('error'));
        expect(result.current.historyError).toContain('precision');
        expect(result.current.sampleCount).toBe(1);
        expect(result.current.latestTick?.quote).toBe('121.00');

        act(() => socket.tick('R_10', 1770000101, 121.01));
        expect(result.current.sampleCount).toBe(2);
        expect(result.current.latestTick?.quote).toBe('121.01');
    });

    it('drops all cached prices after an interrupted connection disables the analysis feed', async () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useLiveTicks(client, 'R_10', enabled, 100),
            { initialProps: { enabled: true } }
        );
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000100, 121.00));
        await waitFor(() => expect(result.current.sampleCount).toBe(1));
        expect(result.current.latestTick?.quote).toBe('121.00');

        // The parent catalog receives the socket state change and disables
        // its analysis hook until a NEW public client is connected.
        act(() => client.close());
        rerender({ enabled: false });
        expect(result.current.sampleCount).toBe(0);
        expect(result.current.recentTicks).toEqual([]);
        expect(result.current.latestTick).toBeNull();
        expect(result.current.status).toBe('idle');
        expect(result.current.historyPhase).toBe('idle');

        // The obsolete request and a late frame cannot repopulate the feed.
        act(() => socket.history('R_10', 100));
        expect(result.current.sampleCount).toBe(0);
        expect(result.current.latestTick).toBeNull();
    });

    it('derives all five statistics from real-shaped socket history and simultaneous live ticks', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true, 100));
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000099, 120.99));
        // Live tick 99 is also included in history; count it only once.
        act(() => socket.history('R_10', 100));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));

        act(() => {
            socket.tick('R_10', 1770000100, 121.00);
            socket.tick('R_10', 1770000101, 121.01);
            socket.tick('R_10', 1770000102, 121.02);
        });
        await waitFor(() => expect(result.current.latestTick?.quote).toBe('121.02'));
        const { rollingTicks, sampleCount } = result.current;
        expect(sampleCount).toBe(100);
        expect(rollingTicks.length).toBe(100);

        const frequencies = countDigitFrequencies(rollingTicks);
        const distribution = calculateDigitPercentages(frequencies);
        const parity = calculateDigitParity(frequencies);
        expect(frequencies.counts.reduce((a, b) => a + b, 0)).toBe(sampleCount);
        expect(distribution.percentages.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
        expect(parity.even + parity.odd).toBe(sampleCount);
        for (let selected = 0; selected <= 9; selected += 1) {
            const over = calculateDigitOverUnder(frequencies, selected);
            const matches = calculateDigitMatchesDiffers(frequencies, selected);
            expect(over.over).toBe(rollingTicks.filter(t => t.digit > selected).length);
            expect(over.under).toBe(rollingTicks.filter(t => t.digit < selected).length);
            expect(matches.matches).toBe(rollingTicks.filter(t => t.digit === selected).length);
            expect(matches.matches).toBe(over.equal);
            expect(matches.differs).toBe(sampleCount - matches.matches);
        }
        expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(1);
        expect(socket.sent.filter(r => r.ticks_history === 'R_10')).toHaveLength(1);
        expect(socket.sent.every(r => !r.buy && !r.authorize)).toBe(true);
    });

    it('recalculates statistics only for the newest market across rapid R_10 → R_75 → R_10 switches', async () => {
        const { result, rerender } = renderHook(
            ({ symbol }) => useLiveTicks(client, symbol, true, 100),
            { initialProps: { symbol: 'R_10' } }
        );
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000099, 120.99));
        act(() => socket.history('R_10', 100));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        expect(result.current.rollingTicks.length).toBe(100);

        rerender({ symbol: 'R_75' });
        expect(result.current.sampleCount).toBe(0);
        await awaitInitial('R_75', 100);
        act(() => socket.ack('R_75', 1770000100, 456.78));
        act(() => socket.history('R_75', 100, {
            prices: Array(100).fill(456.78), start: 1770000000,
        }));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        let frequencies = countDigitFrequencies(result.current.rollingTicks);
        expect(frequencies.counts[8]).toBe(100);
        expect(frequencies.counts[9]).toBe(0);

        rerender({ symbol: 'R_10' });
        expect(result.current.sampleCount).toBe(0);
        await waitFor(() => expect(socket.sent.filter(r => r.ticks_history === 'R_10')).toHaveLength(2));
        await waitFor(() => expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(2));
        act(() => socket.ack('R_10', 1770000200, 876.54));
        act(() => socket.history('R_10', 100, {
            prices: Array(100).fill(876.54), start: 1770000101,
        }));
        await waitFor(() => expect(result.current.historyPhase).toBe('ready'));
        frequencies = countDigitFrequencies(result.current.rollingTicks);
        expect(frequencies.counts[4]).toBe(100);
        expect(frequencies.counts[8]).toBe(0);
        expect(result.current.rollingTicks.every(t => t.id.includes('R_10:'))).toBe(true);
        expect(socket.sent.filter(r => !!r.subscribe).every(r => r.ticks === 'R_10' || r.ticks === 'R_75'))
            .toBe(true);
        expect(socket.sent.filter(r => !!r.subscribe)).toHaveLength(3);
    });

    it('reports a consistent partial sample after a failed history request, even during incoming live ticks', async () => {
        const { result } = renderHook(() => useLiveTicks(client, 'R_10', true, 500));
        await awaitInitial('R_10', 500);
        act(() => socket.ack('R_10', 1770000000, 120.00));
        const historyRequest = socket.findRequest('ticks_history', 'R_10', 500);
        act(() => {
            socket.tick('R_10', 1770000001, 120.01);
            socket.tick('R_10', 1770000002, 120.02);
            socket.reply({ req_id: historyRequest.req_id, error: { message: 'Rate limited' } });
        });
        await waitFor(() => expect(result.current.historyPhase).toBe('error'));
        expect(result.current.sampleCount).toBe(3);
        const frequency = countDigitFrequencies(result.current.rollingTicks);
        expect(frequency.counts.slice(0, 3)).toEqual([1, 1, 1]);
        expect(calculateDigitParity(frequency).even).toBe(2);
        expect(calculateDigitOverUnder(frequency, 1).over).toBe(1);
        expect(calculateDigitMatchesDiffers(frequency, 1).matches).toBe(1);
        expect(result.current.status).toBe('streaming');
        expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(1);
    });

    it('forgets the market stream on unmount and ignores a late history response', async () => {
        const { unmount, result } = renderHook(() => useLiveTicks(client, 'R_10', true, 100));
        await awaitInitial('R_10', 100);
        act(() => socket.ack('R_10', 1770000100, 121.00));
        await waitFor(() => expect(result.current.status).toBe('streaming'));
        unmount();

        await waitFor(() => expect(socket.sent.some(r => r.forget === 'stream-R_10')).toBe(true));
        act(() => socket.history('R_10', 100));
        expect(socket.sent.filter(r => r.ticks === 'R_10')).toHaveLength(1);
    });
});

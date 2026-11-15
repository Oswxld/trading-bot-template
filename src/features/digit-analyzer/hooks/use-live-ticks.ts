import { useEffect, useMemo, useState } from 'react';
import { fetchHistoricalTicks } from '../services/historical-ticks';
import { LiveTickStream } from '../services/live-tick-stream';
import type PublicMarketDataClient from '../services/public-market-data-client';
import SynchronizedTickWindow from '../services/synchronized-tick-window';
import type { HistoryLoadPhase } from '../services/synchronized-tick-window';
import type { RollingTickSnapshot } from '../services/rolling-tick-window';
import type { AnalyzerSampleSize } from '../types/digit-analyzer.types';

export type LiveTickStatus = 'idle' | 'subscribing' | 'streaming' | 'error';

const MAX_VISIBLE_TICKS = 20;

type TickView = {
    owner: SynchronizedTickWindow | null;
    snapshot: RollingTickSnapshot | null;
    status: LiveTickStatus;
    error: string | null;
    historyPhase: HistoryLoadPhase;
    historyError: string | null;
};

const EMPTY_VIEW: TickView = {
    owner: null,
    snapshot: null,
    status: 'idle',
    error: null,
    historyPhase: 'idle',
    historyError: null,
};

const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

/**
 * Chunk 4.3 — historical snapshot and live ticks share one public WebSocket.
 *
 * The live subscription and one-off historical request begin independently.
 * Real live ticks received while history loads are buffered and reconciled by
 * SynchronizedTickWindow, avoiding cross-source double counts.
 *
 * Changing the sample window refetches history without restarting the stream.
 * Changing markets replaces the rolling window and stops the old subscription.
 * Obsolete callbacks/responses are ignored, and UI never leaks another market.
 */
export const useLiveTicks = (
    client: PublicMarketDataClient | null,
    selectedSymbol: string,
    enabled: boolean,
    sampleSize: AnalyzerSampleSize = 1000
) => {
    const [view, setView] = useState<TickView>(EMPTY_VIEW);
    const controller = useMemo(() => client ? new LiveTickStream(client) : null, [client]);
    const session = useMemo(
        () => client && selectedSymbol ? new SynchronizedTickWindow(selectedSymbol, sampleSize) : null,
        // Resizing the sample must keep the same live subscription + session.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [client, selectedSymbol]
    );

    useEffect(() => () => {
        // Leaving Analysis (or replacing its public client) stops streaming.
        void controller?.dispose();
    }, [controller]);

    useEffect(() => {
        let current = true;
        if (!controller || !session || !enabled || !selectedSymbol) {
            setView(EMPTY_VIEW);
            return () => { current = false; };
        }

        setView({
            owner: session,
            snapshot: session.snapshot(),
            status: 'subscribing',
            error: null,
            historyPhase: 'idle',
            historyError: null,
        });

        void controller.subscribe(selectedSymbol, tick => {
            if (!current) return;
            try {
                session.receiveLive(tick);
                setView(previous => previous.owner === session ? {
                    ...previous,
                    snapshot: session.snapshot(),
                    status: 'streaming',
                    error: null,
                } : previous);
            } catch (reason) {
                setView(previous => previous.owner === session ? {
                    ...previous,
                    status: 'error',
                    error: errorMessage(reason, 'Invalid market tick received.'),
                } : previous);
            }
        }).catch(reason => {
            if (!current) return;
            setView(previous => previous.owner === session ? {
                ...previous,
                status: 'error',
                error: errorMessage(reason, 'Unable to subscribe to market ticks.'),
            } : previous);
        });

        return () => {
            current = false;
            session.dispose();
            void controller.stop().catch(() => undefined);
        };
    }, [controller, enabled, selectedSymbol, session]);

    useEffect(() => {
        if (!client || !session || !enabled || !selectedSymbol) return;
        let current = true;
        const generation = session.beginHistory(sampleSize);

        setView(previous => previous.owner === session ? {
            ...previous,
            snapshot: session.snapshot(),
            historyPhase: 'loading',
            historyError: null,
        } : previous);

        // A one-off request on the SAME socket. Never subscribe to history.
        void fetchHistoricalTicks(client, selectedSymbol, sampleSize).then(history => {
            if (!current || !session.completeHistory(generation, history)) return;
            setView(previous => previous.owner === session ? {
                ...previous,
                snapshot: session.snapshot(),
                historyPhase: 'ready',
                historyError: null,
            } : previous);
        }).catch(reason => {
            if (!current || !session.failHistory(generation)) return;
            setView(previous => previous.owner === session ? {
                ...previous,
                snapshot: session.snapshot(), // Preserve all genuine live ticks.
                historyPhase: 'error',
                historyError: errorMessage(reason, 'Unable to retrieve historical ticks.'),
            } : previous);
        });

        return () => { current = false; };
    }, [client, enabled, sampleSize, selectedSymbol, session]);

    // Render-time ownership checks mask stale data before React effects run.
    const active = enabled && !!selectedSymbol && !!controller && !!session && view.owner === session;
    const snapshot = active ? view.snapshot : null;
    const status: LiveTickStatus = !enabled || !controller || !session
        ? 'idle'
        : !active
            ? 'subscribing'
            : view.status === 'streaming' && !snapshot?.latestTick
                ? 'subscribing'
                : view.status;

    return {
        latestTick: snapshot?.latestTick ?? null,
        recentTicks: snapshot?.ticks.slice(-MAX_VISIBLE_TICKS).reverse() ?? [],
        sampleCount: snapshot?.count ?? 0,
        rollingTicks: snapshot?.ticks ?? [],
        status,
        error: active && status === 'error' ? view.error : null,
        historyPhase: active ? view.historyPhase : 'idle' as HistoryLoadPhase,
        historyError: active ? view.historyError : null,
    };
};

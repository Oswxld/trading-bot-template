import { useEffect, useMemo, useState } from 'react';
import { LiveTickStream } from '../services/live-tick-stream';
import type PublicMarketDataClient from '../services/public-market-data-client';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

export type LiveTickStatus = 'idle' | 'subscribing' | 'streaming' | 'error';

const MAX_VISIBLE_TICKS = 20;

/**
 * Mount-scoped live price display — not the rolling digit-analysis engine.
 * Reuses the existing Analyzer public socket; never opens a second one.
 *
 * Tick frequency statistics, history and pause/resume are later chunks.
 */
export const useLiveTicks = (
    client: PublicMarketDataClient | null,
    selectedSymbol: string,
    enabled: boolean
) => {
    const [latestTick, setLatestTick] = useState<AnalyzerTick | null>(null);
    const [recentTicks, setRecentTicks] = useState<AnalyzerTick[]>([]);
    const [status, setStatus] = useState<LiveTickStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const controller = useMemo(() => client ? new LiveTickStream(client) : null, [client]);

    useEffect(() => () => {
        // Release any active stream on leaving Analysis or switching clients.
        void controller?.dispose();
    }, [controller]);

    useEffect(() => {
        let current = true;
        setLatestTick(null);
        setRecentTicks([]);
        setError(null);
        if (!controller || !enabled || !selectedSymbol) {
            setStatus('idle');
            return () => { current = false; };
        }
        setStatus('subscribing');

        void controller.subscribe(selectedSymbol, tick => {
            if (!current) return;
            setLatestTick(tick);
            setRecentTicks(previous => [tick, ...previous].slice(0, MAX_VISIBLE_TICKS));
            setStatus('streaming');
        }).catch(reason => {
            if (!current) return;
            setStatus('error');
            setError(reason instanceof Error ? reason.message : 'Unable to subscribe to market ticks.');
        });

        return () => {
            current = false;
            void controller.stop().catch(() => undefined);
        };
    }, [controller, enabled, selectedSymbol]);

    // Effects run after render. Suppress an old market's values synchronously
    // during the render in which the selection changes, before cleanup runs.
    // This also prevents stale prices being shown while the feed is disabled.
    const prefix = `${selectedSymbol}:`;
    const visibleTick = enabled && latestTick?.id.startsWith(prefix) ? latestTick : null;
    const visibleRecent = enabled && selectedSymbol
        ? recentTicks.filter(tick => tick.id.startsWith(prefix))
        : [];
    const visibleStatus: LiveTickStatus = !enabled || !selectedSymbol || !controller
        ? 'idle'
        : status === 'streaming' && !visibleTick
            ? 'subscribing'
            : status;

    return {
        latestTick: visibleTick,
        recentTicks: visibleRecent,
        status: visibleStatus,
        error: visibleStatus === 'error' ? error : null,
    };
};

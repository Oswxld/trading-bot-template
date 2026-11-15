import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';
import RollingTickWindow from './rolling-tick-window';
import type { RollingTickSnapshot } from './rolling-tick-window';

export type HistoryLoadPhase = 'idle' | 'loading' | 'ready' | 'error';

/** An API tick has no cross-request identifier; compare observed values only. */
const sameObservation = (a: AnalyzerTick, b: AnalyzerTick): boolean =>
    a.epoch === b.epoch && a.quote === b.quote;

/**
 * Return buffered live ticks that history could NOT already contain.
 *
 * The history snapshot may be taken before OR after the first live tick. Find
 * the longest contiguous history suffix that occurs within buffered live data
 * and discard buffered events up to and including that overlap.
 *
 * A single tick's epoch and quote are not globally unique. When no sequence
 * overlap can be proved, only trust live ticks strictly NEWER (in seconds)
 * than the historical snapshot. This is conservative: it can omit a true
 * same-second tick but cannot double-count an ambiguous historical duplicate.
 * Multiple genuine same-second live events after a verified overlap remain.
 */
export const reconcileBufferedLive = (
    history: readonly AnalyzerTick[],
    bufferedLive: readonly AnalyzerTick[]
): AnalyzerTick[] => {
    if (!history.length) return [...bufferedLive];
    if (!bufferedLive.length) return [];

    let bestLength = 0;
    let bestEnd = -1;

    for (let end = 0; end < bufferedLive.length; end += 1) {
        let length = 0;
        while (length < history.length && length <= end &&
            sameObservation(
                history[history.length - 1 - length],
                bufferedLive[end - length]
            )) {
            length += 1;
        }
        // On a tie, prefer the later matching end to avoid replaying
        // ambiguous, repeated same-price ticks from the same second.
        if (length >= bestLength && length > 0) {
            bestLength = length;
            bestEnd = end;
        }
    }

    const latestHistoryEpoch = history[history.length - 1].epoch;
    const unseen = bestEnd >= 0
        ? bufferedLive.slice(bestEnd + 1)
        : bufferedLive.filter(tick => tick.epoch > latestHistoryEpoch);

    // Discard stale timestamps that could arrive after the subscription ack.
    return unseen.filter(tick => tick.epoch >= latestHistoryEpoch);
};

/**
 * Combines one snapshot history request with a live stream without opening
 * sockets itself. The existing LiveTickStream supplies verified live ticks.
 *
 * A generation token invalidates delayed responses from old window sizes.
 * Every replacement is staged in a fresh RollingTickWindow and installed only
 * after complete validation, so a bad history response leaves live data intact.
 * The in-flight buffer is bounded and never grows beyond twice the window size.
 */
export class SynchronizedTickWindow {
    private window: RollingTickWindow;
    private generation = 0;
    private historyPhase: HistoryLoadPhase = 'idle';
    private bufferedLive: AnalyzerTick[] = [];
    private readonly maximumBufferedMultiplier = 2;
    private disposed = false;

    constructor(symbol: string, size: AnalyzerSampleSize) {
        this.window = new RollingTickWindow(symbol, size);
    }

    get phase(): HistoryLoadPhase {
        return this.historyPhase;
    }

    get symbol(): string {
        return this.window.symbol;
    }

    get size(): AnalyzerSampleSize {
        return this.window.windowSize;
    }

    /** Start a fresh history request without resetting the live subscription. */
    beginHistory(size: AnalyzerSampleSize = this.window.windowSize): number {
        if (this.disposed) throw new Error('Synchronized tick window is disposed');
        this.window.setWindowSize(size);
        this.generation += 1;
        this.historyPhase = 'loading';
        // A sample-size change must not lose already-received live ticks that
        // may be newer than the incoming historical snapshot. Stage recent
        // live observations as well as those arriving while the request runs.
        this.bufferedLive = this.window.getSnapshot().ticks
            .filter(tick => !tick.id.startsWith('history:'))
            .slice(-size * this.maximumBufferedMultiplier);
        return this.generation;
    }

    /** Adds a real live tick immediately; buffers it for eventual reconciliation. */
    receiveLive(tick: AnalyzerTick): boolean {
        // A late callback after leaving Analysis cannot repopulate the window.
        if (this.disposed) return false;
        const accepted = this.window.appendLive(tick);
        if (accepted && this.historyPhase === 'loading') {
            this.bufferedLive.push({ ...tick });
            const capacity = this.window.windowSize * this.maximumBufferedMultiplier;
            if (this.bufferedLive.length > capacity) {
                this.bufferedLive.splice(0, this.bufferedLive.length - capacity);
            }
        }
        return accepted;
    }

    /**
     * Commit ONLY the matching request's history; return false for stale work.
     * A one-time history request must never trigger a tick subscription.
     */
    completeHistory(generation: number, history: readonly AnalyzerTick[]): boolean {
        if (this.disposed || this.historyPhase !== 'loading' || generation !== this.generation) return false;

        // A partial, stale, or empty snapshot must not roll the displayed
        // sample backwards. This can occur with cached/stale API responses or
        // rapid window changes while the latest accepted observation is newer.
        // Leave all verified ticks untouched and let failHistory() report it.
        const currentLatest = this.window.getSnapshot().latestTick;
        const historyLatest = history.length ? history[history.length - 1] : null;
        if (currentLatest?.id.startsWith('history:') &&
            (!historyLatest || historyLatest.epoch < currentLatest.epoch)) {
            throw new Error('Historical response is older than the current verified sample');
        }

        const staged = new RollingTickWindow(this.window.symbol, this.window.windowSize);
        staged.replaceHistory(history);
        const unseen = reconcileBufferedLive(history, this.bufferedLive);
        for (const tick of unseen) staged.appendLive(tick);

        this.window = staged;
        this.historyPhase = 'ready';
        this.bufferedLive = [];
        return true;
    }

    /**
     * A history error must not discard confirmed live observations or stop
     * streaming. UI can show the error while continuing with live-only ticks.
     */
    failHistory(generation: number): boolean {
        if (this.disposed || this.historyPhase !== 'loading' || generation !== this.generation) return false;
        this.historyPhase = 'error';
        this.bufferedLive = [];
        return true;
    }

    /** Invalidate all outstanding responses when Analysis is closed. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation += 1;
        this.bufferedLive = [];
        this.historyPhase = 'idle';
        this.window.clear();
    }

    snapshot(): RollingTickSnapshot {
        return this.window.getSnapshot();
    }
}

export default SynchronizedTickWindow;

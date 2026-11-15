import { ANALYZER_SAMPLE_SIZES } from '../types/digit-analyzer.types';
import type { AnalyzerSampleSize, AnalyzerTick } from '../types/digit-analyzer.types';

export type RollingTickSnapshot = {
    symbol: string;
    windowSize: AnalyzerSampleSize;
    /** Oldest to newest. Only actual received ticks are included. */
    ticks: AnalyzerTick[];
    count: number;
    remaining: number;
    isFull: boolean;
    latestTick: AnalyzerTick | null;
};

const assertWindowSize = (size: number): asserts size is AnalyzerSampleSize => {
    if (!ANALYZER_SAMPLE_SIZES.includes(size as AnalyzerSampleSize)) {
        throw new Error('Rolling tick window must be 100, 500 or 1000');
    }
};

const assertSymbol = (symbol: string): void => {
    if (typeof symbol !== 'string' || !/^[A-Za-z0-9_]{2,30}$/.test(symbol)) {
        throw new Error('Invalid rolling tick market symbol');
    }
};

/**
 * Enforce the format produced by normalizeLiveTick / normalizeHistoricalTicks.
 * The ID source matters: the same underlying tick may have different history
 * and live IDs; cross-source reconciliation belongs to Chunk 4.3.
 */
const validateTick = (tick: AnalyzerTick, symbol: string): void => {
    if (!tick || typeof tick.id !== 'string' ||
        typeof tick.quote !== 'string' ||
        typeof tick.epoch !== 'number' || !Number.isSafeInteger(tick.epoch) || tick.epoch <= 0 ||
        typeof tick.digit !== 'number' || !Number.isInteger(tick.digit) ||
        tick.digit < 0 || tick.digit > 9 ||
        !/^-?\d+(?:\.\d+)?$/.test(tick.quote) ||
        Number(tick.quote.charAt(tick.quote.length - 1)) !== tick.digit) {
        throw new Error('Invalid normalized tick in rolling window');
    }
    const prefix = tick.id.startsWith('history:') ? `history:${symbol}:` : `${symbol}:`;
    if (!tick.id.startsWith(prefix)) {
        throw new Error('Rolling tick belongs to another market');
    }
    const suffix = tick.id.slice(prefix.length);
    const parts = /^(\d+):(\d+)$/.exec(suffix);
    if (!parts || Number(parts[1]) !== tick.epoch || !Number.isSafeInteger(Number(parts[2])) ||
        Number(parts[2]) < 1) {
        throw new Error('Invalid tick identity in rolling window');
    }
};

/**
 * Bounded, in-memory, read-only-market rolling window.
 *
 * The internal ring buffer retains at most the requested 100/500/1000 real
 * observations. Append is O(1); snapshot/reconfiguration is O(windowSize).
 * No WebSocket, timers, account state, trade requests or simulated data.
 *
 * Source ordering is enforced but we deliberately do not de-duplicate on
 * price/timestamp: Deriv may publish several genuine ticks at the same second
 * with identical prices. Cross-history/live overlap is reconciled in 4.3.
 */
export class RollingTickWindow {
    private marketSymbol: string;
    private capacity: AnalyzerSampleSize;
    private buffer: Array<AnalyzerTick | undefined>;
    private head = 0;
    private length = 0;
    private identifiers = new Set<string>();

    constructor(symbol: string, size: AnalyzerSampleSize = 1000) {
        assertSymbol(symbol);
        assertWindowSize(size);
        this.marketSymbol = symbol;
        this.capacity = size;
        this.buffer = new Array<AnalyzerTick | undefined>(size);
    }

    get symbol(): string {
        return this.marketSymbol;
    }

    get windowSize(): AnalyzerSampleSize {
        return this.capacity;
    }

    get count(): number {
        return this.length;
    }

    /**
     * Replaces prior observations with a validated historical snapshot.
     * Validate the *entire* response first, including entries outside the
     * requested window, so malformed data cannot partially corrupt state.
     */
    replaceHistory(history: readonly AnalyzerTick[]): void {
        if (!Array.isArray(history)) throw new Error('Invalid historical tick batch');
        let previousEpoch = 0;
        const allIds = new Set<string>();
        for (const tick of history) {
            validateTick(tick, this.marketSymbol);
            if (!tick.id.startsWith(`history:${this.marketSymbol}:`)) {
                throw new Error('Historical snapshot must contain historical tick IDs');
            }
            if (tick.epoch < previousEpoch) {
                throw new Error('Historical ticks are not in chronological order');
            }
            if (allIds.has(tick.id)) {
                throw new Error('Historical snapshot contains a duplicate tick ID');
            }
            previousEpoch = tick.epoch;
            allIds.add(tick.id);
        }

        const mostRecent = history.slice(-this.capacity);
        this.clear();
        for (const tick of mostRecent) this.insert(tick);
    }

    /**
     * Returns true only when a new observation enters the window.
     * Rejects an exact duplicate ID or a late event older than the newest
     * recorded tick. Equal-second events are allowed when IDs differ.
     */
    appendLive(tick: AnalyzerTick): boolean {
        validateTick(tick, this.marketSymbol);
        if (tick.id.startsWith('history:')) {
            throw new Error('Live append requires a live tick ID');
        }
        if (this.identifiers.has(tick.id)) return false;
        const latest = this.peekLatest();
        if (latest && tick.epoch < latest.epoch) return false;
        this.insert(tick);
        return true;
    }

    /**
     * Retain the newest observations on shrink. Expanding never invents or
     * restores previously evicted ticks; Chunk 4.3 can request more history.
     */
    setWindowSize(size: AnalyzerSampleSize): void {
        assertWindowSize(size);
        if (this.capacity === size) return;
        const recent = this.asArray().slice(-size);
        this.capacity = size;
        this.buffer = new Array<AnalyzerTick | undefined>(size);
        this.head = 0;
        this.length = 0;
        this.identifiers.clear();
        for (const tick of recent) this.insert(tick);
    }

    /** A change of instrument must discard every tick from the old symbol. */
    changeMarket(symbol: string): void {
        assertSymbol(symbol);
        if (symbol === this.marketSymbol) return;
        this.marketSymbol = symbol;
        this.clear();
    }

    /** Reset the current instrument without changing its selected window. */
    clear(): void {
        this.buffer = new Array<AnalyzerTick | undefined>(this.capacity);
        this.head = 0;
        this.length = 0;
        this.identifiers.clear();
    }

    getSnapshot(): RollingTickSnapshot {
        const ticks = this.asArray().map(tick => ({ ...tick }));
        return {
            symbol: this.marketSymbol,
            windowSize: this.capacity,
            ticks,
            count: ticks.length,
            remaining: this.capacity - ticks.length,
            isFull: ticks.length === this.capacity,
            latestTick: ticks.length > 0 ? { ...ticks[ticks.length - 1] } : null,
        };
    }

    private peekLatest(): AnalyzerTick | undefined {
        if (this.length === 0) return undefined;
        return this.buffer[(this.head + this.length - 1) % this.capacity];
    }

    private asArray(): AnalyzerTick[] {
        const ticks: AnalyzerTick[] = [];
        for (let index = 0; index < this.length; index += 1) {
            const tick = this.buffer[(this.head + index) % this.capacity];
            if (tick) ticks.push(tick);
        }
        return ticks;
    }

    private insert(tick: AnalyzerTick): void {
        const copy = { ...tick };
        if (this.length < this.capacity) {
            this.buffer[(this.head + this.length) % this.capacity] = copy;
            this.length += 1;
        } else {
            const removed = this.buffer[this.head];
            if (removed) this.identifiers.delete(removed.id);
            this.buffer[this.head] = copy;
            this.head = (this.head + 1) % this.capacity;
        }
        this.identifiers.add(copy.id);
    }
}

export default RollingTickWindow;

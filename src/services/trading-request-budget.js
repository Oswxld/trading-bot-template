/**
 * Client-side soft budget for Deriv's shared trading WebSocket request group:
 * proposal, buy, sell and proposal_open_contract.
 *
 * The published limits are 360/min and 14,400/hour. Bulk Trader deliberately
 * uses lower soft caps of 240/min and 12,000/hour to leave capacity for Deriv
 * Bot, settlement checks and other traffic. These caps are not server limits.
 *
 * Install on the *WebSocket* before constructing DerivAPIBasic so ALL actual
 * outgoing trading frames on this browser connection are counted, even when
 * another component uses its own API helper. Only Bulk Trader's orders are
 * delayed by this module; existing Bot Builder sends are never intercepted
 * or modified beyond read-only metering.
 */
export const TRADING_SOFT_LIMITS = Object.freeze({
    minute: 240,
    hour: 12000,
});

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const trackedSockets = new WeakSet();

// Intentionally shared across socket replacements in the same browser page;
// reconnecting does not reset the locally observed hourly budget.
const meter = {
    minute: [],
    hour: [],
    gate: Promise.resolve(),
    backoffUntil: 0,
    consecutiveRateLimits: 0,
};

const isTradingPayload = payload => Boolean(
    payload && typeof payload === 'object' &&
    ['proposal', 'buy', 'sell', 'proposal_open_contract'].some(key =>
        Object.prototype.hasOwnProperty.call(payload, key))
);

export const isTradingRateLimitError = error => {
    const detail = String([error?.code, error?.message, error?.name].filter(Boolean).join(' '));
    return /rate.?limit|throttl|too many requests|request.?limit|calls.?limit/i.test(detail);
};

const prune = now => {
    while (meter.minute.length && meter.minute[0] <= now - MINUTE_MS) meter.minute.shift();
    while (meter.hour.length && meter.hour[0] <= now - HOUR_MS) meter.hour.shift();
};

const observeFrame = frame => {
    if (typeof frame !== 'string') return;
    let payload;
    try {
        payload = JSON.parse(frame);
    } catch {
        return;
    }
    if (!isTradingPayload(payload)) return;
    const now = Date.now();
    prune(now);
    meter.minute.push(now);
    meter.hour.push(now);
};

/** Read-only observation of all trading sends on an underlying WebSocket. */
export const trackTradingSocket = socket => {
    if (!socket || typeof socket.send !== 'function') {
        throw new Error('Trading rate limiter needs an active WebSocket.');
    }
    if (trackedSockets.has(socket)) return;

    const original = socket.send;
    const wrapped = function (frame) {
        // A failed socket.send does not consume a local request allowance.
        const result = original.call(this, frame);
        observeFrame(frame);
        return result;
    };

    socket.send = wrapped;
    if (socket.send !== wrapped) {
        throw new Error('Cannot observe the shared WebSocket request budget.');
    }
    trackedSockets.add(socket);
};

const waitNeeded = now => {
    prune(now);
    const minuteWait = meter.minute.length >= TRADING_SOFT_LIMITS.minute
        ? meter.minute[meter.minute.length - TRADING_SOFT_LIMITS.minute] + MINUTE_MS - now + 20
        : 0;
    const hourWait = meter.hour.length >= TRADING_SOFT_LIMITS.hour
        ? meter.hour[meter.hour.length - TRADING_SOFT_LIMITS.hour] + HOUR_MS - now + 20
        : 0;
    return Math.max(0, minuteWait, hourWait, meter.backoffUntil - now);
};

/**
 * Serialize the permit check and synchronous send, NOT the API response.
 * Up to 5 Bulk Trader purchases can still overlap while their individual
 * proposal/buy confirmations arrive. Queued calls are cancellable.
 */
export const sendTradingRequestWithinBudget = async (api, send, canSend, onThrottle) => {
    trackTradingSocket(api?.connection);

    let release;
    const predecessor = meter.gate;
    meter.gate = new Promise(resolve => { release = resolve; });
    await predecessor;

    try {
        let notified = false;
        while (true) {
            if (!canSend()) throw new Error('Bulk trading stopped before sending this request.');
            const remaining = waitNeeded(Date.now());
            if (remaining <= 0) break;
            if (!notified) {
                onThrottle?.(remaining);
                notified = true;
            }
            // Check Stop/account switch frequently instead of sleeping for an
            // entire minute (or hour) while holding a purchase request.
            await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining)));
        }

        if (!canSend()) throw new Error('Bulk trading stopped before sending this request.');
        // The tracking socket counts the frame only if it really gets sent.
        return send();
    } finally {
        release();
    }
};

/** Back off future bulk sends after Deriv reports a rate-limit rejection. */
export const noteTradingRateLimit = api => {
    if (!api?.connection) return;
    meter.consecutiveRateLimits += 1;
    const backoffMs = Math.min(30_000, 1000 * 2 ** Math.min(5, meter.consecutiveRateLimits - 1));
    meter.backoffUntil = Math.max(meter.backoffUntil, Date.now() + backoffMs);
};

export const tradingBudgetSnapshot = () => {
    prune(Date.now());
    return {
        minuteUsed: meter.minute.length,
        minuteLimit: TRADING_SOFT_LIMITS.minute,
        hourUsed: meter.hour.length,
        hourLimit: TRADING_SOFT_LIMITS.hour,
    };
};

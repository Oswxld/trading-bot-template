/**
 * Safety classifications for Bulk Trader's asynchronous proposal / buy flow.
 *
 * An explicit Deriv API rejection with the matching req_id is a failed buy.
 * An unacknowledged buy that may have been sent (timeout, socket loss, send
 * promise rejection, or malformed confirmation) is UNCONFIRMED, NOT failed.
 * Never automatically retry unconfirmed purchases.
 */
const activeBulkRuns = new Set();

export const acquireBulkRun = accountId => {
    if (!accountId || activeBulkRuns.has(accountId)) return false;
    activeBulkRuns.add(accountId);
    return true;
};

export const releaseBulkRun = accountId => {
    if (accountId) activeBulkRuns.delete(accountId);
};

export const makeBulkRequestError = (message, { kind, dispatched = false, requestType, apiCode } = {}) => {
    const error = new Error(message || 'The trading request could not be completed.');
    error.bulkRequest = {
        kind: kind || 'unknown',
        dispatched: Boolean(dispatched),
        requestType: requestType || 'unknown',
        apiCode: apiCode || null,
    };
    return error;
};

/**
 * Determines how to record a failed single trade *operation*, not a contract
 * settlement. 'skipped' means the request was cancelled before being sent,
 * 'failed' means no purchase was confirmed and Deriv rejected the request or
 * the quote failed, and 'unconfirmed' means a buy may have executed.
 */
export const classifyBulkFailure = (error, phase) => {
    const meta = error?.bulkRequest || {};
    if (meta.kind === 'cancelled') {
        return { status: 'skipped', stop: false, requiresStatementCheck: false };
    }

    if (phase === 'buy' && meta.kind === 'api_rejected') {
        return { status: 'failed', stop: false, requiresStatementCheck: false };
    }

    // A request blocked locally before reaching api.send cannot have bought
    // anything. Fail closed on internal dispatch/meter failures.
    if (meta.dispatched === false && meta.kind !== 'unknown') {
        return { status: 'failed', stop: true, requiresStatementCheck: false };
    }

    if (phase === 'buy') {
        return { status: 'unconfirmed', stop: true, requiresStatementCheck: true };
    }

    // A proposal has no money effect. Lost connectivity or missing quotes
    // should still stop the batch rather than burning all queued attempts.
    const stop = ['timeout', 'connection_lost', 'send_rejected', 'dispatch_error'].includes(meta.kind);
    return { status: 'failed', stop, requiresStatementCheck: false };
};

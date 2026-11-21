/** Fail closed on missing account type or currency; never guess mode from ID prefix. */
// Operational batch/concurrency bounds, not spending limits.
export const REAL_LIMITS = Object.freeze({
    trades: 50,
    concurrent: 5,
});

/**
 * Prefer explicit OAuth account classification. Restore practice trading when
 * sessionStorage is missing an account but the *authenticated, matching* Deriv
 * WebSocket confirms the active login. A prefix never grants real-account access.
 */
export const identifyBulkAccount = (account, id, {
    liveAccount = null,
    socketAuthorized = false,
    clientAccount = null,
} = {}) => {
    if (!id) return 'unavailable';
    if (account?.account_id === id && account.currency &&
        (account.account_type === 'demo' || account.account_type === 'real')) {
        return account.account_type;
    }

    // Never turn a known real account into demo based on a stale prefix.
    if (account?.account_id === id && account.account_type === 'real') return 'unavailable';

    if (!socketAuthorized || liveAccount?.loginid !== id || !liveAccount?.currency ||
        (clientAccount?.loginid && clientAccount.loginid !== id)) {
        return 'unavailable';
    }
    if (clientAccount?.is_virtual === 0 || clientAccount?.is_virtual === false) {
        return 'unavailable';
    }

    // Keep backward compatibility with known Deriv virtual account prefixes,
    // but only after the server-authenticated socket identity has been checked.
    const isDemoId = /^(VRT|VRW|DEM|DOT)/i.test(id);
    return clientAccount?.is_virtual === 1 || clientAccount?.is_virtual === true || isDemoId
        ? 'demo'
        : 'unavailable';
};

/**
 * Verify broker account and currency before real purchases; leave the requested
 * stake and aggregate exposure to the user and Deriv's account/market checks.
 */
export const checkRealExposure = ({
    stake, quantity, balance, receivedCurrency, receivedAccount, accountId, currency,
}) => {
    const fail = message => ({ allowed: false, message });
    if (!accountId || !currency || !receivedCurrency || currency !== receivedCurrency ||
        (receivedAccount && String(receivedAccount) !== String(accountId))) {
        return fail('Could not verify account identity or currency. No orders sent.');
    }
    const available = balance === null || balance === undefined || balance === '' ? NaN : Number(balance);
    if (!Number.isFinite(available) || available <= 0) {
        return fail('A positive, freshly verified account balance is required to trade real money.');
    }
    if (!Number.isFinite(stake) || stake <= 0 ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > REAL_LIMITS.trades) {
        return fail('Enter a positive stake and 1–50 trades.');
    }
    const exposure = stake * quantity;
    if (!Number.isFinite(exposure) || exposure <= 0) {
        return fail('Total stake must be a finite positive amount.');
    }
    return { allowed: true, exposure, available };
};

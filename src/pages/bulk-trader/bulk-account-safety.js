/** Fail closed on missing account type or currency; never guess mode from ID prefix. */
export const REAL_LIMITS = Object.freeze({
    trades: 50,
    concurrent: 2,
    stake: 10,
    batch: 100,
    percent: 0.1,
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
 * Real orders require a fresh balance response on the selected authenticated
 * WebSocket. The intended aggregate stake is capped to 10% of funds and by
 * absolute account-currency limits. These controls do not prevent market loss.
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
    if (!Number.isFinite(stake) || stake <= 0 || stake > REAL_LIMITS.stake ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > REAL_LIMITS.trades) {
        return fail('Stake or number of real-account trades exceeds safety limits.');
    }
    const exposure = stake * quantity;
    if (!Number.isFinite(exposure) || exposure > REAL_LIMITS.batch + 1e-8) {
        return fail(`Total real-account stake must not exceed ${REAL_LIMITS.batch} ${currency}.`);
    }
    const permitted = Math.min(REAL_LIMITS.batch, available * REAL_LIMITS.percent);
    if (exposure > permitted + 1e-8) {
        return fail(`Total stake ${exposure.toFixed(2)} ${currency} exceeds 10% of account balance (${permitted.toFixed(2)} ${currency}).`);
    }
    return { allowed: true, exposure, available, permitted };
};

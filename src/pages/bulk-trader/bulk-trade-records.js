/**
 * Account-local UI rows for each attempted Bulk Trader operation.
 * The same row advances from quoting -> buying -> open -> won/lost so the
 * standard Deriv skeleton can be shown while values are not known yet.
 * A row is NOT a confirmed purchase until it has a Deriv contractId.
 */
export const makePendingBulkRecord = ({
    localId,
    number,
    symbol,
    symbolName,
    contractType,
    prediction,
    timestamp = Date.now(),
}) => ({
    localId: String(localId),
    number,
    timestamp,
    contractId: null,
    symbol,
    symbolName,
    contractType,
    prediction,
    price: null,
    status: 'quoting',
    payout: null,
    profit: null,
    entrySpot: null,
    exitSpot: null,
});

export const upsertBulkRecord = (records, item, limit = 300) => {
    const id = item?.localId;
    if (!id) throw new Error('Bulk trade row requires a stable localId.');
    const existingIndex = records.findIndex(record => record.localId === id);
    if (existingIndex === -1) return [item, ...records].slice(0, limit);
    return records.map((record, index) => index === existingIndex ? { ...record, ...item } : record);
};

export const isBulkRowAwaitingData = item =>
    ['quoting', 'buying', 'open'].includes(item?.status);

/**
 * The browser may close or navigate away while a purchase is waiting for a
 * Deriv response. Never resume a shimmer or assume the buy didn't execute
 * after reload. A buying request is ambiguous and blocks further batches
 * until the account statement is reconciled.
 *
 * Recovery is ONLY for records loaded into a freshly mounted/account-switched
 * report, never for the still-active worker's storage upserts.
 */
export const recoverInterruptedBulkRecords = records => records.map(record => {
    if (record.status === 'buying') {
        return {
            ...record,
            status: 'unconfirmed',
            reason: 'The page was left before Deriv confirmed this buy. Check the Deriv account statement before trading again.',
        };
    }
    if (record.status === 'quoting') {
        return {
            ...record,
            status: 'failed',
            reason: 'The page was left before the proposal completed. No purchase was confirmed.',
        };
    }
    return record;
});

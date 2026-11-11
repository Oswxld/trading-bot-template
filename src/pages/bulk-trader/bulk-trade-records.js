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

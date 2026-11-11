/**
 * Bulk Trader settlement helpers. Deriv is the sole source of contract outcome.
 * Never invent P/L from tick predictions or from an unconfirmed purchase.
 *
 * proposal_open_contract can send a one-tick settlement before the matching
 * buy response has been added to the report. Buffer those closed events briefly
 * and apply them after the contract ID is inserted.
 */
const finiteNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const closedStatus = contract => {
    const status = String(contract?.status || '').toLowerCase();
    return status === 'won' || status === 'lost' || status === 'sold' ||
        contract?.is_sold === 1 || contract?.is_sold === true || contract?.is_sold === '1';
};

export const isVerifiedSettlement = contract =>
    Boolean(contract?.contract_id && closedStatus(contract) && finiteNumber(contract.profit) !== null);

/**
 * proposal_open_contract.payout can be the contract's potential payout, which
 * is not necessarily the money actually returned after a LOSS.
 *
 * For purchased options, realized net profit = realized return - buy price.
 * Derive realized return only for a VERIFIED closed trade that has both its
 * actual buy price and a finite Deriv-reported profit; never use an open
 * contract's potential payout as money already received.
 */
export const realizedPayoutForRecord = record => {
    if (!record || !['won', 'lost'].includes(record.status)) return null;
    const paid = finiteNumber(record.price);
    const profit = finiteNumber(record.profit);
    if (paid === null || paid < 0 || profit === null) return null;
    return Math.max(0, Number((paid + profit).toFixed(8)));
};

/**
 * A repeated or out-of-order OPEN event may never undo a settled record.
 * Only closed events with a finite confirmed profit can transition a record to
 * 'won'/'lost'. The actual reported profit/payout are Deriv's own values.
 */
export const mergeContractSettlement = (record, contract) => {
    if (!record || !contract?.contract_id || String(record.contractId) !== String(contract.contract_id)) {
        return record;
    }
    const verified = isVerifiedSettlement(contract);
    const alreadyClosed = record.status === 'won' || record.status === 'lost';
    if (alreadyClosed && !verified) return record;

    const profit = verified ? finiteNumber(contract.profit) : null;
    const explicitStatus = String(contract.status || '').toLowerCase();
    const status = verified
        ? (explicitStatus === 'won' || explicitStatus === 'lost'
            ? explicitStatus
            : profit >= 0 ? 'won' : 'lost')
        : record.status;

    const updated = {
        ...record,
        status,
        profit: verified ? profit : record.profit,
        entrySpot: contract.entry_spot ?? record.entrySpot,
        exitSpot: contract.exit_spot ?? record.exitSpot,
    };
    // The API 'payout' field may remain a potential win amount even if the
    // contract lost. Do not misreport it as a realized credit on the Summary.
    const realizedPayout = verified ? realizedPayoutForRecord(updated) : null;
    return {
        ...updated,
        payout: realizedPayout ?? record.payout,
    };
};

export const createEarlySettlementBuffer = ({
    maxEntries = 100,
    maxAgeMs = 60_000,
    now = Date.now,
} = {}) => {
    const entries = new Map();
    const prune = () => {
        const cutoff = now() - maxAgeMs;
        for (const [id, entry] of entries) {
            if (entry.receivedAt < cutoff) entries.delete(id);
        }
    };
    return {
        remember(contract) {
            if (!isVerifiedSettlement(contract)) return false;
            prune();
            const id = String(contract.contract_id);
            // A repeated event refreshes the most recent confirmed result.
            entries.delete(id);
            entries.set(id, { contract, receivedAt: now() });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
            return true;
        },
        take(contractId) {
            prune();
            const id = String(contractId);
            const entry = entries.get(id);
            entries.delete(id);
            return entry?.contract || null;
        },
        clear() { entries.clear(); },
        size() {
            prune();
            return entries.size;
        },
    };
};

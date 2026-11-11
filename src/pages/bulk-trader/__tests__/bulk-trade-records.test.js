import {
    isBulkRowAwaitingData,
    makePendingBulkRecord,
    upsertBulkRecord,
} from '../bulk-trade-records';
import { mergeContractSettlement } from '../bulk-contract-monitor';

const details = i => ({
    localId: `batch-123:${i}`,
    number: i + 1,
    symbol: 'R_100',
    symbolName: 'Volatility 100 Index',
    contractType: 'Matches',
    prediction: '5',
    timestamp: 1794360000000,
});

describe('Bulk Trader live transaction row lifecycle', () => {
    it('shows a row immediately while proposal/buy values are unknown', () => {
        const pending = makePendingBulkRecord(details(0));
        expect(pending).toMatchObject({
            localId: 'batch-123:0', status: 'quoting',
            contractId: null, entrySpot: null, exitSpot: null,
            price: null, profit: null,
        });
        expect(isBulkRowAwaitingData(pending)).toBe(true);
        expect(isBulkRowAwaitingData({ ...pending, status: 'buying' })).toBe(true);
    });

    it('updates ONE stable row from quoting through buying, open and settled', () => {
        const pending = makePendingBulkRecord(details(0));
        let rows = upsertBulkRecord([], pending);
        rows = upsertBulkRecord(rows, { ...pending, status: 'buying' });
        const confirmed = { ...pending, contractId: '456777', price: 0.5, status: 'open' };
        rows = upsertBulkRecord(rows, confirmed);
        const entered = mergeContractSettlement(confirmed, {
            contract_id: 456777, status: 'open', entry_spot: '510.91',
        });
        rows = upsertBulkRecord(rows, entered);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            localId: 'batch-123:0', contractId: '456777',
            price: 0.5, status: 'open', entrySpot: '510.91', exitSpot: null,
        });

        const finished = mergeContractSettlement(rows[0], {
            contract_id: 456777, status: 'lost', is_sold: 1,
            entry_spot: '510.91', exit_spot: '510.91', profit: '-0.50',
        });
        rows = upsertBulkRecord(rows, finished);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            status: 'lost', profit: -0.5, payout: 0,
            entrySpot: '510.91', exitSpot: '510.91',
        });
        expect(isBulkRowAwaitingData(rows[0])).toBe(false);
    });

    it('never overwrites the wrong operation when buys return out of order', () => {
        const first = makePendingBulkRecord(details(0));
        const second = makePendingBulkRecord(details(1));
        let rows = upsertBulkRecord(upsertBulkRecord([], first), second);
        rows = upsertBulkRecord(rows, {
            ...second, status: 'open', price: 0.50, contractId: 'buy-two',
        });
        rows = upsertBulkRecord(rows, {
            ...first, status: 'open', price: 0.50, contractId: 'buy-one',
        });
        expect(rows).toHaveLength(2);
        expect(rows.map(item => [item.localId, item.contractId])).toEqual([
            ['batch-123:1', 'buy-two'],
            ['batch-123:0', 'buy-one'],
        ]);
    });

    it('replaces pending skeletons with error labels without fake prices', () => {
        const row = makePendingBulkRecord(details(0));
        const after = upsertBulkRecord([row], {
            ...row, status: 'unconfirmed', reason: 'Buy acknowledgement timed out',
        });
        expect(after).toHaveLength(1);
        expect(after[0].price).toBeNull();
        expect(isBulkRowAwaitingData(after[0])).toBe(false);
    });

    it('retains previous 300-row history cap and does not mutate old records', () => {
        const oldRows = Array.from({ length: 300 }, (_, i) =>
            makePendingBulkRecord(details(i + 1))
        );
        const before = oldRows.slice();
        const next = upsertBulkRecord(oldRows, makePendingBulkRecord(details(0)));
        expect(next).toHaveLength(300);
        expect(next[0].localId).toBe('batch-123:0');
        expect(oldRows).toEqual(before);
    });
});

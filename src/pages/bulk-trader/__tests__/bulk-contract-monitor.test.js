import {
    createEarlySettlementBuffer,
    isVerifiedSettlement,
    mergeContractSettlement,
    realizedPayoutForRecord,
} from '../bulk-contract-monitor';

const openRecord = id => ({
    number: 101,
    contractId: String(id),
    symbol: 'R_100',
    status: 'open',
    price: 0.5,
    profit: null,
    payout: null,
    entrySpot: null,
    exitSpot: null,
});

describe('Bulk Trader settlement monitoring (Deriv-reported results only)', () => {
    it('does not invent wins or losses from an open contract profit field', () => {
        const record = openRecord(123);
        const contract = { contract_id: 123, status: 'open', profit: '3.00', payout: '4.00' };
        expect(isVerifiedSettlement(contract)).toBe(false);
        const updated = mergeContractSettlement(record, contract);
        expect(updated).toEqual(expect.objectContaining({
            status: 'open', profit: null, payout: null,
        }));
    });

    it('does not trust an incomplete close event without a numeric profit', () => {
        const record = openRecord('123');
        const incomplete = { contract_id: 123, status: 'won', profit: null, payout: '1.00' };
        expect(isVerifiedSettlement(incomplete)).toBe(false);
        expect(mergeContractSettlement(record, incomplete).status).toBe('open');
        const blank = { contract_id: 123, is_sold: 1, profit: '' };
        expect(isVerifiedSettlement(blank)).toBe(false);
    });

    it('records Deriv string-valued negative profit and zero payout as an actual loss', () => {
        const record = openRecord(123);
        const updated = mergeContractSettlement(record, {
            contract_id: 123, status: 'lost', profit: '-0.50', payout: '0.00',
            entry_spot: '1234.56', exit_spot: '1234.32',
        });
        expect(updated).toEqual(expect.objectContaining({
            status: 'lost',
            profit: -0.5,
            payout: 0,
            entrySpot: '1234.56',
            exitSpot: '1234.32',
        }));
    });

    it('records Deriv string-valued win and protects it against a later stale open update', () => {
        const record = openRecord(123);
        const winning = {
            contract_id: '123', status: 'won', profit: '0.45', payout: '0.95',
            entry_spot: '1000.11', exit_spot: '1000.22',
        };
        const settled = mergeContractSettlement(record, winning);
        expect(settled).toEqual(expect.objectContaining({
            status: 'won', profit: 0.45, payout: 0.95,
        }));

        const staleOpen = mergeContractSettlement(settled, {
            contract_id: 123, status: 'open', profit: '0', payout: '0',
        });
        expect(staleOpen).toBe(settled);
    });

    it('never merges another contract ID into an existing trade', () => {
        const record = openRecord(123);
        const other = { contract_id: 999, status: 'lost', profit: '-0.50' };
        expect(mergeContractSettlement(record, other)).toBe(record);
    });

    it('keeps the raw Deriv explicit lost status, including a zero-profit outcome', () => {
        const result = mergeContractSettlement(openRecord(123), {
            contract_id: 123, status: 'lost', profit: '0', payout: '0',
        });
        expect(result.status).toBe('lost');
        expect(result.profit).toBe(0);
    });

    it('buffers fast one-tick settlement received BEFORE the buy acknowledgement record', () => {
        const buffer = createEarlySettlementBuffer();
        expect(buffer.remember({
            contract_id: 123, status: 'open', profit: '0',
        })).toBe(false);
        const settledEarly = {
            contract_id: 123, status: 'won', profit: '0.45', payout: '0.95',
        };
        expect(buffer.remember(settledEarly)).toBe(true);
        expect(buffer.size()).toBe(1);

        // The buy response is received after the already-settled broadcast.
        const bought = openRecord(123);
        const saved = mergeContractSettlement(bought, buffer.take(bought.contractId));
        expect(saved.status).toBe('won');
        expect(saved.profit).toBe(0.45);
        expect(buffer.take(123)).toBeNull();
    });

    it('evicts old buffered events and limits cache size', () => {
        let currentTime = 1000;
        const buffer = createEarlySettlementBuffer({
            maxEntries: 2, maxAgeMs: 1000, now: () => currentTime,
        });
        const close = id => ({ contract_id: id, status: 'lost', profit: '-0.50' });
        buffer.remember(close(1));
        buffer.remember(close(2));
        buffer.remember(close(3));
        expect(buffer.size()).toBe(2);
        expect(buffer.take(1)).toBeNull();
        currentTime += 1001;
        expect(buffer.take(2)).toBeNull();
        expect(buffer.take(3)).toBeNull();
    });

    it('does not count a potential winning payout as realized money on a lost contract', () => {
        const lost = mergeContractSettlement(openRecord(123), {
            contract_id: 123,
            status: 'lost',
            profit: '-0.50',
            payout: '1.85', // Potential payout displayed by Deriv before settlement.
        });
        expect(lost.status).toBe('lost');
        expect(lost.profit).toBe(-0.5);
        expect(lost.payout).toBe(0);
        expect(realizedPayoutForRecord(lost)).toBe(0);
    });

    it('computes realized payout for a settled win and corrects older cached rows', () => {
        const winner = mergeContractSettlement(openRecord(123), {
            contract_id: 123, status: 'won', profit: '0.45', payout: '0.95',
        });
        expect(realizedPayoutForRecord(winner)).toBe(0.95);
        const outdatedCachedLoss = {
            ...openRecord(124),
            status: 'lost',
            profit: -0.5,
            payout: 1.85,
        };
        expect(realizedPayoutForRecord(outdatedCachedLoss)).toBe(0);
        expect(realizedPayoutForRecord(openRecord(125))).toBeNull();
    });

    it('drops any buffered prior-account settlements on account switch', () => {
        const buffer = createEarlySettlementBuffer();
        buffer.remember({ contract_id: 123, status: 'won', profit: '1.50' });
        buffer.clear();
        expect(buffer.size()).toBe(0);
    });
});

import { requestBulkApi } from '@/pages/bulk-trader/bulk-api-request';
import { placeNextDigitMatch, preflightNextDigitAccount } from '../services/next-digit-order';

jest.mock('@/pages/bulk-trader/bulk-api-request', () => ({
    requestBulkApi: jest.fn(),
}));

const api = { connection: { readyState: 1 } };
const request = jest.mocked(requestBulkApi);
const always = () => true;

describe('Deriv next-digit execution adapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('verifies the genuine DIGITMATCH contract offer and matching account balance', async () => {
        request
            .mockResolvedValueOnce({ contracts_for: { available: [{ contract_type: 'DIGITMATCH' }] } })
            .mockResolvedValueOnce({ balance: { loginid: 'VRT123', currency: 'USD', balance: 25 } });
        const balance = await preflightNextDigitAccount({
            api, symbol: 'R_100', accountId: 'VRT123', currency: 'USD',
            stake: 1, maxTrades: 5, canSend: always,
        });
        expect(balance).toBe(25);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[0][0].payload).toEqual({ contracts_for: 'R_100' });
        expect(request.mock.calls[1][0].payload).toEqual({ balance: 1 });
    });

    it('rejects unavailable real-money balance and mismatched broker identity', async () => {
        request
            .mockResolvedValueOnce({ contracts_for: { available: [{ contract_type: 'DIGITMATCH' }] } })
            .mockResolvedValueOnce({ balance: { loginid: 'CR_WRONG', currency: 'USD', balance: 500 } });
        await expect(preflightNextDigitAccount({
            api, symbol: 'R_100', accountId: 'CR_CORRECT',
            currency: 'USD', stake: 1, maxTrades: 5, canSend: always,
        })).rejects.toThrow(/account or currency/);
    });

    it('makes one Deriv purchase, reports its lifecycle and uses verified settlement P/L', async () => {
        const onProposal = jest.fn();
        const onBought = jest.fn();
        request
            .mockResolvedValueOnce({ proposal: { id: 'quote-123', ask_price: 1 } })
            .mockResolvedValueOnce({ buy: { contract_id: 871234, buy_price: 1 } })
            .mockResolvedValueOnce({ proposal_open_contract: {
                contract_id: 871234, status: 'won', profit: 0.87,
                entry_spot: 123.45, exit_spot: 123.46,
            } });
        const result = await placeNextDigitMatch({
            api, symbol: 'R_100', accountId: 'VRT123', currency: 'USD',
            digit: 7, stake: 1, canBuy: always, canObserve: always, onProposal, onBought,
        });
        expect(result).toMatchObject({
            contractId: '871234', digit: 7, status: 'won', profit: 0.87,
            entrySpot: 123.45, exitSpot: 123.46,
        });
        expect(onProposal).toHaveBeenCalledWith({ proposalId: 'quote-123', price: 1 });
        expect(onBought).toHaveBeenCalledWith(expect.objectContaining({ contractId: '871234', price: 1 }));
        expect(request.mock.calls.filter(call => call[0].payload.buy)).toHaveLength(1);
        expect(request.mock.calls.filter(call => call[0].payload.proposal_open_contract)).toHaveLength(1);
    });

    it('never sends a purchase when the account goes inactive before proposal', async () => {
        await expect(placeNextDigitMatch({
            api, symbol: 'R_100', accountId: 'CR123', currency: 'USD',
            digit: 7, stake: 0.5, canBuy: () => false, canObserve: always,
        })).rejects.toThrow(/stopped/);
        expect(request).not.toHaveBeenCalled();
    });

    it('halts with a manual-reconciliation block when a purchase reply is lost', async () => {
        request
            .mockResolvedValueOnce({ proposal: { id: 'quote-1', ask_price: 0.5 } })
            .mockRejectedValueOnce(Object.assign(new Error('Socket closed'), {
                bulkRequest: { kind: 'connection_lost', dispatched: true, requestType: 'buy' },
            }));
        const promise = placeNextDigitMatch({
            api, symbol: 'R_100', accountId: 'CR123', currency: 'USD',
            digit: 7, stake: 0.5, canBuy: always, canObserve: always,
        });
        await expect(promise).rejects.toMatchObject({ unconfirmed: true });
        expect(request.mock.calls.filter(call => call[0].payload.buy)).toHaveLength(1);
    });

    it('never invents a settlement or buys without a real contract ID', async () => {
        request
            .mockResolvedValueOnce({ proposal: { id: 'quote-1', ask_price: 1 } })
            .mockResolvedValueOnce({ buy: {} });
        const promise = placeNextDigitMatch({
            api, symbol: 'R_100', accountId: 'VRT123', currency: 'USD',
            digit: 9, stake: 1, canBuy: always, canObserve: always,
        });
        await expect(promise).rejects.toMatchObject({ unconfirmed: true });
        expect(request.mock.calls.filter(call => call[0].payload.buy)).toHaveLength(1);
    });
});

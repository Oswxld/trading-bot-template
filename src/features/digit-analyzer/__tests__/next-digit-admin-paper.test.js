/**
 * End-to-end LOCAL mock contract verification for the Next Digit adapter.
 * These tests use the existing Admin Test Kit transport, not any broker token,
 * WebSocket, or Supabase database. Real Deriv ticks are tested separately by
 * the analyzer's existing data-integrity and public-market tests.
 */
jest.mock('@/services/admin-supabase-auth', () => ({
    getAdminAuthUser: jest.fn(() => ({ id: '123e4567-e89b-42d3-a456-426614174000' })),
}));
jest.mock('@/services/admin-sim-balance-sync', () => ({
    isAdminBalanceSyncReady: jest.fn(() => true),
    queueAdminBalanceDelta: jest.fn(),
    setAdminRemoteBalance: jest.fn(async () => undefined),
}));

import {
    createAdminTestApi,
    enterAdminTest,
    exitAdminTest,
    getAdminTestBalances,
    getAdminTestContracts,
    isAdminTestActive,
    setAdminTestWinProbability,
    switchAdminTestAccount,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';
import { placeNextDigitMatch, preflightNextDigitAccount } from '../services/next-digit-order';

const opened = api => new Promise(resolve => {
    if (api.connection.readyState === 1) { resolve(); return; }
    api.connection.addEventListener('open', resolve);
});

const runPaperMatch = async (accountId, probability) => {
    expect(isAdminTestActive()).toBe(true);
    expect(localStorage.getItem('active_loginid')).toBe(accountId);
    const api = createAdminTestApi();
    await opened(api);
    expect(api.isAdminSimulation).toBe(true);
    expect(api.simulatedAccountId).toBe(accountId);
    expect(setAdminTestWinProbability(probability)).toBe(true);

    const canSend = () => isAdminTestActive() && api.isAdminSimulation === true &&
        api.simulatedAccountId === accountId && localStorage.getItem('active_loginid') === accountId &&
        api.connection.readyState === 1;
    try {
        const before = getAdminTestBalances()[accountId];
        await expect(preflightNextDigitAccount({
            api, symbol: 'R_100', accountId, currency: 'USD',
            stake: 1, maxTrades: 2, canSend,
        })).resolves.toBe(before);
        const bought = jest.fn();
        const quoted = jest.fn();
        const result = await placeNextDigitMatch({
            api, symbol: 'R_100', accountId, currency: 'USD', digit: 7,
            stake: 1, canBuy: canSend, canObserve: canSend,
            onProposal: quoted, onBought: bought,
        });
        expect(quoted).toHaveBeenCalledWith(expect.objectContaining({ price: 1 }));
        expect(bought).toHaveBeenCalledWith(expect.objectContaining({
            accountId, symbol: 'R_100', digit: 7, price: 1,
        }));
        expect(result.contractId).toMatch(/^9\d+$/);
        expect(result.status).toBe(probability === 100 ? 'won' : 'lost');
        expect(result.profit).toBe(probability === 100 ? 7.4 : -1);
        const ledger = getAdminTestContracts(accountId);
        expect(ledger).toEqual(expect.arrayContaining([
            expect.objectContaining({
                contract_id: Number(result.contractId), contract_type: 'DIGITMATCH',
                underlying_symbol: 'R_100', is_sold: 1, barrier: '7',
            }),
        ]));
        expect(getAdminTestBalances()[accountId]).toBeCloseTo(before + result.profit, 2);
    } finally {
        api.disconnect();
    }
};

describe('next digit + authenticated Admin Test Kit paper trading', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        expect(enterAdminTest()).toBe(true);
    });
    afterEach(() => {
        exitAdminTest();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('places a genuine MOCK proposal/buy and reports a simulated Demo win', async () => {
        await runPaperMatch(TEST_DEMO_ID, 100);
    }, 12000);

    it('places a MOCK Real-account paper trade with a forced loss and separate balance', async () => {
        const demoBefore = getAdminTestBalances()[TEST_DEMO_ID];
        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        await runPaperMatch(TEST_REAL_ID, 0);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(demoBefore);
    }, 12000);

    it('rejects attempts to buy after exiting the authenticated simulation', async () => {
        const accountId = TEST_DEMO_ID;
        const api = createAdminTestApi();
        await opened(api);
        const guard = () => isAdminTestActive() && api.isAdminSimulation &&
            localStorage.getItem('active_loginid') === accountId;
        exitAdminTest();
        await expect(placeNextDigitMatch({
            api, symbol: 'R_100', accountId, currency: 'USD', digit: 4,
            stake: 1, canBuy: guard, canObserve: guard,
        })).rejects.toThrow();
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000);
        api.disconnect();
    });
});

import TradeEngine from '../index';
import { createScope } from '../../utils/cliTools';
import { api_base } from '../../../api/api-base';
import {
    enterAdminTest,
    exitAdminTest,
    switchAdminTestAccount,
    createAdminTestApi,
    getAdminTestBalances,
    setAdminTestWinProbability,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';

jest.mock('../../../api/api-base', () => ({
    api_base: {
        api: null,
        pip_sizes: { R_100: 2 },
        token: '',
        account_info: {},
        is_running: true,
        pushSubscription: jest.fn(),
        toggleRunButton: jest.fn(),
        clearSubscriptions: jest.fn(),
    },
}));
jest.mock('../../utils/helpers', () => {
    const original = jest.requireActual('../../utils/helpers');
    return {
        ...original,
        checkBlocksForProposalRequest: jest.fn(() => ({
            has_payout_block: false, is_basis_payout: false,
        })),
    };
});

const opened = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const timeout = ms => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Bot Builder did not receive a tick/purchase signal')), ms));

describe('real Bot Builder trading engine against local simulated account', () => {
    let subscriptions;
    beforeEach(() => {
        subscriptions = [];
        localStorage.clear();
        sessionStorage.clear();
        api_base.pushSubscription.mockImplementation(s => subscriptions.push(s));
        enterAdminTest();
        setAdminTestWinProbability(0); // deterministic loss after one purchase
    });
    afterEach(() => {
        subscriptions.forEach(s => s.unsubscribe?.());
        api_base.api?.disconnect();
        api_base.api = null;
        api_base.pushSubscription.mockReset();
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    for (const [name, accountId, initialBalance] of [
        ['Demo', TEST_DEMO_ID, 10000],
        ['Real', TEST_REAL_ID, 500],
    ]) {
        it(`turns simulated ${name} ticks into an unconditional purchase and settlement`, async () => {
            if (accountId === TEST_REAL_ID) switchAdminTestAccount(TEST_REAL_ID);
            const api = createAdminTestApi();
            api_base.api = api;
            api_base.account_info = { loginid: accountId, currency: 'USD' };
            api_base.token = accountId;
            await opened(api);
            const scope = createScope();
            const engine = new TradeEngine(scope);
            engine.init(accountId, {
                symbol: 'R_100',
                contractTypes: ['DIGITDIFF', 'DIGITMATCH'],
                shouldRestartOnError: false,
                timeMachineEnabled: false,
            });
            engine.start({
                amount: 1, basis: 'stake', currency: 'USD',
                contractTypes: ['DIGITDIFF', 'DIGITMATCH'],
                duration: 1, duration_unit: 't',
                limit_order: {},
                prediction: 5,
            });
            expect(await Promise.race([engine.watch('before'), timeout(5000)])).toBe(true);
            await Promise.race([engine.purchase('DIGITDIFF'), timeout(5000)]);
            expect(engine.contractId).toEqual(expect.any(Number));
            expect(getAdminTestBalances()[accountId]).toBe(initialBalance - 1);
            await new Promise(resolve => setTimeout(resolve, 950));
            expect(engine.data.contract).toMatchObject({
                contract_id: engine.data.contract.contract_id,
                status: 'lost',
                is_sold: 1,
            });
            expect(getAdminTestBalances()[accountId]).toBe(initialBalance - 1);
        }, 12000);
    }
});

import TradeEngine from '../index';
import { createScope } from '../../utils/cliTools';
import { start, purchaseSuccessful, sell } from '../state/actions';
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
            await new Promise(resolve => setTimeout(resolve, 1250));
            expect(engine.data.contract).toMatchObject({
                contract_id: engine.data.contract.contract_id,
                status: 'lost',
                is_sold: 1,
            });
            expect(getAdminTestBalances()[accountId]).toBe(initialBalance - 1);
        }, 12000);
    }

    it('runs two consecutive buy-and-settle cycles through the real Bot Builder trading engine', async () => {
        const api = createAdminTestApi();
        api_base.api = api;
        api_base.account_info = { loginid: TEST_DEMO_ID, currency: 'USD' };
        api_base.token = TEST_DEMO_ID;
        await opened(api);
        const scope = createScope();
        const engine = new TradeEngine(scope);
        engine.init(TEST_DEMO_ID, {
            symbol: 'R_100',
            contractTypes: ['DIGITDIFF', 'DIGITMATCH'],
            shouldRestartOnError: false,
            timeMachineEnabled: false,
        });
        const bought = [];
        const sellEvents = [];
        const observer = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                sellEvents.push(data.proposal_open_contract);
            }
        });
        try {
            for (let i = 0; i < 2; i++) {
                engine.start({
                    amount: 1,
                    basis: 'stake',
                    currency: 'USD',
                    contractTypes: ['DIGITDIFF', 'DIGITMATCH'],
                    duration: 1, duration_unit: 't', prediction: 5,
                    limit_order: {},
                });
                expect(await Promise.race([engine.watch('before'), timeout(5000)])).toBe(true);
                await Promise.race([engine.purchase('DIGITDIFF'), timeout(5000)]);
                const contractId = engine.contractId;
                expect(contractId).toEqual(expect.any(Number));
                bought.push(contractId);
                const started = Date.now();
                while (sellEvents.filter(event => event.contract_id === contractId).length === 0 &&
                    Date.now() - started < 4000) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                expect(sellEvents.some(event => event.contract_id === contractId)).toBe(true);
                expect(engine.store.getState().scope).toBe('STOP');
            }
            expect(new Set(bought).size).toBe(2);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9998);
        } finally {
            observer.unsubscribe();
        }
    }, 14000);

    it('does not starve a new Martingale watch when an older engine receives the same tick first', async () => {
        const api = createAdminTestApi();
        api_base.api = api;
        api_base.account_info = { loginid: TEST_DEMO_ID, currency: 'USD' };
        api_base.token = TEST_DEMO_ID;
        await opened(api);

        const first = new TradeEngine(createScope());
        const second = new TradeEngine(createScope());
        const options = {
            symbol: 'R_100',
            contractTypes: ['CALL', 'PUT'],
            shouldRestartOnError: false,
            timeMachineEnabled: false,
        };
        const tradeOptions = {
            amount: 1,
            basis: 'stake',
            currency: 'USD',
            contractTypes: ['CALL', 'PUT'],
            duration: 1,
            duration_unit: 't',
            limit_order: {},
        };
        // Simulates a stale old engine still watching when a newly launched
        // Martingale subscribes on the same market. Both see the SAME epoch.
        first.init(TEST_DEMO_ID, options);
        second.init(TEST_DEMO_ID, options);
        first.start(tradeOptions);
        second.start(tradeOptions);

        const [firstReady, secondReady] = await Promise.race([
            Promise.all([first.watch('before'), second.watch('before')]),
            timeout(5000),
        ]);
        expect(firstReady).toBe(true);
        expect(secondReady).toBe(true);

        await Promise.race([
            Promise.all([first.purchase('CALL'), second.purchase('CALL')]),
            timeout(5000),
        ]);
        expect(first.contractId).toEqual(expect.any(Number));
        expect(second.contractId).toEqual(expect.any(Number));
        expect(second.contractId).not.toBe(first.contractId);
    }, 14000);

    it('exits the post-purchase watcher on settlement even without another tick', async () => {
        const api = createAdminTestApi();
        api_base.api = api;
        await opened(api);
        const engine = new TradeEngine(createScope());
        engine.store.dispatch(start());
        engine.store.dispatch(purchaseSuccessful());
        expect(engine.store.getState().scope).toBe('DURING_PURCHASE');
        const waitingForSettlement = engine.watch('during');
        // The simulator may stop the synthetic market clock at the last
        // contract settlement. The STOP transition itself must release
        // the interpreter, not require one more price tick to arrive.
        engine.store.dispatch(sell());
        expect(await Promise.race([waitingForSettlement, timeout(800)])).toBe(false);
    }, 4000);

    it('recovers local Martingale purchase conditions after its tick subscription is lost', async () => {
        const api = createAdminTestApi();
        api_base.api = api;
        api_base.account_info = { loginid: TEST_DEMO_ID, currency: 'USD' };
        api_base.token = TEST_DEMO_ID;
        await opened(api);

        const engine = new TradeEngine(createScope());
        engine.init(TEST_DEMO_ID, {
            symbol: 'R_100', contractTypes: ['CALL', 'PUT'],
            shouldRestartOnError: false, timeMachineEnabled: false,
        });
        engine.start({
            amount: 1, basis: 'stake', currency: 'USD',
            contractTypes: ['CALL', 'PUT'],
            duration: 1, duration_unit: 't', limit_order: {},
        });
        const stream = engine.$scope.ticksService.ticks_history_promise;
        expect(stream).toBeTruthy();
        await stream.promise;
        // Reproduce the genuine "Bot running, waiting for a signal" stall:
        // a prior cleanup forgot the only subscription on the simulated
        // socket. Without a rearm there will NEVER be another NEW_TICK.
        const removed = await api.forgetAll('ticks');
        expect(removed.forget_all.length).toBeGreaterThan(0);
        const buyReady = await Promise.race([engine.watch('before'), timeout(8500)]);
        expect(buyReady).toBe(true);
        await Promise.race([engine.purchase('CALL'), timeout(4000)]);
        expect(engine.contractId).toEqual(expect.any(Number));
    }, 13000);

});

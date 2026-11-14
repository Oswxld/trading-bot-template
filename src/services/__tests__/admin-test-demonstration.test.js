import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer } from '@/external/bot-skeleton/utils/observer';
import {
    createAdminTestApi, enterAdminTest, exitAdminTest, getAdminTestBalances,
    getAdminTestContracts, setAdminTestWinProbability, switchAdminTestAccount, TEST_DEMO_ID, TEST_REAL_ID,
} from '../admin-test-kit';
import { createAdminTestDemoRunner, readAdminDemoConfig, nextAdminDemoStake } from '../admin-test-demonstration';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: null, account_id: null, is_authorized: true, account_info: null,
        is_running: false, setIsRunning: jest.fn(),
    },
}));

const ready = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const blocks = (symbol, type, stake) => [
    { type: 'trade_definition_market', getFieldValue: k => k === 'SYMBOL_LIST' ? symbol : '' },
    { type: 'trade_definition_tradetype', getFieldValue: k => k === 'TRADETYPE_LIST' ? 'callput' : '' },
    { type: 'purchase', getFieldValue: k => k === 'PURCHASE_LIST' ? type : '' },
    {
        type: 'trade_definition_tradeoptions',
        getFieldValue: k => k === 'DURATIONTYPE_LIST' ? 't' : '',
        getInputTargetBlock: k => ({
            getFieldValue: name => name === 'NUM' ? (k === 'AMOUNT' ? stake : 1) : null,
        }),
    },
];
const workspace = (symbol = 'R_75', type = 'PUT', stake = 1) => ({
    getAllBlocks: () => blocks(symbol, type, stake),
});
const waitUntil = async (predicate, limit = 15000) => {
    const start = Date.now();
    while (!predicate() && Date.now() - start < limit) {
        await new Promise(resolve => setTimeout(resolve, 35));
    }
    if (!predicate()) throw new Error('Paper contracts did not settle by deadline');
};

describe('local-only Bot Builder presentation runner', () => {
    let api;
    beforeEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        enterAdminTest();
        api = createAdminTestApi();
        await ready(api);
        api_base.api = api;
        api_base.setIsRunning.mockImplementation(value => { api_base.is_running = value; });
        api_base.account_id = TEST_DEMO_ID;
        api_base.account_info = { loginid: TEST_DEMO_ID };
    });
    afterEach(() => {
        observer.unregisterAll('bot.contract');
        observer.unregisterAll('bot.stop');
        observer.unregisterAll('ui.log.success');
        api.disconnect();
        api_base.api = null;
        exitAdminTest();
    });

    it('reads the selected market, contract and stake instead of labelling everything CALL', () => {
        const config = readAdminDemoConfig(workspace('1HZ25V', 'PUT', 2), { formData: {} });
        expect(config).toMatchObject({
            symbol: '1HZ25V', contractType: 'PUT', initialStake: 2, duration: 1,
        });
        expect(() => readAdminDemoConfig(workspace('UNKNOWN', 'CALL', 1))).toThrow(/market/);
        expect(() => readAdminDemoConfig(workspace('R_100', 'INVALID', 1))).toThrow(/contract/);
    });

    it('uses zero-percent wins to drive losing Martingale stakes and a consistent paper balance', async () => {
        setAdminTestWinProbability(0);
        const closed = [];
        let runner;
        observer.register('bot.contract', c => {
            if (c?.is_sold && !closed.some(x => x.contract_id === c.contract_id)) {
                closed.push(c);
                if (closed.length >= 3) runner.stop();
            }
        });
        runner = createAdminTestDemoRunner({
            workspace: workspace('1HZ25V', 'PUT', 1),
            formData: { stake: '1', size: '2', duration: '1', profit: '1000', loss: '1000' },
            strategy: 'MARTINGALE',
        });
        await runner.start();
        expect(closed).toHaveLength(3);
        const records = getAdminTestContracts(TEST_DEMO_ID, { source: 'bot_builder' });
        expect(records).toHaveLength(3);
        expect(records.map(r => r.buy_price)).toEqual([1, 2, 4]);
        expect(records.every(r => r.underlying_symbol === '1HZ25V' &&
            r.contract_type === 'PUT' && r.status === 'lost')).toBe(true);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9993);
    }, 15000);

    it('one-hundred-percent wins end at the profit threshold with matching report and balance', async () => {
        setAdminTestWinProbability(100);
        const events = [];
        observer.register('ui.log.success', entry => events.push(entry.log_type));
        const runner = createAdminTestDemoRunner({
            workspace: workspace('R_75', 'CALL', 2),
            formData: { stake: '2', size: '2', profit: '1', loss: '1000' },
            strategy: 'MARTINGALE',
        });
        await runner.start();
        const records = getAdminTestContracts(TEST_DEMO_ID, { source: 'bot_builder' });
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            underlying_symbol: 'R_75', contract_type: 'CALL',
            buy_price: 2, payout: 3.6, sell_price: 3.6, profit: 1.6,
            status: 'won', is_sold: 1,
        });
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10001.6);
        expect(events).toEqual(expect.arrayContaining(['purchase', 'profit']));
    }, 9000);

    it('simulated staking profiles never exceed an explicitly enabled stake limit', () => {
        const config = {
            initialStake: 1, size: 2, unit: 1, maxStake: 3, strategy: 'MARTINGALE',
        };
        expect(nextAdminDemoStake(config, { stake: 2, seriesProfit: -2 }, false)).toBe(3);
        expect(nextAdminDemoStake(config, { stake: 3, seriesProfit: 1 }, true)).toBe(1);
    });

    it('keeps the simulated Real-labelled account ledger separate from Demo', async () => {
        api.disconnect();
        switchAdminTestAccount(TEST_REAL_ID);
        api = createAdminTestApi();
        await ready(api);
        api_base.api = api;
        api_base.account_id = TEST_REAL_ID;
        api_base.account_info = { loginid: TEST_REAL_ID };
        setAdminTestWinProbability(0);
        const runner = createAdminTestDemoRunner({
            workspace: workspace('R_50', 'PUT', 2),
            formData: { stake: '2', size: '2', loss: '1', profit: '1000' },
            strategy: 'MARTINGALE',
        });
        await runner.start();
        const paper = getAdminTestContracts(TEST_REAL_ID, { source: 'bot_builder' });
        expect(paper).toHaveLength(1);
        expect(paper[0]).toMatchObject({
            underlying_symbol: 'R_50', contract_type: 'PUT', buy_price: 2,
            status: 'lost', profit: -2,
        });
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(498);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000);
    }, 9000);

});

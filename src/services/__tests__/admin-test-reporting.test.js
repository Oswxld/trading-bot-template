import {
    createAdminTestApi, enterAdminTest, exitAdminTest,
    getAdminTestBalances, getAdminTestContracts, markAdminTestBotReportCleared,
    setAdminTestWinProbability, switchAdminTestAccount,
    TEST_DEMO_ID, TEST_REAL_ID,
} from '../admin-test-kit';

const open = api => new Promise(resolve => {
    if (api.connection.readyState === 1) resolve();
    else api.connection.addEventListener('open', resolve);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const trade = async (api, { source = 'bot_builder', amount = 1, duration = 1 } = {}) => {
    if (source === 'bulk_trader') {
        const offer = await api.send({
            proposal: 1, amount, duration, duration_unit: 't', basis: 'stake',
            currency: 'USD', contract_type: 'DIGITDIFF', barrier: 5,
            underlying_symbol: 'R_100', subscribe: 1,
        });
        return (await api.send({ buy: offer.proposal.id, price: offer.proposal.ask_price })).buy;
    }
    return (await api.send({
        buy: '1', price: amount,
        parameters: {
            amount, duration, duration_unit: 't', basis: 'stake',
            contract_type: 'DIGITDIFF', currency: 'USD',
            underlying_symbol: 'R_100', barrier: 5,
        },
    })).buy;
};

describe('Admin Test Kit: account-local statement and reporting ledger', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        enterAdminTest();
    });
    afterEach(() => {
        exitAdminTest();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('reports a confirmed buy and settled win with realized payout, contract IDs and correct balance', async () => {
        setAdminTestWinProbability(100);
        const api = createAdminTestApi();
        try {
            await open(api);
            const bought = await trade(api);
            const initially = await api.send({ statement: 1 });
            expect(initially.statement.count).toBe(1);
            expect(initially.statement.transactions).toEqual([
                expect.objectContaining({
                    action_type: 'buy',
                    amount: -1,
                    balance_after: 9999,
                    contract_id: bought.contract_id,
                    transaction_id: bought.transaction_id,
                }),
            ]);

            await wait(1200);
            const final = await api.send({ statement: 1 });
            expect(final.statement.count).toBe(2);
            const credit = final.statement.transactions.find(t => t.action_type === 'sell');
            expect(credit).toMatchObject({
                contract_id: bought.contract_id,
                amount: 1.8,
                balance_after: 10000.8,
                profit: 0.8,
                currency: 'USD',
            });
            expect(credit.transaction_id).not.toBe(bought.transaction_id);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000.8);
            expect((await api.balance()).balance.balance).toBe(10000.8);
        } finally { api.disconnect(); }
    }, 7000);

    it('records a losing sell as zero realized payout rather than potential winning payout', async () => {
        setAdminTestWinProbability(0);
        const api = createAdminTestApi();
        try {
            await open(api);
            const bought = await trade(api, { amount: 2 });
            await wait(1200);
            const final = await api.send({ statement: 1 });
            const sell = final.statement.transactions.find(t => t.action_type === 'sell');
            expect(sell).toMatchObject({
                amount: 0,
                profit: -2,
                contract_id: bought.contract_id,
            });
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9998);
        } finally { api.disconnect(); }
    }, 7000);

    it('retains statement after reconnect and supports pagination without duplicating purchases', async () => {
        setAdminTestWinProbability(0);
        const old = createAdminTestApi();
        await open(old);
        const first = await trade(old, { duration: 2 });
        expect((await old.send({ statement: 1 })).statement.count).toBe(1);
        old.disconnect();

        const replacement = createAdminTestApi();
        try {
            await open(replacement);
            expect((await replacement.send({ statement: 1 })).statement.count).toBe(1);
            await wait(2300);
            const snapshot = await replacement.send({ statement: 1 });
            expect(snapshot.statement.count).toBe(2);
            expect(snapshot.statement.transactions.every(x => x.contract_id === first.contract_id)).toBe(true);
            const page = await replacement.send({ statement: 1, limit: 1, offset: 1 });
            expect(page.statement.count).toBe(2);
            expect(page.statement.transactions).toHaveLength(1);
            expect(new Set(snapshot.statement.transactions.map(row => row.transaction_id)).size).toBe(2);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
        } finally { replacement.disconnect(); }
    }, 8500);

    it('preserves account isolation across simulated Demo and Real, including statements', async () => {
        const demo = createAdminTestApi();
        await open(demo);
        await trade(demo);
        demo.disconnect();
        switchAdminTestAccount(TEST_REAL_ID);
        const real = createAdminTestApi();
        try {
            await open(real);
            expect((await real.send({ statement: 1 })).statement.count).toBe(0);
            const second = await trade(real);
            expect((await real.send({ statement: 1 })).statement.transactions[0].contract_id).toBe(second.contract_id);
            expect(getAdminTestContracts(TEST_DEMO_ID)).toHaveLength(1);
            expect(getAdminTestContracts(TEST_REAL_ID)).toHaveLength(1);
            expect(getAdminTestContracts(TEST_DEMO_ID)[0].contract_id).not.toBe(second.contract_id);
        } finally { real.disconnect(); }
    });

    it('classifies Bulk Trader and Bot Builder separately while retaining both in statement', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const bot = await trade(api, { source: 'bot_builder' });
            const bulk = await trade(api, { source: 'bulk_trader' });
            expect(getAdminTestContracts(TEST_DEMO_ID, { source: 'bot_builder' })
                .map(x => x.contract_id)).toEqual([bot.contract_id]);
            expect(getAdminTestContracts(TEST_DEMO_ID, { source: 'bulk_trader' })
                .map(x => x.contract_id)).toEqual([bulk.contract_id]);
            expect((await api.send({ statement: 1 })).statement.count).toBe(2);
        } finally { api.disconnect(); }
    });

    it('clears only Bot Builder report visibility, not the paper ledger, balance, or Bulk Trader reports', async () => {
        const api = createAdminTestApi();
        try {
            await open(api);
            const prior = await trade(api);
            const bulk = await trade(api, { source: 'bulk_trader' });
            expect(markAdminTestBotReportCleared(TEST_DEMO_ID)).toBe(true);
            expect(getAdminTestContracts(TEST_DEMO_ID, {
                source: 'bot_builder', sinceReportReset: true,
            })).toEqual([]);
            expect(getAdminTestContracts(TEST_DEMO_ID, { source: 'bulk_trader' })[0].contract_id)
                .toBe(bulk.contract_id);
            expect((await api.send({ statement: 1 })).statement.count).toBe(2);
            const newer = await trade(api);
            expect(getAdminTestContracts(TEST_DEMO_ID, {
                source: 'bot_builder', sinceReportReset: true,
            }).map(c => c.contract_id)).toEqual([newer.contract_id]);
            expect(newer.contract_id).toBeGreaterThan(prior.contract_id);
        } finally { api.disconnect(); }
    });

    it('does not expose fake contract history outside local Admin Test Mode', async () => {
        const api = createAdminTestApi();
        await open(api);
        await trade(api);
        expect(getAdminTestContracts(TEST_DEMO_ID)).toHaveLength(1);
        api.disconnect();
        exitAdminTest();
        expect(getAdminTestContracts(TEST_DEMO_ID)).toEqual([]);
        expect(markAdminTestBotReportCleared(TEST_DEMO_ID)).toBe(false);
    });
});

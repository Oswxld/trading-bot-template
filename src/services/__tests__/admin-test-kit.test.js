import {
    ADMIN_TEST_KEY, TEST_DEMO_ID, TEST_REAL_ID,
    isAdminTestActive, enterAdminTest, exitAdminTest,
    switchAdminTestAccount, setAdminTestBalance,
    setAdminTestWinProbability, getAdminTestWinProbability,
    getAdminTestBalances, getAdminTestAccounts, createAdminTestApi,
    isAdminTestTransportReady, isAdminTestSessionReady,
} from '../admin-test-kit';

const opened = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('local admin test kit (no broker connection)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });
    afterEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });
    it('creates two clearly simulated and separate accounts without OAuth login', () => {
        localStorage.setItem('active_loginid', 'PREVIOUS_DERIV_ACCOUNT');
        sessionStorage.setItem('auth_info', 'previous-oauth-session');
        expect(enterAdminTest()).toBe(true);
        expect(isAdminTestActive()).toBe(true);
        expect(sessionStorage.getItem('auth_info')).toBeNull();
        expect(localStorage.getItem('active_loginid')).toBe(TEST_DEMO_ID);
        expect(getAdminTestBalances()).toEqual({ [TEST_DEMO_ID]: 10000, [TEST_REAL_ID]: 500 });
        expect(getAdminTestAccounts().map(x => x.account_type)).toEqual(['demo', 'real']);
        expect(exitAdminTest()).toBe(true);
        expect(sessionStorage.getItem(ADMIN_TEST_KEY)).toBeNull();
        expect(localStorage.getItem('active_loginid')).toBe('PREVIOUS_DERIV_ACCOUNT');
        expect(sessionStorage.getItem('auth_info')).toBe('previous-oauth-session');
    });

    it('authorizes only the matching simulated transport, never the actual Deriv API', async () => {
        enterAdminTest();
        const realSocket = { api: { connection: { readyState: 1 } },
            is_authorized: true, account_id: TEST_DEMO_ID, account_info: { loginid: TEST_DEMO_ID } };
        expect(isAdminTestTransportReady(realSocket)).toBe(false);
        expect(isAdminTestSessionReady(realSocket)).toBe(false);
        const sim = createAdminTestApi();
        await opened(sim);
        const state = {
            api: sim, is_authorized: false,
            account_id: TEST_DEMO_ID, account_info: { loginid: TEST_DEMO_ID },
        };
        expect(isAdminTestTransportReady(state)).toBe(true);
        expect(isAdminTestSessionReady(state)).toBe(false);
        state.is_authorized = true;
        expect(isAdminTestSessionReady(state)).toBe(true);
        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        expect(isAdminTestTransportReady(state)).toBe(false);
        expect(isAdminTestSessionReady(state)).toBe(false);
        sim.disconnect();
    });

    it('provides Bot Builder-compatible tick history, candles, and forgetAll on simulated Real', async () => {
        enterAdminTest();
        switchAdminTestAccount(TEST_REAL_ID);
        const api = createAdminTestApi();
        await opened(api);
        const stream = [];
        const listener = api.onMessage().subscribe(({ data }) => stream.push(data));

        const history = await api.send({
            ticks_history: 'R_100', count: 20, style: 'ticks',
            subscribe: 1, req_id: 203,
        });
        expect(history.msg_type).toBe('history');
        expect(history.req_id).toBe(203);
        expect(history.history.prices).toHaveLength(20);
        expect(history.history.times).toHaveLength(20);
        expect(history.subscription.id).toEqual(expect.any(String));

        const candles = await api.send({
            ticks_history: 'R_100', count: 10, style: 'candles',
            granularity: 60, subscribe: 1, req_id: 204,
        });
        expect(candles.msg_type).toBe('candles');
        expect(candles.candles).toHaveLength(10);

        const cleared = await api.forgetAll('ticks');
        expect(cleared).toHaveProperty('forget_all');
        expect(stream).toContainEqual(expect.objectContaining({
            msg_type: 'history', req_id: 203,
        }));
        expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
        listener.unsubscribe();
        api.disconnect();
    });

    it('uses the correct 0.01 price increment for simulated digit strategies', async () => {
        enterAdminTest();
        const api = createAdminTestApi();
        await opened(api);
        const result = await api.send({ active_symbols: 'brief' });
        expect(result.active_symbols).toEqual(expect.arrayContaining([
            expect.objectContaining({ symbol: 'R_100', pip_size: 0.01, pip: 0.01 }),
        ]));
        api.disconnect();
    });

    it('forget_all ticks leaves all other simulated subscriptions untouched', async () => {
        enterAdminTest();
        const api = createAdminTestApi();
        await opened(api);
        const ticks = await api.send({ ticks_history: 'R_100', style: 'ticks', subscribe: 1 });
        const candles = await api.send({ ticks_history: 'R_100', style: 'candles', subscribe: 1 });
        const balance = await api.send({ balance: 1, subscribe: 1 });
        const transactions = await api.send({ transaction: 1, subscribe: 1 });
        const contracts = await api.send({ proposal_open_contract: 1, subscribe: 1 });
        const tickId = ticks.subscription.id;
        const candleId = candles.subscription.id;
        expect((await api.forgetAll('ticks')).forget_all).toEqual([tickId]);
        expect((await api.forgetAll('ticks')).forget_all).toEqual([]);
        expect((await api.forgetAll('candles')).forget_all).toEqual([candleId]);
        expect((await api.forgetAll('transaction')).forget_all)
            .toEqual([transactions.subscription.id]);
        expect((await api.forgetAll('balance')).forget_all)
            .toEqual([balance.subscription.id]);
        expect((await api.forgetAll('proposal_open_contract')).forget_all)
            .toEqual([contracts.subscription.id]);
        api.disconnect();
    });

    it('uses 50% by default and persists one independent slider for both simulated accounts', () => {
        expect(getAdminTestWinProbability()).toBe(50);
        expect(setAdminTestWinProbability(100)).toBe(false);
        enterAdminTest();
        expect(getAdminTestWinProbability()).toBe(50);
        expect(setAdminTestWinProbability(80)).toBe(true);
        expect(getAdminTestWinProbability()).toBe(80);
        expect(setAdminTestWinProbability(-1)).toBe(false);
        expect(setAdminTestWinProbability(101)).toBe(false);
        expect(setAdminTestWinProbability(50.5)).toBe(false);
        expect(setAdminTestWinProbability(NaN)).toBe(false);
        expect(getAdminTestWinProbability()).toBe(80);
        switchAdminTestAccount(TEST_REAL_ID);
        expect(getAdminTestWinProbability()).toBe(80);
        switchAdminTestAccount(TEST_DEMO_ID);
        expect(getAdminTestWinProbability()).toBe(80);
        exitAdminTest();
        expect(getAdminTestWinProbability()).toBe(50);
        enterAdminTest();
        expect(getAdminTestWinProbability()).toBe(50);
    });

    it('keeps demo and real-labelled test balances isolated and refuses unsafe values', () => {
        enterAdminTest();
        expect(setAdminTestBalance(TEST_REAL_ID, 300)).toBe(true);
        expect(setAdminTestBalance(TEST_REAL_ID, -1)).toBe(false);
        expect(setAdminTestBalance(TEST_REAL_ID, Infinity)).toBe(false);
        expect(setAdminTestBalance('CR_LIVE', 100)).toBe(false);
        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        expect(localStorage.getItem('account_type')).toBe('real');
        expect(getAdminTestBalances()).toEqual({ [TEST_DEMO_ID]: 10000, [TEST_REAL_ID]: 300 });
        expect(switchAdminTestAccount(TEST_DEMO_ID)).toBe(true);
        expect(localStorage.getItem('account_type')).toBe('demo');
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(300);
    });

    it('delivers correlated proposal and buy messages on same simulated API used by bot and bulk', async () => {
        enterAdminTest();
        const api = createAdminTestApi();
        await opened(api);
        const messages = [];
        const subscriber = api.onMessage().subscribe(msg => messages.push(msg.data));
        expect((await api.balance()).balance).toMatchObject({ loginid: TEST_DEMO_ID, balance: 10000 });
        const availability = await api.send({ contracts_for: 'R_100', req_id: 2 });
        expect(availability.contracts_for.available.map(x => x.contract_type)).toEqual(
            expect.arrayContaining(['DIGITMATCH', 'DIGITDIFF'])
        );
        const offer = await api.send({
            proposal: 1, amount: 0.5, basis: 'stake', contract_type: 'DIGITDIFF',
            underlying_symbol: 'R_100', currency: 'USD', duration: 1, duration_unit: 't', req_id: 3,
        });
        const buy = await api.send({ buy: offer.proposal.id, price: 0.5, req_id: 4 });
        expect(buy.buy.contract_id).toBeGreaterThan(0);
        expect(messages.map(x => x.req_id)).toEqual(expect.arrayContaining([2, 3, 4]));
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999.5);
        await delay(1250);
        expect(messages.find(x =>
            x.msg_type === 'proposal_open_contract' &&
            x.proposal_open_contract?.contract_id === buy.buy.contract_id &&
            x.proposal_open_contract.is_sold
        )).toBeDefined();
        expect(messages.some(x => x.msg_type === 'balance')).toBe(true);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(500);
        subscriber.unsubscribe();
        api.disconnect();
        expect(api.connection.readyState).toBe(3);
    });

    it('lets the fake real-labelled account trade without transferring to a real broker', async () => {
        enterAdminTest();
        switchAdminTestAccount(TEST_REAL_ID);
        const api = createAdminTestApi();
        await opened(api);
        expect((await api.balance()).balance.loginid).toBe(TEST_REAL_ID);
        const response = await api.send({
            proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITMATCH',
            underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
        });
        expect((await api.send({ buy: response.proposal.id, price: 1 })).buy.contract_id).toBeGreaterThan(0);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(499);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000);
        api.disconnect();
    });

    it('supplies market symbols, historical ticks and candle streams to Bot Builder', async () => {
        enterAdminTest();
        const api = createAdminTestApi();
        await opened(api);
        const markets = await api.send({ active_symbols: 'brief' });
        expect(markets.active_symbols).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ symbol: 'R_100', exchange_is_open: true }),
            ])
        );
        const history = await api.send({
            ticks_history: 'R_100', style: 'ticks', count: 30,
            end: 'latest', subscribe: 1,
        });
        expect(history.history.prices).toHaveLength(30);
        expect(history.history.times).toHaveLength(30);
        const candles = await api.send({
            ticks_history: 'R_100', style: 'candles', count: 30,
            granularity: 60, end: 'latest', subscribe: 1,
        });
        expect(candles.candles).toHaveLength(30);
        expect(candles.candles[0]).toEqual(expect.objectContaining({
            open: expect.any(Number), high: expect.any(Number),
            low: expect.any(Number), close: expect.any(Number),
        }));
        expect((await api.forget(candles.subscription.id)).forget).toBe(1);
        expect((await api.forget(history.subscription.id)).forget).toBe(1);
        api.disconnect();
    });

    it('settles every simulated contract as a win at 100%, with matching exit ticks and profits', async () => {
        enterAdminTest();
        setAdminTestWinProbability(100);
        const api = createAdminTestApi();
        await opened(api);
        const settlementMessages = [];
        const sub = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                settlementMessages.push(data.proposal_open_contract);
            }
        });
        const types = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'];
        for (const type of types) {
            const proposal = await api.send({
                proposal: 1, amount: 1, basis: 'stake', contract_type: type,
                underlying_symbol: 'R_100', currency: 'USD', duration: 1, duration_unit: 't',
                prediction: 5,
            });
            const purchased = await api.send({ buy: proposal.proposal.id, price: 1 });
            expect(purchased.buy.contract_id).toBeGreaterThan(0);
        }
        await delay(1250);
        expect(settlementMessages).toHaveLength(types.length);
        for (const contract of settlementMessages) {
            expect(contract.status).toBe('won');
            expect(contract.profit).toBeGreaterThan(0);
            expect(contract.sell_price).toBeGreaterThan(contract.buy_price);
            const digit = Number(contract.exit_tick.toFixed(2).slice(-1));
            switch (contract.contract_type) {
                case 'DIGITMATCH': expect(digit).toBe(5); break;
                case 'DIGITDIFF': expect(digit).not.toBe(5); break;
                case 'DIGITOVER': expect(digit).toBeGreaterThan(5); break;
                case 'DIGITUNDER': expect(digit).toBeLessThan(5); break;
                case 'DIGITEVEN': expect(digit % 2).toBe(0); break;
                case 'DIGITODD': expect(digit % 2).toBe(1); break;
                case 'CALL': expect(contract.exit_tick).toBeGreaterThan(contract.entry_tick); break;
                case 'PUT': expect(contract.exit_tick).toBeLessThan(contract.entry_tick); break;
            }
        }
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBeGreaterThan(10000);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(500);
        sub.unsubscribe();
        api.disconnect();
    });

    it('settles every simulated contract as a loss at 0%, including the real-labelled test account', async () => {
        enterAdminTest();
        switchAdminTestAccount(TEST_REAL_ID);
        setAdminTestWinProbability(0);
        const api = createAdminTestApi();
        await opened(api);
        const settlements = [];
        const sub = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                settlements.push(data.proposal_open_contract);
            }
        });
        for (const type of ['DIGITDIFF', 'DIGITMATCH', 'CALL', 'PUT']) {
            const proposal = await api.send({
                proposal: 1, amount: 1, basis: 'stake', contract_type: type,
                underlying_symbol: 'R_100', currency: 'USD', duration: 1, duration_unit: 't',
                prediction: 5,
            });
            await api.send({ buy: proposal.proposal.id, price: 1 });
        }
        await delay(1250);
        expect(settlements).toHaveLength(4);
        expect(settlements.every(contract => contract.status === 'lost' && contract.profit < 0)).toBe(true);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(496);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000);
        sub.unsubscribe();
        api.disconnect();
    });

    it('applies slider changes without reloading, including to already-open simulated trades', async () => {
        enterAdminTest();
        setAdminTestWinProbability(100);
        const api = createAdminTestApi();
        await opened(api);
        const settlements = [];
        const sub = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                settlements.push(data.proposal_open_contract);
            }
        });
        const proposal = await api.send({
            proposal: 1, amount: 1, basis: 'stake', contract_type: 'CALL',
            underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
        });
        await api.send({ buy: proposal.proposal.id, price: 1 });
        setAdminTestWinProbability(0);
        await delay(1250);
        expect(settlements).toHaveLength(1);
        expect(settlements[0].status).toBe('lost');
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
        sub.unsubscribe();
        api.disconnect();
    });

    it('uses the configured 50% threshold for normal random settlement outcomes', async () => {
        enterAdminTest();
        const api = createAdminTestApi();
        await opened(api);
        const settlements = [];
        const sub = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
                settlements.push(data.proposal_open_contract);
            }
        });
        const makeTrade = async () => {
            const proposal = await api.send({
                proposal: 1, amount: 1, basis: 'stake', contract_type: 'CALL',
                underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
            });
            await api.send({ buy: proposal.proposal.id, price: 1 });
        };
        const random = jest.spyOn(Math, 'random').mockReturnValue(0.49);
        try {
            await makeTrade();
            await delay(1250);
            expect(settlements[0].status).toBe('won');
            random.mockReturnValue(0.5);
            await makeTrade();
            await delay(1250);
            expect(settlements[1].status).toBe('lost');
        } finally {
            random.mockRestore();
            sub.unsubscribe();
            api.disconnect();
        }
    });

    it('rejects requests that would spend more simulated funds than available', async () => {
        enterAdminTest();
        setAdminTestBalance(TEST_DEMO_ID, 0.25);
        const api = createAdminTestApi();
        await opened(api);
        const offer = await api.send({
            proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITMATCH',
            underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
        });
        const result = await api.send({ buy: offer.proposal.id, price: 1 });
        expect(result.error.code).toBe('InsufficientBalance');
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(0.25);
        api.disconnect();
    });
    it('6E: rejects stale account sockets and prevents cross-account event delivery', async () => {
        enterAdminTest();
        const demoApi = createAdminTestApi();
        await opened(demoApi);
        const demoEvents = [];
        const subscription = demoApi.onMessage().subscribe(({ data }) => demoEvents.push(data));
        const demoBalance = (await demoApi.balance()).balance.balance;
        await delay(0);
        const countBeforeSwitch = demoEvents.length;

        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        await expect(demoApi.balance()).rejects.toThrow(/account changed/i);
        await expect(demoApi.send({
            proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITDIFF',
            underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
        })).rejects.toThrow(/account changed/i);
        const realApi = createAdminTestApi();
        await opened(realApi);
        expect((await realApi.balance()).balance).toMatchObject({
            loginid: TEST_REAL_ID, balance: 500,
        });
        await delay(0);
        expect(demoEvents).toHaveLength(countBeforeSwitch);
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(demoBalance);
        subscription.unsubscribe();
        demoApi.disconnect();
        realApi.disconnect();
    });

    it('6E: recovers an outstanding contract after reconnect and account switch', async () => {
        enterAdminTest();
        setAdminTestWinProbability(100);
        const demoApi = createAdminTestApi();
        await opened(demoApi);
        const proposal = await demoApi.send({
            proposal: 1, amount: 2, basis: 'stake', contract_type: 'DIGITDIFF',
            underlying_symbol: 'R_100', duration: 5, duration_unit: 't',
        });
        const purchase = await demoApi.send({ buy: proposal.proposal.id, price: 2 });
        const contractId = purchase.buy.contract_id;
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9998);
        demoApi.disconnect();

        switchAdminTestAccount(TEST_REAL_ID);
        const realApi = createAdminTestApi();
        await opened(realApi);
        expect((await realApi.send({ portfolio: 1 })).portfolio.contracts).toEqual([]);
        expect((await realApi.send({ statement: 1 })).statement.transactions).toEqual([]);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(500);
        realApi.disconnect();

        switchAdminTestAccount(TEST_DEMO_ID);
        const recovered = createAdminTestApi();
        await opened(recovered);
        const open = (await recovered.send({ portfolio: 1 })).portfolio.contracts;
        expect(open.some(contract => contract.contract_id === contractId)).toBe(true);
        await delay(5500);
        const statement = (await recovered.send({ statement: 1 })).statement.transactions;
        expect(statement.some(row =>
            row.contract_id === contractId && row.action_type === 'sell'
        )).toBe(true);
        expect(getAdminTestBalances()[TEST_REAL_ID]).toBe(500);
        recovered.disconnect();
    });

});

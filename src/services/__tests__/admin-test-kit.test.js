import {
    ADMIN_TEST_KEY, TEST_DEMO_ID, TEST_REAL_ID,
    isAdminTestActive, enterAdminTest, exitAdminTest,
    switchAdminTestAccount, setAdminTestBalance,
    getAdminTestBalances, getAdminTestAccounts, createAdminTestApi,
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
        await delay(1000);
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
});

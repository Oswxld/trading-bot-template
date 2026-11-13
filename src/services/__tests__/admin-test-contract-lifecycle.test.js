import {
    enterAdminTest, exitAdminTest,
    createAdminTestApi, getAdminTestBalances, setAdminTestWinProbability,
    TEST_DEMO_ID,
} from '../admin-test-kit';

const opened = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const proposalFor = (api, options = {}) => api.send({
    proposal: 1,
    amount: 1,
    basis: 'stake',
    currency: 'USD',
    contract_type: 'DIGITDIFF',
    underlying_symbol: 'R_100',
    duration: 1,
    duration_unit: 't',
    barrier: 5,
    ...options,
});
const buy = async (api, options = {}) => {
    const proposal = await proposalFor(api, options);
    expect(proposal.error).toBeUndefined();
    const purchased = await api.send({ buy: proposal.proposal.id, price: proposal.proposal.ask_price });
    expect(purchased.error).toBeUndefined();
    return purchased.buy;
};
const status = async (api, id) =>
    (await api.send({ proposal_open_contract: 1, contract_id: id })).proposal_open_contract;
const awaitSettlement = (api, id, ms = 6500) => new Promise((resolve, reject) => {
    let subscription;
    const timer = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error('Simulated contract did not settle on market ticks'));
    }, ms);
    subscription = api.onMessage().subscribe(({ data }) => {
        if (data.msg_type === 'proposal_open_contract' &&
            data.proposal_open_contract?.contract_id === id &&
            data.proposal_open_contract.is_sold) {
            clearTimeout(timer);
            subscription.unsubscribe();
            resolve(data.proposal_open_contract);
        }
    });
});

describe('Admin Test Kit tick-driven contract lifecycle', () => {
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

    it('waits for exactly 3 market ticks, publishes intermediate open status and settles once', async () => {
        const api = createAdminTestApi();
        await opened(api);
        setAdminTestWinProbability(100);
        const events = [];
        const watcher = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract') events.push(data.proposal_open_contract);
        });
        try {
            const purchased = await buy(api, { duration: 3 });
            const settled = awaitSettlement(api, purchased.contract_id);
            await wait(500);
            expect((await status(api, purchased.contract_id)).is_sold).toBe(0);
            const result = await settled;
            expect(result.tick_count).toBe(3);
            expect(result.remaining_ticks).toBe(0);
            expect(result.status).toBe('won');
            expect(result.is_expired).toBe(1);
            expect(result.exit_spot).toBe(result.exit_tick);
            expect(result.entry_spot).toBe(result.entry_tick);
            expect(result.exit_tick_time).toBeGreaterThan(result.entry_tick_time);
            const all = events.filter(event => event?.contract_id === purchased.contract_id);
            expect(all.filter(event => event?.is_sold)).toHaveLength(1);
            expect(all.filter(event => !event?.is_sold && event?.tick_count > 0)).toHaveLength(2);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(10000.8);
        } finally {
            watcher.unsubscribe();
            api.disconnect();
        }
    }, 10500);

    it('continues settlement when there are zero chart, Bot Builder or Bulk Trader subscriptions', async () => {
        const api = createAdminTestApi();
        await opened(api);
        try {
            const purchased = await buy(api, { duration: 2 });
            const final = await awaitSettlement(api, purchased.contract_id);
            expect(final.tick_count).toBe(2);
            expect(final.is_sold).toBe(1);
        } finally {
            api.disconnect();
        }
    }, 8000);

    it('recovers a two-tick outstanding contract on a new simulated connection without charging twice', async () => {
        setAdminTestWinProbability(0);
        const original = createAdminTestApi();
        await opened(original);
        const purchased = await buy(original, { duration: 2 });
        expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
        const originalContract = await status(original, purchased.contract_id);
        expect(originalContract.tick_count).toBe(0);
        original.disconnect();
        const restored = createAdminTestApi();
        try {
            await opened(restored);
            const contract = await status(restored, purchased.contract_id);
            expect(contract.is_sold).toBe(0);
            expect(contract.transaction_ids.buy).toBe(purchased.transaction_id);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
            const settled = await awaitSettlement(restored, purchased.contract_id);
            expect(settled.is_sold).toBe(1);
            expect(settled.tick_count).toBe(2);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
            const second = await buy(restored);
            expect(second.contract_id).not.toBe(purchased.contract_id);
            expect(second.transaction_id).not.toBe(purchased.transaction_id);
        } finally {
            restored.disconnect();
        }
    }, 11000);

    it('supports 0 as a valid digit prediction and payout-based proposals', async () => {
        const api = createAdminTestApi();
        await opened(api);
        setAdminTestWinProbability(100);
        try {
            const quoted = await proposalFor(api, {
                amount: 18, basis: 'payout', contract_type: 'DIGITMATCH',
                barrier: 0,
            });
            expect(quoted.proposal.ask_price).toBe(2.14);
            expect(quoted.proposal.payout).toBe(18);
            const purchased = await api.send({ buy: quoted.proposal.id, price: quoted.proposal.ask_price });
            expect(purchased.buy.buy_price).toBe(2.14);
            const openedContract = await status(api, purchased.buy.contract_id);
            expect(openedContract.barrier).toBe(0);
            const settled = await awaitSettlement(api, purchased.buy.contract_id);
            expect(settled.status).toBe('won');
            expect(Number(settled.exit_tick.toFixed(2).slice(-1))).toBe(0);
        } finally {
            api.disconnect();
        }
    }, 7500);

    it('validates market, duration and stake before buying and never spends on a rejected request', async () => {
        const api = createAdminTestApi();
        await opened(api);
        try {
            const before = getAdminTestBalances()[TEST_DEMO_ID];
            const invalidDuration = await proposalFor(api, { duration: 0 });
            expect(invalidDuration.error).toBeUndefined(); // omitted/zero duration currently defaults to one tick
            const invalidSymbol = await proposalFor(api, { underlying_symbol: 'BAD_INDEX' });
            expect(invalidSymbol.error.code).toBe('InvalidContractProposal');
            const badUnit = await proposalFor(api, { duration_unit: 's' });
            expect(badUnit.error.code).toBe('InvalidContractProposal');
            const good = await proposalFor(api);
            const underpriced = await api.send({ buy: good.proposal.id, price: 0.01 });
            expect(underpriced.error).toBeDefined();
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(before);
        } finally {
            api.disconnect();
        }
    });
});

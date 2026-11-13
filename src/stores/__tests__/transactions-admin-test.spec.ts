import TransactionsStore from '../transactions-store';
import { transaction_elements } from '@/constants/transactions';
import {
    createAdminTestApi, enterAdminTest, exitAdminTest,
    getAdminTestBalances, setAdminTestWinProbability,
    switchAdminTestAccount, TEST_DEMO_ID, TEST_REAL_ID,
} from '@/services/admin-test-kit';

const open = api => new Promise(resolve => {
    if (api.connection.readyState === 1) resolve();
    else api.connection.addEventListener('open', resolve);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const directBuy = async (api, amount = 1) => {
    const reply = await api.send({
        buy: '1', price: amount,
        parameters: { amount, basis: 'stake',
            contract_type: 'DIGITDIFF', duration: 1,
            duration_unit: 't', currency: 'USD',
            underlying_symbol: 'R_100', barrier: 5 },
    });
    return reply.buy;
};
const bulkBuy = async api => {
    const offer = await api.send({
        proposal: 1, amount: 1, basis: 'stake',
        contract_type: 'DIGITDIFF', duration: 1,
        duration_unit: 't', currency: 'USD',
        underlying_symbol: 'R_100', barrier: 5, subscribe: 1,
    });
    return (await api.send({ buy: offer.proposal.id, price: offer.proposal.ask_price })).buy;
};

const makeStore = (account = TEST_DEMO_ID) => {
    const client = { loginid: account };
    const journal = { onLogSuccess: jest.fn() };
    const root = {
        run_panel: { run_id: 1 },
        journal,
        summary_card: { contract_info: null },
    };
    const store = new TransactionsStore(root as any, { client } as any);
    return { store, journal, client };
};
const contractRows = store => store.transactions.filter(
    row => row.type === transaction_elements.CONTRACT
);

describe('Bot Builder: local report recovery from the simulated trade ledger', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        enterAdminTest();
    });
    afterEach(() => {
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('recovers a missed winning trade once, with complete rows and realized summary statistics', async () => {
        setAdminTestWinProbability(100);
        const api = createAdminTestApi();
        await open(api);
        const purchased = await directBuy(api);
        await wait(1200);
        const { store, journal } = makeStore();
        try {
            store.recoverPendingContracts();
            expect(contractRows(store)).toHaveLength(1);
            const contract = contractRows(store)[0].data;
            expect(contract).toMatchObject({
                contract_id: purchased.contract_id,
                entry_spot: expect.any(Number),
                exit_spot: expect.any(Number),
                is_completed: true,
                buy_price: 1,
                sell_price: 1.8,
                profit: 0.8,
            });
            expect(store.statistics).toMatchObject({
                number_of_runs: 1,
                won_contracts: 1,
                lost_contracts: 0,
                total_payout: 1.8,
                total_stake: 1,
                total_profit: 0.8,
            });
            expect(journal.onLogSuccess).toHaveBeenCalledTimes(2);
            store.recoverPendingContracts();
            expect(contractRows(store)).toHaveLength(1);
            expect(journal.onLogSuccess).toHaveBeenCalledTimes(2);
        } finally {
            store.disposeReactionsFn();
            api.disconnect();
        }
    }, 7000);

    it('records losing contracts with zero payout and does not mix in Bulk Trader trades', async () => {
        setAdminTestWinProbability(0);
        const api = createAdminTestApi();
        await open(api);
        const direct = await directBuy(api, 2);
        await bulkBuy(api);
        await wait(1200);
        const { store } = makeStore();
        try {
            store.recoverPendingContracts();
            expect(contractRows(store).map(row => row.data.contract_id)).toEqual([direct.contract_id]);
            expect(store.statistics).toMatchObject({
                won_contracts: 0,
                lost_contracts: 1,
                total_payout: 0,
                total_stake: 2,
                total_profit: -2,
            });
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9997);
        } finally {
            store.disposeReactionsFn();
            api.disconnect();
        }
    }, 7000);

    it('recovers an open contract and upgrades it after a view switch without duplicating journal results', async () => {
        setAdminTestWinProbability(0);
        const api = createAdminTestApi();
        await open(api);
        const bought = await directBuy(api);
        const { store, journal } = makeStore();
        try {
            store.recoverPendingContracts();
            expect(contractRows(store)).toHaveLength(1);
            expect(contractRows(store)[0].data.is_completed).toBe(false);
            expect(store.statistics.number_of_runs).toBe(0);
            await wait(1200);
            store.recoverPendingContracts();
            const contract = contractRows(store)[0].data;
            expect(contract.contract_id).toBe(bought.contract_id);
            expect(contract.is_completed).toBe(true);
            expect(contract.profit).toBe(-1);
            expect(journal.onLogSuccess).toHaveBeenCalledTimes(1);
            store.recoverPendingContracts();
            expect(journal.onLogSuccess).toHaveBeenCalledTimes(1);
        } finally {
            store.disposeReactionsFn();
            api.disconnect();
        }
    }, 7000);

    it('keeps cleared Bot Builder statistics cleared while allowing new contracts to appear', async () => {
        setAdminTestWinProbability(0);
        const api = createAdminTestApi();
        await open(api);
        const first = await directBuy(api);
        await wait(1200);
        const { store } = makeStore();
        try {
            store.recoverPendingContracts();
            expect(store.statistics.number_of_runs).toBe(1);
            store.clear();
            expect(store.statistics.number_of_runs).toBe(0);
            store.recoverPendingContracts();
            expect(contractRows(store)).toHaveLength(0);
            const next = await directBuy(api);
            await wait(1200);
            store.recoverPendingContracts();
            expect(contractRows(store)).toHaveLength(1);
            expect(contractRows(store)[0].data.contract_id).toBe(next.contract_id);
            expect(next.contract_id).toBeGreaterThan(first.contract_id);
            expect(store.statistics.number_of_runs).toBe(1);
        } finally {
            store.disposeReactionsFn();
            api.disconnect();
        }
    }, 9500);

    it('hydrates cached rows after a new store is constructed and isolates simulated account reports', async () => {
        setAdminTestWinProbability(0);
        const demo = createAdminTestApi();
        await open(demo);
        await directBuy(demo);
        await wait(1200);
        const first = makeStore(TEST_DEMO_ID);
        first.store.recoverPendingContracts();
        first.store.disposeReactionsFn();
        const next = makeStore(TEST_DEMO_ID);
        try {
            expect(contractRows(next.store)).toHaveLength(1);
            expect(next.store.statistics.number_of_runs).toBe(1);
            switchAdminTestAccount(TEST_REAL_ID);
            const another = makeStore(TEST_REAL_ID);
            try {
                expect(contractRows(another.store)).toHaveLength(0);
                another.store.recoverPendingContracts();
                expect(contractRows(another.store)).toHaveLength(0);
            } finally {
                another.store.disposeReactionsFn();
            }
        } finally {
            next.store.disposeReactionsFn();
            demo.disconnect();
        }
    }, 7000);
});

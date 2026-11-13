import AppStore from '../app-store';
import { api_base, DBot } from '@/external/bot-skeleton';
import { createAdminTestApi, enterAdminTest, exitAdminTest } from '@/services/admin-test-kit';

jest.mock('@/external/bot-skeleton', () => ({
    api_base: { setIsRunning: jest.fn() },
    DBot: { terminateBot: jest.fn().mockResolvedValue(undefined), terminateConnection: jest.fn() },
    ApiHelpers: {},
    runIrreversibleEvents: jest.fn(),
}));
jest.mock('@/external/bot-skeleton/scratch/utils', () => ({ setCurrency: jest.fn() }));

const makeStore = () => {
    const run_panel = { setIsRunning: jest.fn() };
    const ui = { setAccountSwitcherDisabledMessage: jest.fn(), setPromptHandler: jest.fn() };
    const store = new AppStore({ run_panel } as any, { ui } as any);
    return { store, run_panel };
};

describe('Admin Test Kit navigation owns only the Blockly interpreter', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        jest.clearAllMocks();
        Object.defineProperty(performance, 'clearMeasures', { configurable: true, value: jest.fn() });
    });
    afterEach(() => {
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('keeps the simulated account transport alive when leaving Bot Builder', () => {
        enterAdminTest();
        const { store, run_panel } = makeStore();
        store.onUnmount();
        expect(DbotTeardown()).toBe(false);
        expect(DBot.terminateBot).toHaveBeenCalledWith(false);
        expect(run_panel.setIsRunning).toHaveBeenCalledWith(false);
        expect(api_base.setIsRunning).toHaveBeenCalledWith(false);
    });

    it('does not erase an open simulated contract when Bot Builder unmounts', async () => {
        enterAdminTest();
        const sim = createAdminTestApi();
        try {
            await new Promise<void>(resolve => {
                if (sim.connection.readyState === 1) return resolve();
                sim.connection.addEventListener('open', () => resolve());
            });
            const proposal = await sim.send({
                proposal: 1, amount: 1, basis: 'stake', contract_type: 'DIGITDIFF',
                underlying_symbol: 'R_100', duration: 1, duration_unit: 't',
                barrier: 5,
            });
            const purchase = await sim.send({ buy: proposal.proposal.id, price: 1 });
            const { store } = makeStore();
            store.onUnmount();
            expect(sim.connection.readyState).toBe(1);
            await new Promise(resolve => setTimeout(resolve, 950));
            const status = await sim.send({
                proposal_open_contract: 1, contract_id: purchase.buy.contract_id,
            });
            expect(status.proposal_open_contract.is_sold).toBe(1);
        } finally {
            sim.disconnect();
        }
    }, 6000);

    it('preserves ordinary live account teardown', () => {
        const { store } = makeStore();
        store.onUnmount();
        expect(DBot.terminateBot).toHaveBeenCalledWith();
        expect(DbotTeardown()).toBe(true);
        expect(api_base.setIsRunning).not.toHaveBeenCalled();
    });
});

const DbotTeardown = () => (DBot.terminateConnection as jest.Mock).mock.calls.length > 0;

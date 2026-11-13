import AppStore from '../app-store';
import { api_base, DBot } from '@/external/bot-skeleton';
import { enterAdminTest, exitAdminTest } from '@/services/admin-test-kit';

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

    it('preserves ordinary live account teardown', () => {
        const { store } = makeStore();
        store.onUnmount();
        expect(DBot.terminateBot).toHaveBeenCalledWith();
        expect(DbotTeardown()).toBe(true);
        expect(api_base.setIsRunning).not.toHaveBeenCalled();
    });
});

const DbotTeardown = () => (DBot.terminateConnection as jest.Mock).mock.calls.length > 0;

import RunPanelStore from '../run-panel-store';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    createAdminTestApi,
    enterAdminTest,
    exitAdminTest,
    switchAdminTestAccount,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';

jest.mock('@/external/bot-skeleton', () => ({
    observer: { register: jest.fn(), unregister: jest.fn(), unregisterAll: jest.fn() },
    ErrorTypes: {}, MessageTypes: {}, unrecoverable_errors: [],
}));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: null, account_id: '', account_info: {},
        is_authorized: false, is_running: false,
        authorizeAndSubscribe: jest.fn(),
    },
}));
jest.mock('@/external/bot-skeleton/scratch/utils', () => ({ getSelectedTradeType: jest.fn() }));
jest.mock('@/utils/store-helpers', () => ({ helpers: {} }));

const opened = (api: any) => new Promise<void>(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const makePanel = () => {
    const client: any = { is_logged_in: false, loginid: '' };
    const dbot = {
        saveRecentWorkspace: jest.fn(),
        unHighlightAllBlocks: jest.fn(),
        getStrategySounds: jest.fn(() => []),
        shouldRunBot: jest.fn(() => true),
        runBot: jest.fn(),
    };
    const ui = {
        setAccountSwitcherDisabledMessage: jest.fn(),
        setPromptHandler: jest.fn(),
    };
    const journal = { onError: jest.fn(), journal_filters: [] };
    const root: any = {
        dbot,
        summary_card: { clear: jest.fn(), onBotContractEvent: jest.fn() },
        transactions: { onBotContractEvent: jest.fn() },
        journal,
    };
    const store = new RunPanelStore(root, {
        client, ui, common: { is_socket_opened: false },
    } as any);
    return { store, client, dbot, ui, journal };
};

describe('Run Bot button: simulated accounts never trigger OAuth login', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        window.history.replaceState({}, '', '/');
        api_base.api = null;
        api_base.is_authorized = false;
        api_base.account_id = '';
        api_base.account_info = {};
        jest.clearAllMocks();
    });
    afterEach(() => {
        api_base.api?.disconnect?.();
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    for (const [label, id] of [['Demo', TEST_DEMO_ID], ['Real', TEST_REAL_ID]] as const) {
        it(`starts a bot on simulated ${label} without a Deriv OAuth login popup`, async () => {
            enterAdminTest();
            if (id === TEST_REAL_ID) switchAdminTestAccount(id);
            const sim = createAdminTestApi();
            await opened(sim);
            api_base.api = sim;
            api_base.account_id = id;
            api_base.account_info = { loginid: id, currency: 'USD', balance: 100 };
            api_base.is_authorized = true;

            const { store, client, dbot, journal } = makePanel();
            (api_base.authorizeAndSubscribe as jest.Mock).mockImplementation(async () => {
                client.loginid = id;
                client.is_logged_in = true;
            });
            await store.onRunButtonClick();

            expect(api_base.authorizeAndSubscribe).toHaveBeenCalledTimes(1);
            expect(dbot.runBot).toHaveBeenCalledTimes(1);
            expect(store.is_dialog_open).toBe(false);
            expect(journal.onError).not.toHaveBeenCalled();
            store.disposeReactionsFn();
        });
    }

    it('refuses simulated trading through a non-simulated socket, even if it appears authorized', async () => {
        enterAdminTest();
        api_base.api = { connection: { readyState: 1 } } as any;
        api_base.is_authorized = true;
        api_base.account_id = TEST_DEMO_ID;
        api_base.account_info = { loginid: TEST_DEMO_ID };
        const { store, dbot, journal } = makePanel();
        await store.onRunButtonClick();
        expect(dbot.runBot).not.toHaveBeenCalled();
        expect(store.is_dialog_open).toBe(false);
        expect(journal.onError).toHaveBeenCalledWith(expect.stringMatching(/Simulated account/));
        store.disposeReactionsFn();
    });

    it('preserves the original login dialog for unauthenticated live visitors', async () => {
        const { store, dbot } = makePanel();
        await store.onRunButtonClick();
        expect(store.is_dialog_open).toBe(true);
        expect(store.dialog_options).toEqual(expect.objectContaining({
            title: expect.stringMatching(/not logged in/i),
        }));
        expect(dbot.runBot).not.toHaveBeenCalled();
        store.disposeReactionsFn();
    });
});

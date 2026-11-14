import { api_base } from '../api-base';
import { authData$, setAuthData } from '../observables/connection-status-stream';
import {
    enterAdminTest, exitAdminTest, switchAdminTestAccount, TEST_REAL_ID,
    createAdminTestApi, isAdminTestSessionReady,
} from '@/services/admin-test-kit';

jest.mock('../chart-api', () => ({
    __esModule: true, default: { init: jest.fn() },
}));
jest.mock('../api-helpers', () => ({
    __esModule: true, default: { disposeInstance: jest.fn() },
}));

describe('Bot Builder: simulated Real reconnect never logs out local account', () => {
    let restore: jest.SpyInstance;
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        enterAdminTest();
        switchAdminTestAccount(TEST_REAL_ID);
        api_base.api = { connection: { readyState: 3 } } as any;
        restore = jest.spyOn(api_base, 'init').mockResolvedValue(undefined);
        setAuthData({ loginid: TEST_REAL_ID, currency: 'USD', balance: 500 } as any);
    });
    afterEach(() => {
        restore.mockRestore();
        api_base.api = null;
        api_base.is_authorized = false;
        setAuthData(null);
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('waits for the replacement local socket to open and reauthorizes the selected Real account', async () => {
        restore.mockImplementation(async () => {
            const replacement = createAdminTestApi();
            api_base.api = replacement as any;
            api_base.account_id = TEST_REAL_ID;
            api_base.account_info = { loginid: TEST_REAL_ID };
            api_base.is_authorized = false;
        });
        const authorization = jest.spyOn(api_base, 'authorizeAndSubscribe').mockImplementation(async () => {
            api_base.account_id = TEST_REAL_ID;
            api_base.account_info = { loginid: TEST_REAL_ID };
            api_base.is_authorized = true;
        });
        try {
            expect(await api_base.ensureAdminTestSession()).toBe(true);
            expect(api_base.init).toHaveBeenCalledTimes(1);
            expect(authorization).toHaveBeenCalledTimes(1);
            expect(isAdminTestSessionReady(api_base)).toBe(true);
            expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
        } finally {
            api_base.api?.disconnect();
            authorization.mockRestore();
        }
    });

    it('coalesces concurrent simulated authorization requests into one handshake', async () => {
        const sim = createAdminTestApi();
        await new Promise<void>(resolve => {
            if (sim.connection.readyState === 1) return resolve();
            sim.connection.addEventListener('open', () => resolve());
        });
        api_base.api = sim as any;
        let release = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const handshake = jest.spyOn(api_base as any, 'authorizeAndSubscribeInner')
            .mockImplementation(() => gate);
        try {
            const first = api_base.authorizeAndSubscribe();
            const second = api_base.authorizeAndSubscribe();
            expect(handshake).toHaveBeenCalledTimes(1);
            release();
            await Promise.all([first, second]);
        } finally {
            release();
            handshake.mockRestore();
            sim.disconnect();
        }
    });

    it('keeps the header account and reconnects only once across repeated close/focus events', async () => {
        for (let i = 0; i < 8; i++) api_base.reconnectIfNotConnected();
        expect(api_base.init).toHaveBeenCalledTimes(1);
        expect(api_base.init).toHaveBeenCalledWith(true);
        expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
        expect(authData$.value?.loginid).toBe(TEST_REAL_ID);
        await Promise.resolve();
        await Promise.resolve();
    });
});

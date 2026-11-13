import { api_base } from '../api-base';
import { authData$, setAuthData } from '../observables/connection-status-stream';
import {
    enterAdminTest, exitAdminTest, switchAdminTestAccount, TEST_REAL_ID,
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

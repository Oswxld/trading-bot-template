import TicksService from '../ticks_service';
import { api_base } from '../api-base';
import {
    enterAdminTest, exitAdminTest, switchAdminTestAccount,
    TEST_REAL_ID, createAdminTestApi,
} from '@/services/admin-test-kit';

jest.mock('../api-base', () => ({
    api_base: {
        api: null, pip_sizes: { R_100: 2 },
        pushSubscription: jest.fn(),
        toggleRunButton: jest.fn(),
    },
}));
const opened = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});

describe('Bot Builder tick lifecycle on simulated Real', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        enterAdminTest();
        switchAdminTestAccount(TEST_REAL_ID);
    });
    afterEach(() => {
        api_base.api?.disconnect();
        api_base.api = null;
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });
    it('rebinds its tick listener to a replacement simulated socket', async () => {
        const oldApi = createAdminTestApi();
        api_base.api = oldApi;
        await opened(oldApi);
        const ticks = new TicksService();
        const observed = jest.fn();
        await ticks.monitor({ symbol: 'R_100', callback: observed });

        const next = createAdminTestApi();
        api_base.api = next;
        await opened(next);
        // The next monitor request must attach to the new socket and fetch
        // a new stream even if the old instance already cached 1000 ticks.
        const nextCallback = jest.fn();
        await ticks.monitor({ symbol: 'R_100', callback: nextCallback });
        await new Promise(resolve => setTimeout(resolve, 1800));
        expect(nextCallback).toHaveBeenCalled();
        oldApi.disconnect();
        next.disconnect();
    });

    it('loads 1000 ticks and unsubscribes cleanly without OAuth', async () => {
        const api = createAdminTestApi();
        api_base.api = api;
        await opened(api);
        const ticks = new TicksService();
        const observed = jest.fn();
        const key = await ticks.monitor({ symbol: 'R_100', callback: observed });
        expect(typeof key).toBe('string');
        expect(ticks.ticks.get('R_100')).toHaveLength(1000);
        expect(ticks.ticks.get('R_100')[0].quote).toEqual(expect.any(Number));

        await expect(ticks.unsubscribeFromTicksService()).resolves.toBeUndefined();
        expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
    });
});

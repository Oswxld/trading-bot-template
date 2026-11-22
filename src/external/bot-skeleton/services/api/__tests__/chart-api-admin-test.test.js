
/** Legacy simulated-engine fixtures run under a verified mock Supabase session.
 * Production never grants Admin Test Kit access without real Supabase Auth.
 */
jest.mock('@/services/admin-supabase-auth', () => ({
    getAdminAuthUser: jest.fn(() => ({ id: '123e4567-e89b-42d3-a456-426614174000' })),
}));
jest.mock('@/services/admin-sim-balance-sync', () => ({
    isAdminBalanceSyncReady: jest.fn(() => true),
    queueAdminBalanceDelta: jest.fn(),
    setAdminRemoteBalance: jest.fn(async () => undefined),
}));

import chart_api from '../chart-api';
import { generateDerivApiInstance } from '../appId';
import { enterAdminTest, exitAdminTest } from '@/services/admin-test-kit';

jest.mock('../appId', () => ({ generateDerivApiInstance: jest.fn() }));

const makeSocket = () => ({
    connection: {
        readyState: 1,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    },
    disconnect: jest.fn(),
    send: jest.fn().mockResolvedValue({ time: 1234 }),
});

describe('ChartAPI never owns the Admin Test Kit trading socket', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        jest.clearAllMocks();
    });
    afterEach(() => {
        if (chart_api.time_interval) clearInterval(chart_api.time_interval);
        chart_api.time_interval = null;
        chart_api.api = null;
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('does not disconnect an old simulator when refreshing the chart API', async () => {
        enterAdminTest();
        const original = makeSocket();
        const replacement = makeSocket();
        generateDerivApiInstance
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(replacement);
        await chart_api.init();
        await chart_api.init(true);
        expect(original.disconnect).not.toHaveBeenCalled();
        expect(replacement.disconnect).not.toHaveBeenCalled();
        expect(chart_api.api).toBe(replacement);
        expect(original.connection.addEventListener).not.toHaveBeenCalled();
    });

    it('preserves the existing live-connection cleanup behavior', async () => {
        const original = makeSocket();
        const replacement = makeSocket();
        generateDerivApiInstance
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(replacement);
        await chart_api.init();
        await chart_api.init(true);
        expect(original.disconnect).toHaveBeenCalledTimes(1);
        expect(chart_api.api).toBe(replacement);
    });
});

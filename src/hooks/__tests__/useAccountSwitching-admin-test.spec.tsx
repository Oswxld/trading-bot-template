import { renderHook } from '@testing-library/react';
import { enterAdminTest, exitAdminTest, switchAdminTestAccount, TEST_DEMO_ID, TEST_REAL_ID } from '@/services/admin-test-kit';
import { getAccountId } from '@/utils/account-helpers';
import { useAccountSwitching } from '../useAccountSwitching';

jest.mock('@/components/shared', () => ({
    fiat_currencies_display_order: ['USD', 'EUR'],
    crypto_currencies_display_order: ['BTC'],
}));

describe('account switching isolation for the Admin Test Kit', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        window.history.replaceState({}, '', '/');
        // Simulate tokens from a previous real OAuth session still being present.
        localStorage.setItem('accountsList', JSON.stringify({ VRTC_OLD: 'demo-previous-token' }));
        localStorage.setItem('clientAccounts', JSON.stringify({
            CR_OLD: { currency: 'USD', token: 'real-previous-token' },
        }));
    });
    afterEach(() => {
        // Do not leave simulated local flags or URL parameters for other tests.
        exitAdminTest();
        sessionStorage.clear();
        localStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    it('keeps the simulated REAL account selected even with a stale ?account=USD URL', () => {
        window.history.replaceState({}, '', '/?account=USD');
        expect(enterAdminTest()).toBe(true);
        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        renderHook(() => useAccountSwitching());

        expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
        expect(localStorage.getItem('authToken')).toBeNull();
        expect(getAccountId()).toBe(TEST_REAL_ID);
    });

    it('keeps the simulated DEMO account selected even with a stale ?account=DEMO URL', () => {
        window.history.replaceState({}, '', '/?account=DEMO');
        expect(enterAdminTest()).toBe(true);
        renderHook(() => useAccountSwitching());

        expect(localStorage.getItem('active_loginid')).toBe(TEST_DEMO_ID);
        expect(localStorage.getItem('authToken')).toBeNull();
        expect(getAccountId()).toBe(TEST_DEMO_ID);
    });

    it('ignores stale OAuth account_id URL parameters during simulated REAL mode', () => {
        window.history.replaceState({}, '', '/?account_id=CR_OLD&account=USD');
        expect(enterAdminTest()).toBe(true);
        expect(switchAdminTestAccount(TEST_REAL_ID)).toBe(true);
        renderHook(() => useAccountSwitching());

        expect(getAccountId()).toBe(TEST_REAL_ID);
        expect(localStorage.getItem('active_loginid')).toBe(TEST_REAL_ID);
    });

    it('preserves ordinary Deriv account switching when Admin Test Kit is off', () => {
        window.history.replaceState({}, '', '/?account=USD');
        renderHook(() => useAccountSwitching());
        expect(localStorage.getItem('active_loginid')).toBe('CR_OLD');
        expect(localStorage.getItem('authToken')).toBe('real-previous-token');
        expect(getAccountId()).toBe('CR_OLD');
    });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminTestKit from '../admin-test-kit';
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { is_running: false },
}));
jest.mock('@/services/admin-supabase-auth', () => ({
    signOutAdmin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/services/admin-sim-balance-sync', () => ({
    ADMIN_BALANCE_SYNC_EVENT: 'yolo:admin-balance-sync',
    flushAdminBalanceSync: jest.fn().mockResolvedValue(undefined),
    hasPendingAdminBalances: jest.fn(() => false),
    refreshAdminRemoteBalances: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/services/admin-test-kit', () => ({
    ADMIN_TEST_MANAGE_EVENT: 'yolo:admin-test-manage',
    ADMIN_TEST_OPEN_EVENT: 'yolo:admin-test-open',
    exitAdminTest: jest.fn(),
    getAdminTestBalances: () => ({ VRTC_ADMIN_TEST: 10000, CR_ADMIN_TEST: 500 }),
    getAdminTestContracts: () => [],
    getAdminTestWinProbability: jest.fn(() => 50),
    getAdminTestExecutionMode: jest.fn(() => 'presentation'),
    setAdminTestExecutionMode: jest.fn(() => true),
    isAdminTestActive: jest.fn(() => false),
    setAdminTestBalance: jest.fn().mockResolvedValue(true),
    setAdminTestWinProbability: jest.fn(() => true),
    switchAdminTestAccount: jest.fn(),
    TEST_DEMO_ID: 'VRTC_ADMIN_TEST',
    TEST_REAL_ID: 'CR_ADMIN_TEST',
}));
describe('Supabase-only Admin Test Kit shortcuts', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(false);
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });
    it('hides both admin controls and the secret dot from ordinary, non-admin visitors', () => {
        render(<AdminTestKit />);
        expect(screen.queryByRole('button', { name: /press and hold for 3 seconds/i })).not.toBeInTheDocument();
        act(() => window.dispatchEvent(new Event('yolo:admin-test-open')));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('opens the controls only after a validated admin session is active', () => {
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        expect(screen.getByRole('dialog', { name: 'Supabase Admin Test Kit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save options balances to supabase/i })).toBeInTheDocument();
        expect(screen.queryByLabelText('Admin password')).not.toBeInTheDocument();
    });
    it('retains the three-second dot hold for verified admin sessions', () => {
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        const dot = screen.getByRole('button', { name: /press and hold for 3 seconds/i });
        fireEvent.pointerDown(dot, { pointerType: 'mouse', button: 0 });
        act(() => jest.advanceTimersByTime(2999));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => jest.advanceTimersByTime(1));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    it('shows and updates the shared simulated win/loss probability setting', () => {
        const { isAdminTestActive, setAdminTestWinProbability } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        const slider = screen.getByRole('slider', { name: /win probability/i });
        fireEvent.change(slider, { target: { value: '85' } });
        expect(setAdminTestWinProbability).toHaveBeenCalledWith(85);
        expect(screen.getByText(/loss probability/i)).toHaveTextContent('15%');
    });
    it('reports persistence problems without exposing an unauthenticated login form', () => {
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        act(() => window.dispatchEvent(new CustomEvent('yolo:admin-balance-sync', {
            detail: { pending: true, error: 'Supabase unavailable' },
        })));
        expect(screen.getByRole('alert')).toHaveTextContent(/Supabase unavailable/);
        expect(screen.getByRole('status')).toHaveTextContent(/saving simulated balance/i);
    });
});

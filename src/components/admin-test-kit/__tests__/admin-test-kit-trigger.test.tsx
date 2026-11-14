import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminTestKit from '../admin-test-kit';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { is_running: false },
}));
jest.mock('@/services/admin-test-kit', () => ({
    enterAdminTest: jest.fn(),
    ADMIN_TEST_MANAGE_EVENT: 'yolo:admin-test-manage',
    exitAdminTest: jest.fn(),
    getAdminTestBalances: () => ({ VRTC_ADMIN_TEST: 10000, CR_ADMIN_TEST: 500 }),
    getAdminTestWinProbability: jest.fn(() => 50),
    getAdminTestExecutionMode: jest.fn(() => 'presentation'),
    setAdminTestExecutionMode: jest.fn(() => true),
    isAdminTestActive: jest.fn(() => false),
    isAdminTestAvailable: () => true,
    setAdminTestBalance: jest.fn(),
    setAdminTestWinProbability: jest.fn(() => true),
    switchAdminTestAccount: jest.fn(),
    TEST_DEMO_ID: 'VRTC_ADMIN_TEST',
    TEST_REAL_ID: 'CR_ADMIN_TEST',
}));

describe('Admin Test Kit footer secret trigger', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(false);
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('opens the Manage panel when the subtle D shortcut is clicked in test mode', () => {
        const { isAdminTestActive } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        expect(screen.queryByText(/TEST MODE — SIMULATED FUNDS/)).not.toBeInTheDocument();
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        expect(screen.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /exit test kit/i })).toBeInTheDocument();
    });

    it('shows a single live slider and the complementary win/loss probabilities', () => {
        const { isAdminTestActive, setAdminTestWinProbability } = require('@/services/admin-test-kit');
        isAdminTestActive.mockReturnValue(true);
        render(<AdminTestKit />);
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        const slider = screen.getByRole('slider', { name: /win probability/i });
        expect(slider).toHaveValue('50');
        expect(screen.getByText(/loss probability/i)).toHaveTextContent('50%');
        fireEvent.change(slider, { target: { value: '85' } });
        expect(setAdminTestWinProbability).toHaveBeenLastCalledWith(85);
        expect(slider).toHaveValue('85');
        expect(screen.getByText(/loss probability/i)).toHaveTextContent('15%');
        fireEvent.change(slider, { target: { value: '100' } });
        expect(screen.getByText(/loss probability/i)).toHaveTextContent('0%');
    });

    it('ignores the Manage shortcut when the test kit is inactive', () => {
        render(<AdminTestKit />);
        act(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens after holding the dot for a full 3 seconds', () => {
        render(<AdminTestKit />);
        const dot = screen.getByRole('button', { name: /press and hold for 3 seconds/i });
        fireEvent.pointerDown(dot, { pointerType: 'mouse', button: 0 });
        act(() => jest.advanceTimersByTime(2999));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => jest.advanceTimersByTime(1));
        expect(screen.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeInTheDocument();
    });

    it('does not open on a short click or a released hold', () => {
        render(<AdminTestKit />);
        const dot = screen.getByRole('button', { name: /press and hold for 3 seconds/i });
        fireEvent.click(dot);
        act(() => jest.advanceTimersByTime(4000));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.pointerDown(dot, { pointerType: 'touch', button: 0 });
        act(() => jest.advanceTimersByTime(2000));
        fireEvent.pointerUp(dot);
        act(() => jest.advanceTimersByTime(2000));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('cancels when the pointer leaves or gesture is cancelled', () => {
        render(<AdminTestKit />);
        const dot = screen.getByRole('button', { name: /press and hold for 3 seconds/i });
        fireEvent.pointerDown(dot, { pointerType: 'touch' });
        fireEvent.pointerLeave(dot);
        act(() => jest.advanceTimersByTime(3000));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.pointerDown(dot, { pointerType: 'touch' });
        fireEvent.pointerCancel(dot);
        act(() => jest.advanceTimersByTime(3000));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('supports a three-second keyboard hold', () => {
        render(<AdminTestKit />);
        const dot = screen.getByRole('button', { name: /press and hold for 3 seconds/i });
        fireEvent.keyDown(dot, { key: 'Enter' });
        act(() => jest.advanceTimersByTime(3000));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.keyUp(dot, { key: 'Enter' });
    });
});

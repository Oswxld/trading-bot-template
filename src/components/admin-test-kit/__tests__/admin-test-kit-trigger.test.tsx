import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminTestKit from '../admin-test-kit';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { is_running: false },
}));
jest.mock('@/services/admin-test-kit', () => ({
    enterAdminTest: jest.fn(),
    exitAdminTest: jest.fn(),
    getAdminTestBalances: () => ({ VRTC_ADMIN_TEST: 10000, CR_ADMIN_TEST: 500 }),
    isAdminTestActive: () => false,
    isAdminTestAvailable: () => true,
    setAdminTestBalance: jest.fn(),
    switchAdminTestAccount: jest.fn(),
    TEST_DEMO_ID: 'VRTC_ADMIN_TEST',
    TEST_REAL_ID: 'CR_ADMIN_TEST',
}));

describe('Admin Test Kit footer secret trigger', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
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

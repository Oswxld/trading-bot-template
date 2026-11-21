import { act, fireEvent, render, screen } from '@testing-library/react';
import Tab from '../tab';

jest.mock('@/services/admin-test-kit', () => ({
    ADMIN_TEST_OPEN_EVENT: 'yolo:admin-test-open',
}));
jest.mock('@/utils/tmp/dummy', () => ({ Icon: () => null }));
jest.mock('../../counter', () => () => null);

const dashboardProps = {
    count: 0,
    header_content: undefined as unknown as React.ReactElement,
    icon: '',
    id: 'id-dbot-dashboard',
    is_active: false,
    label: 'Dashboard',
    onClick: jest.fn(),
    setActiveLineStyle: jest.fn(),
    top: true,
};

describe('Dashboard shortcut to existing Admin Test Kit', () => {
    const onAdminOpen = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        dashboardProps.onClick.mockClear();
        onAdminOpen.mockClear();
        window.addEventListener('yolo:admin-test-open', onAdminOpen);
    });

    afterEach(() => {
        window.removeEventListener('yolo:admin-test-open', onAdminOpen);
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('keeps regular dashboard clicks working without opening admin mode', () => {
        render(<Tab {...dashboardProps} />);
        fireEvent.click(screen.getByText('Dashboard'));
        expect(dashboardProps.onClick).toHaveBeenCalledTimes(1);
        expect(onAdminOpen).not.toHaveBeenCalled();
    });

    it('opens the admin kit after holding Dashboard for three seconds without navigating', () => {
        render(<Tab {...dashboardProps} />);
        const dashboard = screen.getByText('Dashboard');
        fireEvent.pointerDown(dashboard, { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
        act(() => jest.advanceTimersByTime(2999));
        expect(onAdminOpen).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(1));
        expect(onAdminOpen).toHaveBeenCalledTimes(1);
        fireEvent.pointerUp(dashboard);
        fireEvent.click(dashboard);
        expect(dashboardProps.onClick).not.toHaveBeenCalled();
        fireEvent.click(dashboard);
        expect(dashboardProps.onClick).toHaveBeenCalledTimes(1);
    });

    it('does not open the panel after releasing or moving during a hold', () => {
        render(<Tab {...dashboardProps} />);
        const dashboard = screen.getByText('Dashboard');
        fireEvent.pointerDown(dashboard, { pointerType: 'touch', clientX: 10, clientY: 10 });
        act(() => jest.advanceTimersByTime(2500));
        fireEvent.pointerUp(dashboard);
        act(() => jest.advanceTimersByTime(1000));
        expect(onAdminOpen).not.toHaveBeenCalled();

        fireEvent.pointerDown(dashboard, { pointerType: 'touch', clientX: 10, clientY: 10 });
        fireEvent.pointerMove(dashboard, { pointerType: 'touch', clientX: 50, clientY: 50 });
        act(() => jest.advanceTimersByTime(3100));
        expect(onAdminOpen).not.toHaveBeenCalled();
    });

    it('does not add the shortcut to any other tab', () => {
        render(<Tab {...dashboardProps} id='id-dbot-bot-builder' label='Bot Builder' />);
        const otherTab = screen.getByText('Bot Builder');
        fireEvent.pointerDown(otherTab, { pointerType: 'mouse', button: 0 });
        act(() => jest.advanceTimersByTime(4000));
        expect(onAdminOpen).not.toHaveBeenCalled();
    });
});

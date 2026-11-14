import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AppHeader from '../header';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isAdminTestActive } from '@/services/admin-test-kit';
import { navigateToTransfer } from '@/utils/transfer-utils';

jest.mock('@/hooks/api/account/useActiveAccount', () => ({
    __esModule: true, default: jest.fn(),
}));
jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/hooks/useLogout', () => ({
    useLogout: jest.fn(() => jest.fn()),
}));
jest.mock('@/services/admin-test-kit', () => ({
    isAdminTestActive: jest.fn(() => false),
}));
jest.mock('@/utils/transfer-utils', () => ({ navigateToTransfer: jest.fn() }));
jest.mock('@/components/shared', () => ({ generateOAuthURL: jest.fn() }));
jest.mock('@/components/shared_ui/button', () => ({
    __esModule: true,
    default: ({ children, disabled, onClick, type, title }: any) => (
        <button type={type || 'button'} disabled={disabled} title={title} onClick={onClick}>{children}</button>
    ),
}));
jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
}));
jest.mock('@deriv-com/ui', () => ({
    Header: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
    Wrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useDevice: () => ({ isDesktop: true }),
}));
jest.mock('../../app-logo', () => ({ AppLogo: () => null }));
jest.mock('../account-switcher', () => ({ __esModule: true, default: () => null }));
jest.mock('../menu-items', () => ({ __esModule: true, default: () => null }));
jest.mock('../mobile-menu', () => ({ __esModule: true, default: () => null }));

const mockAccount = useActiveAccount as jest.Mock;
const mockAuth = useApiBase as jest.Mock;
const mockStore = useStore as jest.Mock;
const mockIsSimulated = isAdminTestActive as jest.Mock;
const mockNavigate = navigateToTransfer as jest.Mock;
const realAccount = {
    loginid: 'CR123', currency: 'USD', balance: '100.00',
    isVirtual: false, isActive: true,
};

describe('Header Transfer: only current real Deriv accounts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsSimulated.mockReturnValue(false);
        mockAuth.mockReturnValue({
            activeLoginid: 'CR123', isAuthorizing: false, setIsAuthorizing: jest.fn(),
            authData: { loginid: 'CR123', currency: 'USD' },
        });
        mockStore.mockReturnValue({
            client: { is_logged_in: true, is_account_regenerating: false,
                is_logging_out: false, should_hide_header: false },
        });
        mockAccount.mockReturnValue({ data: { ...realAccount } });
    });

    it('opens Deriv transfer for the actual active account currency', () => {
        render(<AppHeader />);
        const transfer = screen.getByRole('button', { name: 'Transfer' });
        expect(transfer).toBeEnabled();
        fireEvent.click(transfer);
        expect(mockNavigate).toHaveBeenCalledWith('USD');
    });

    it('uses the switched real account currency rather than stale OAuth currency', () => {
        mockAuth.mockReturnValue({
            activeLoginid: 'CR999', isAuthorizing: false, setIsAuthorizing: jest.fn(),
            authData: { loginid: 'CR999', currency: 'USD' },
        });
        mockAccount.mockReturnValue({
            data: { ...realAccount, loginid: 'CR999', currency: 'EUR' },
        });
        render(<AppHeader />);
        fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
        expect(mockNavigate).toHaveBeenCalledWith('EUR');
    });

    it('does not transfer from a Demo account', () => {
        mockAccount.mockReturnValue({
            data: { ...realAccount, isVirtual: true, loginid: 'VRTC123' },
        });
        mockAuth.mockReturnValue({
            activeLoginid: 'VRTC123', isAuthorizing: false, setIsAuthorizing: jest.fn(),
            authData: { loginid: 'VRTC123', currency: 'USD' },
        });
        render(<AppHeader />);
        expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('disables transfer for both fake local simulated accounts', () => {
        mockIsSimulated.mockReturnValue(true);
        mockAccount.mockReturnValue({
            data: { ...realAccount, loginid: 'CR_ADMIN_TEST' },
        });
        mockAuth.mockReturnValue({
            activeLoginid: 'CR_ADMIN_TEST', isAuthorizing: false,
            setIsAuthorizing: jest.fn(), authData: { loginid: 'CR_ADMIN_TEST', currency: 'USD' },
        });
        render(<AppHeader />);
        expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('disables transfer while the displayed account does not match authorized login', () => {
        mockAccount.mockReturnValue({
            data: { ...realAccount, loginid: 'CR777', currency: 'BTC' },
        });
        render(<AppHeader />);
        expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('disables transfer when no real account currency is available', () => {
        mockAccount.mockReturnValue({
            data: { ...realAccount, currency: '' },
        });
        render(<AppHeader />);
        expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});

import { buildDerivTransferUrl, navigateToTransfer } from '../transfer-utils';
import { standalone_routes } from '@/components/shared/utils/routes/routes';
import { isAdminTestActive } from '@/services/admin-test-kit';
import { navigateToUrl } from '../navigation-utils';
import { getInitialLanguage } from '@deriv-com/translations';

jest.mock('@/components/shared/utils/routes/routes', () => ({
    standalone_routes: {
        transfer: 'https://home.deriv.com/dashboard/transfer?acc=options&from=home&source=options',
    },
}));
jest.mock('@/services/admin-test-kit', () => ({
    isAdminTestActive: jest.fn(() => false),
}));
jest.mock('../navigation-utils', () => ({
    navigateToUrl: jest.fn(),
}));
jest.mock('@deriv-com/translations', () => ({
    getInitialLanguage: jest.fn(() => 'EN'),
}));

const mockIsSimulated = isAdminTestActive as jest.Mock;
const mockNavigate = navigateToUrl as jest.Mock;
const mockGetLanguage = getInitialLanguage as jest.Mock;
const originalTransferRoute = standalone_routes.transfer;

describe('Deriv transfer button destination and safety', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsSimulated.mockReturnValue(false);
        mockGetLanguage.mockReturnValue('EN');
        standalone_routes.transfer = originalTransferRoute;
    });

    it('preserves Deriv transfer intent, selected currency and language', () => {
        const url = new URL(buildDerivTransferUrl(' usd ')!);
        expect(url.origin).toBe('https://home.deriv.com');
        expect(url.pathname).toBe('/dashboard/transfer');
        expect(url.searchParams.get('acc')).toBe('options');
        expect(url.searchParams.get('from')).toBe('home');
        expect(url.searchParams.get('source')).toBe('options');
        expect(url.searchParams.get('curr')).toBe('USD');
        expect(url.searchParams.get('lang')).toBe('EN');
    });

    it('navigates real accounts using Deriv-managed transfer flow', () => {
        expect(navigateToTransfer('EUR')).toBe(true);
        expect(mockNavigate).toHaveBeenCalledTimes(1);
        const [destination, shouldReload] = mockNavigate.mock.calls[0];
        expect(shouldReload).toBe(true);
        expect(new URL(destination).searchParams.get('curr')).toBe('EUR');
        expect(destination).not.toMatch(/token|authorization|loginid|account_id/i);
    });

    it('never navigates in local Admin Test Kit, even for simulated Real', () => {
        mockIsSimulated.mockReturnValue(true);
        expect(navigateToTransfer('USD')).toBe(false);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each(['', ' ', '<script>', 'USD&account_id=123', 'a/b', 'AAAAAAAABBBBBBBBB'])(
        'rejects an invalid currency (%s)',
        currency => {
            expect(buildDerivTransferUrl(currency)).toBeNull();
            expect(navigateToTransfer(currency)).toBe(false);
            expect(mockNavigate).not.toHaveBeenCalled();
        }
    );

    it('rejects non-HTTPS or non-Deriv destinations', () => {
        standalone_routes.transfer = 'https://example.com/transfer';
        expect(navigateToTransfer('USD')).toBe(false);
        standalone_routes.transfer = 'http://home.deriv.com/dashboard/transfer';
        expect(navigateToTransfer('USD')).toBe(false);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('skips an invalid language instead of putting arbitrary text in a redirect', () => {
        mockGetLanguage.mockReturnValue('EN&token=secret');
        const url = new URL(buildDerivTransferUrl('USDT')!);
        expect(url.searchParams.get('curr')).toBe('USDT');
        expect(url.searchParams.has('lang')).toBe(false);
        expect(url.searchParams.has('token')).toBe(false);
    });
});

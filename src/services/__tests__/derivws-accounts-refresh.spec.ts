import { DerivWSAccountsService } from '../derivws-accounts.service';

jest.mock('@/components/shared', () => ({ isProduction: () => true }));

const oldAccounts = [
    { account_id: 'DOT94467818', account_type: 'demo', currency: 'USD', balance: '10000.00', status: 'active', group: 'row' },
    { account_id: 'ROT92659504', account_type: 'real', currency: 'USD', balance: '0.00', status: 'active', group: 'row' },
];
const fundedAccounts = oldAccounts.map(account =>
    account.account_id === 'ROT92659504' ? { ...account, balance: '10.28' } : account
);

describe('authenticated Options account connection uses fresh balances', () => {
    const originalFetch = global.fetch;
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        DerivWSAccountsService.clearCache();
        sessionStorage.setItem('deriv_accounts', JSON.stringify(oldAccounts));
        localStorage.setItem('active_loginid', 'ROT92659504');
    });
    afterEach(() => {
        global.fetch = originalFetch;
        DerivWSAccountsService.clearCache();
    });
    it('refreshes a previously cached zero and requests an OTP for the selected real account', async () => {
        const requests: string[] = [];
        global.fetch = jest.fn(async (url: string) => {
            requests.push(url);
            if (url.endsWith('/options/accounts')) {
                return { ok: true, json: async () => ({ data: fundedAccounts }) } as Response;
            }
            if (url.includes('/ROT92659504/otp')) {
                return { ok: true, json: async () => ({ data: { url: 'wss://api.derivws.com/trading/v1/options/ws/real?otp=test' } }) } as Response;
            }
            throw new Error('Unexpected endpoint');
        }) as unknown as typeof fetch;

        const url = await DerivWSAccountsService.getAuthenticatedWebSocketURL('test-oauth-token');
        expect(url).toContain('/ws/real?otp=');
        expect(requests.some(request => request.endsWith('/options/accounts'))).toBe(true);
        expect(requests.some(request => request.includes('/ROT92659504/otp'))).toBe(true);
        expect(DerivWSAccountsService.getStoredAccounts()?.find(a => a.account_id === 'ROT92659504')?.balance).toBe('10.28');
    });
    it('fails closed instead of connecting a different account when selection is absent', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true, json: async () => ({ data: [fundedAccounts[0]] }),
        })) as unknown as typeof fetch;
        await expect(DerivWSAccountsService.getAuthenticatedWebSocketURL('test-oauth-token'))
            .rejects.toThrow('Selected Deriv account is no longer available');
    });
});

import { checkRealExposure, identifyBulkAccount } from '../bulk-account-safety';

const assess = (overrides = {}) => checkRealExposure({
    stake: 1, quantity: 5, balance: 100,
    receivedCurrency: 'USD', receivedAccount: 'CR123',
    accountId: 'CR123', currency: 'USD', ...overrides,
});
describe('real-account bulk safety', () => {
    it('requires a matching account in the authenticated account list', () => {
        expect(identifyBulkAccount({account_id:'CR123', account_type:'real', currency:'USD'},'CR123')).toBe('real');
        expect(identifyBulkAccount({account_id:'VRTC', account_type:'demo', currency:'USD'},'VRTC')).toBe('demo');
        expect(identifyBulkAccount({account_id:'CR123', account_type:'real', currency:'USD'},'CR999')).toBe('unavailable');
        expect(identifyBulkAccount({account_id:'CR123', currency:'USD'},'CR123')).toBe('unavailable');
    });
    it('restores a VRTC demo account from a matching authenticated socket if the cache is empty', () => {
        const live = { loginid: 'VRTC1001', currency: 'USD' };
        expect(identifyBulkAccount(undefined, 'VRTC1001', {
            liveAccount: live, socketAuthorized: true,
        })).toBe('demo');
        expect(identifyBulkAccount({ account_id: 'VRTC1001' }, 'VRTC1001', {
            liveAccount: live, socketAuthorized: true,
        })).toBe('demo');
    });

    it('rejects a spoofed or disconnected demo login ID', () => {
        const liveAccount = { loginid: 'VRTC1001', currency: 'USD' };
        expect(identifyBulkAccount(null, 'VRTC1001', { liveAccount })).toBe('unavailable');
        expect(identifyBulkAccount(null, 'VRTC9999', {
            liveAccount, socketAuthorized: true,
        })).toBe('unavailable');
        expect(identifyBulkAccount(null, 'VRTC1001', {
            liveAccount: { loginid: 'VRTC1001' }, socketAuthorized: true,
        })).toBe('unavailable');
        expect(identifyBulkAccount(null, 'VRTC1001', {
            liveAccount, socketAuthorized: true, clientAccount: { loginid: 'VRTC9999', is_virtual: 1 },
        })).toBe('unavailable');
    });

    it('does not enable real trading from an ID prefix or from the socket alone', () => {
        expect(identifyBulkAccount(null, 'CR123', {
            liveAccount: { loginid: 'CR123', currency: 'USD' }, socketAuthorized: true,
            clientAccount: { loginid: 'CR123', is_virtual: 0 },
        })).toBe('unavailable');
        expect(identifyBulkAccount({ account_id: 'CR123', account_type: 'real' }, 'CR123', {
            liveAccount: { loginid: 'CR123', currency: 'USD' }, socketAuthorized: true,
        })).toBe('unavailable');
    });

    it('requires a positive finite broker balance', () => {
        [null, undefined, '', 0, -10, 'foo'].forEach(balance => expect(assess({balance}).allowed).toBe(false));
    });
    it('rejects currency and account identity mismatches', () => {
        expect(assess({receivedCurrency:'EUR'}).allowed).toBe(false);
        expect(assess({receivedAccount:'CR987'}).allowed).toBe(false);
        expect(assess({accountId:'CR987'}).allowed).toBe(false);
    });
    it('restricts stake, quantity and aggregate exposure', () => {
        expect(assess({stake:11}).allowed).toBe(false);
        expect(assess({quantity:51}).allowed).toBe(false);
        expect(assess({stake:0.5,quantity:50,balance:500}).allowed).toBe(true);
        expect(assess({stake:10,quantity:20,balance:5000}).allowed).toBe(false);
        expect(assess({stake:1,quantity:6,balance:50}).allowed).toBe(false);
        expect(assess({stake:1,quantity:5,balance:50}).allowed).toBe(true);
    });
    it('permits bounded orders with verified credentials and balance', () => {
        expect(assess({stake:0.5,quantity:10,balance:100})).toMatchObject({allowed:true,exposure:5,permitted:10});
    });
});

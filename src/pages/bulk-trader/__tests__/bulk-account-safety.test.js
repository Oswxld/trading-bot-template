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
        expect(assess({quantity:21}).allowed).toBe(false);
        expect(assess({stake:10,quantity:20,balance:5000}).allowed).toBe(false);
        expect(assess({stake:1,quantity:6,balance:50}).allowed).toBe(false);
        expect(assess({stake:1,quantity:5,balance:50}).allowed).toBe(true);
    });
    it('permits bounded orders with verified credentials and balance', () => {
        expect(assess({stake:0.5,quantity:10,balance:100})).toMatchObject({allowed:true,exposure:5,permitted:10});
    });
});

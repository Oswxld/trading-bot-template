/**
 * Supabase RPC double: each apply is atomic, cursor checked and repeat
 * sequences ignored, matching Dwellio's dclone_sim_apply_batch semantics.
 */
let mockBalanceRpc;
let mockReadPaperBalances;
let mockOpenPaperChannel;
jest.mock('../admin-supabase-auth', () => ({
    getAdminAuthUser: jest.fn(() => ({ id: '123e4567-e89b-42d3-a456-426614174000' })),
    adminRpc: (...args) => mockBalanceRpc(...args),
    getAdminAccessToken: async () => 'paper-test-token',
    getPaperRealtimeSettings: () => ({ url: 'https://example.supabase.co', key: 'public-test-key' }),
    readPaperOptionsBalances: (...args) => mockReadPaperBalances(...args),
    ADMIN_AUTH_CLEARED_EVENT: 'paper:test-auth-cleared',
}));

jest.mock('../paperBalanceRealtimeTransport.mjs', () => ({
    openPaperBalanceChannel: (...args) => mockOpenPaperChannel(...args),
}));

const CLIENT_ID = '123e4567-e89b-42d3-a456-426614174001';

describe('Supabase simulated Options balance outbox', () => {
    let remote;
    let cursors;
    let failAfterCommit;
    let sync;
    let channels;
    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();
        localStorage.clear();
        sessionStorage.clear();
        process.env.PUBLIC_SIM_CLIENT_ID = CLIENT_ID;
        remote = { demo: 1000000, real: 990192 };
        cursors = { demo: 0, real: 0 };
        failAfterCommit = false;
        mockBalanceRpc = jest.fn(async (name, args) => {
            if (name === 'dclone_sim_snapshot') {
                return {
                    balances: Object.entries(remote).map(([mode, cents]) => ({
                        mode, account: 'optionsUsd', cents,
                    })),
                    cursors: { ...cursors },
                };
            }
            if (name !== 'dclone_sim_apply_batch') throw new Error('Unexpected RPC');
            const mode = args.p_mode;
            for (const event of args.p_events) {
                if (event.seq <= cursors[mode]) continue;
                if (event.seq !== cursors[mode] + 1) throw new Error('Out-of-order balance batch');
                if (event.kind === 'adjust') remote[mode] += event.cents;
                else if (event.kind === 'set') remote[mode] = event.cents;
                else throw new Error('Unexpected balance event');
                if (remote[mode] < 0) throw new Error('Insufficient simulated balance');
                cursors[mode] = event.seq;
            }
            if (failAfterCommit) {
                failAfterCommit = false;
                throw new Error('Connection interrupted after commit');
            }
            return {
                last_sequence: cursors[mode],
                balances: [{ account: 'optionsUsd', cents: remote[mode] }],
            };
        });
        channels = [];
        mockReadPaperBalances = jest.fn(async () => Object.entries(remote).map(([account_mode, balance_cents]) => ({
            user_id: '123e4567-e89b-42d3-a456-426614174000',
            account_mode, account_type: 'optionsUsd', balance_cents,
        })));
        mockOpenPaperChannel = jest.fn(async callbacks => {
            const channel = { callbacks, close: jest.fn(async () => {}) };
            channels.push(channel);
            Promise.resolve().then(callbacks.subscribed);
            return channel;
        });
        sync = require('../admin-sim-balance-sync');
    });
    afterEach(() => {
        sync.stopAdminBalanceSync();
        jest.clearAllTimers();
        jest.useRealTimers();
        delete process.env.PUBLIC_SIM_CLIENT_ID;
    });
    it('hydrates the authenticated Supabase user real and demo Options balances', async () => {
        const balances = await sync.initializeAdminBalanceSync();
        expect(balances).toEqual({ demo: 10000, real: 9901.92 });
        expect(sync.hasPendingAdminBalances()).toBe(false);
    });
    it('accumulates trades locally and sends a single idempotent batch after one second', async () => {
        const updates = [];
        await sync.initializeAdminBalanceSync(value => updates.push(value));
        sync.queueAdminBalanceDelta('demo', -100);
        sync.queueAdminBalanceDelta('demo', 180);
        sync.queueAdminBalanceDelta('demo', -50);
        expect(updates[updates.length - 1]).toEqual({ demo: 10000.3, real: 9901.92 });
        expect(remote.demo).toBe(1000000);
        await sync.flushAdminBalanceSync();
        expect(remote.demo).toBe(1000030);
        const calls = mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch');
        expect(calls).toHaveLength(1);
        expect(calls[0][1].p_events).toEqual([{
            seq: 1, kind: 'adjust', account: 'optionsUsd', cents: 30,
        }]);
        await sync.flushAdminBalanceSync();
        expect(mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch')).toHaveLength(1);
    });
    it('recovers after server commitment but before acknowledgement without double counting', async () => {
        await sync.initializeAdminBalanceSync();
        sync.queueAdminBalanceDelta('real', -500);
        failAfterCommit = true;
        await expect(sync.flushAdminBalanceSync()).rejects.toThrow('Connection interrupted');
        expect(remote.real).toBe(989692);
        expect(sync.hasPendingAdminBalances()).toBe(true);
        await sync.flushAdminBalanceSync();
        expect(remote.real).toBe(989692);
        expect(sync.hasPendingAdminBalances()).toBe(false);
        const calls = mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch');
        expect(calls).toHaveLength(2);
        expect(calls[0][1].p_events[0].seq).toBe(calls[1][1].p_events[0].seq);
    });
    it('flushes trade changes before an explicit atomic manual balance set', async () => {
        await sync.initializeAdminBalanceSync();
        sync.queueAdminBalanceDelta('real', -100);
        await sync.setAdminRemoteBalance('real', 5000);
        expect(remote.real).toBe(500000);
        const calls = mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch');
        expect(calls.map(call => call[1].p_events[0].kind)).toEqual(['adjust', 'set']);
        expect(calls.map(call => call[1].p_events[0].seq)).toEqual([1, 2]);
        expect(sync.hasPendingAdminBalances()).toBe(false);
    });

    it('receives external paper balance updates, detaches before writing, and resumes only after a full cooldown', async () => {
        const updates = [];
        await sync.initializeAdminBalanceSync(value => updates.push(value));
        sync.startAdminPaperRealtime();
        await jest.advanceTimersByTimeAsync(0);
        expect(channels).toHaveLength(1);
        remote.real = 991000;
        channels[0].callbacks.changed();
        await jest.advanceTimersByTimeAsync(0);
        expect(updates.at(-1).real).toBe(9910);
        expect(mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch')).toHaveLength(0);
        let finishClose;
        channels[0].close.mockImplementation(() => new Promise(resolve => { finishClose = resolve; }));
        sync.queueAdminBalanceDelta('real', 100);
        const writing = sync.flushAdminBalanceSync();
        await jest.advanceTimersByTimeAsync(0);
        expect(channels[0].close).toHaveBeenCalledTimes(1);
        expect(mockBalanceRpc.mock.calls.filter(([name]) => name === 'dclone_sim_apply_batch')).toHaveLength(0);
        finishClose();
        await writing;
        expect(remote.real).toBe(991100);
        expect(channels).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(1999);
        expect(channels).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(channels).toHaveLength(2);
        expect(updates.at(-1).real).toBe(9911);
    });
});

/**
 * Durable, batched and idempotent persistence for the two simulated Options
 * wallets. Local rendering is immediate; PostgreSQL is authoritative.
 * No Deriv OAuth token or live Deriv account is ever used by this service.
 */
import { adminRpc, getAdminAuthUser } from './admin-supabase-auth';

export const ADMIN_BALANCE_SYNC_EVENT = 'yolo:admin-balance-sync';
const KEY_PREFIX = 'yolo:admin-balance-outbox:v1';
const MAX_CENTS = 100000000; // $1,000,000
const MODES = ['demo', 'real'];
let clientId = null;
let storageKey = null;
let initialized = false;
let server = { demo: 0, real: 0 };
let states = null;
let listener = null;
let timer = null;
let inFlight = { demo: null, real: null };
let blockedUntil = { demo: 0, real: 0 };
let busyWithSet = false;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const settings = () => {
    const id = (process.env.PUBLIC_SIM_CLIENT_ID || '').trim();
    if (!uuidPattern.test(id)) throw new Error('Set PUBLIC_SIM_CLIENT_ID to a stable UUID for this site in Vercel.');
    return id.toLowerCase();
};
const empty = () => ({ ack: 0, flight: null, pending: 0 });
const parseMode = mode => {
    if (!MODES.includes(mode)) throw new Error('Invalid simulated account mode.');
    return mode;
};
const centsFrom = amount => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || value > MAX_CENTS / 100) {
        throw new Error('Enter a valid simulated balance between $0 and $1,000,000.');
    }
    return Math.round(value * 100);
};
const save = () => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(states));
};
const amountOutstanding = mode => Number(states[mode].pending || 0) +
    (states[mode].flight?.kind === 'adjust' ? Number(states[mode].flight.cents) : 0);
const displayed = () => Object.fromEntries(MODES.map(mode =>
    [mode, Math.max(0, (server[mode] + amountOutstanding(mode)) / 100)]
));
const notify = error => {
    if (listener && initialized) listener(displayed());
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ADMIN_BALANCE_SYNC_EVENT, {
            detail: { pending: hasPendingAdminBalances(), error: error ? String(error.message || error) : null },
        }));
    }
};
const balancesFromSnapshot = snapshot => {
    const rows = Array.isArray(snapshot?.balances) ? snapshot.balances : [];
    for (const mode of MODES) {
        const record = rows.find(row => row.mode === mode && row.account === 'optionsUsd');
        if (!record || !Number.isSafeInteger(Number(record.cents))) {
            throw new Error(`Supabase Options balance missing for ${mode}.`);
        }
        server[mode] = Number(record.cents);
        const cursor = Number(snapshot?.cursors?.[mode]);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid balance cursor from Supabase.');
        const row = states[mode];
        if (row.flight && row.flight.seq <= cursor) row.flight = null;
        if (row.flight && row.flight.seq !== cursor + 1) {
            throw new Error('Balance outbox sequence mismatch. Do not clear browser storage; contact support.');
        }
        row.ack = cursor;
    }
    save();
};
export const isAdminBalanceSyncReady = () => initialized && !!getAdminAuthUser();
/**
 * Hydrate after verifying the Supabase session, BEFORE mounting APIBase.
 * A timed-out previously committed flight is discarded using the server
 * cursor; unacknowledged writes are added to the screen and retried.
 */
export const initializeAdminBalanceSync = async onBalances => {
    const user = getAdminAuthUser();
    if (!user?.id) throw new Error('Sign in through /secret-admin first.');
    const nextClientId = settings();
    const nextStorageKey = `${KEY_PREFIX}:${nextClientId}:${user.id}`;
    if (initialized && storageKey === nextStorageKey) {
        listener = onBalances;
        notify();
        return displayed();
    }
    if (timer) clearInterval(timer);
    initialized = false;
    clientId = nextClientId;
    storageKey = nextStorageKey;
    listener = onBalances;
    try {
        const fromStorage = JSON.parse(localStorage.getItem(storageKey) || '{}');
        states = Object.fromEntries(MODES.map(mode => {
            const item = fromStorage?.[mode] || empty();
            return [mode, {
                ack: Number.isSafeInteger(Number(item.ack)) ? Number(item.ack) : 0,
                pending: Number.isSafeInteger(Number(item.pending)) ? Number(item.pending) : 0,
                flight: item.flight || null,
            }];
        }));
    } catch { states = { demo: empty(), real: empty() }; }
    const snapshot = await adminRpc('dclone_sim_snapshot', { p_client_id: clientId });
    balancesFromSnapshot(snapshot);
    initialized = true;
    notify();
    timer = setInterval(() => {
        for (const mode of MODES) {
            if ((states[mode].flight || states[mode].pending) && Date.now() >= blockedUntil[mode]) {
                void flushMode(mode).catch(error => {
                    blockedUntil[mode] = Date.now() + 5000;
                    notify(error);
                });
            }
        }
    }, 1000);
    return displayed();
};
export const queueAdminBalanceDelta = (mode, cents) => {
    parseMode(mode);
    if (!isAdminBalanceSyncReady() || busyWithSet) {
        throw new Error('Simulated balance synchronization is not ready; trades are paused.');
    }
    if (!Number.isSafeInteger(cents) || !cents) return;
    states[mode].pending += cents;
    if (!Number.isSafeInteger(states[mode].pending)) throw new Error('Balance adjustment is too large.');
    save(); // Persist before showing the optimistic update.
    notify();
};
const flushMode = mode => {
    parseMode(mode);
    if (!isAdminBalanceSyncReady()) return Promise.reject(new Error('Admin balance sync not initialized.'));
    if (inFlight[mode]) return inFlight[mode];
    const row = states[mode];
    if (!row.flight && !row.pending) return Promise.resolve();
    if (!row.flight) {
        row.flight = { seq: row.ack + 1, kind: 'adjust', account: 'optionsUsd', cents: row.pending };
        row.pending = 0;
        save();
    }
    const flight = row.flight;
    const work = adminRpc('dclone_sim_apply_batch', {
        p_client_id: clientId,
        p_mode: mode,
        p_events: [flight],
    }).then(result => {
        const seq = Number(result?.last_sequence);
        if (seq < flight.seq || !Number.isSafeInteger(seq)) throw new Error('Supabase did not acknowledge balance event.');
        const wallet = result.balances?.find(item => item.account === 'optionsUsd');
        if (!wallet || !Number.isSafeInteger(Number(wallet.cents))) throw new Error('Invalid balance returned by Supabase.');
        server[mode] = Number(wallet.cents);
        row.ack = seq;
        row.flight = null;
        blockedUntil[mode] = 0;
        save();
        notify();
    }).finally(() => { inFlight[mode] = null; });
    inFlight[mode] = work;
    return work;
};
/** Drain both accounts; a failure retains the outbox and propagates. */
export const flushAdminBalanceSync = async () => {
    if (!isAdminBalanceSyncReady()) throw new Error('Sign in to synchronize balances.');
    for (const mode of MODES) {
        while (states[mode].flight || states[mode].pending) await flushMode(mode);
    }
};
export const hasPendingAdminBalances = () =>
    !!(states && MODES.some(mode => states[mode].flight || states[mode].pending));

/** Explicit manual override. Flush trade deltas first, then record a distinct
 * absolute 'set' event. The RPC executes each event atomically and idempotently.
 */
export const setAdminRemoteBalance = async (mode, value) => {
    parseMode(mode);
    const cents = centsFrom(value);
    if (!isAdminBalanceSyncReady() || busyWithSet) throw new Error('Balance editor is busy.');
    busyWithSet = true;
    try {
        while (states[mode].flight || states[mode].pending) await flushMode(mode);
        const row = states[mode];
        row.flight = { seq: row.ack + 1, kind: 'set', account: 'optionsUsd', cents };
        save();
        await flushMode(mode);
        return displayed()[mode];
    } finally { busyWithSet = false; }
};
export const refreshAdminRemoteBalances = async () => {
    if (!isAdminBalanceSyncReady()) throw new Error('Balance sync not ready.');
    const snapshot = await adminRpc('dclone_sim_snapshot', { p_client_id: clientId });
    balancesFromSnapshot(snapshot);
    notify();
    return displayed();
};

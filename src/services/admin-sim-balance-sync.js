/**
 * Durable, batched and idempotent persistence for the two simulated Options
 * wallets. Local rendering is immediate; PostgreSQL is authoritative.
 * No Deriv OAuth token or live Deriv account is ever used by this service.
 */
import { adminRpc, getAdminAuthUser, getAdminAccessToken, readPaperOptionsBalances,
    getPaperRealtimeSettings, ADMIN_AUTH_CLEARED_EVENT } from './admin-supabase-auth';
import { createPaperRealtimeController } from './paperBalanceRealtimeController.mjs';
import { openPaperBalanceChannel } from './paperBalanceRealtimeTransport.mjs';

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
let ownerId = null;
let generation = 0;
let controller = null;
let refreshTask = null;
export const PAPER_REMOTE_BALANCES_EVENT = 'paper:remote-balances';
const pendingCount = () => states ? MODES.reduce((sum, mode) =>
    sum + Number(!!states[mode].flight) + Number(!!states[mode].pending), 0) : 0;
const activity = () => controller?.activity(pendingCount(),
    Number(!!inFlight.demo) + Number(!!inFlight.real) + Number(busyWithSet) + Number(!!refreshTask));
const assertSession = epoch => {
    if (epoch !== generation || !initialized || getAdminAuthUser()?.id !== ownerId)
        throw new Error('Paper session changed; pending work remains on disk');
};
export const stopAdminBalanceSync = () => {
    generation++;
    initialized = false;
    if (timer) clearInterval(timer);
    timer = null;
    const previous = controller;
    controller = null;
    listener = null;
    ownerId = null;
    inFlight = { demo: null, real: null };
    refreshTask = null;
    busyWithSet = false;
    void previous?.stop();
};
if (typeof window !== 'undefined' && ADMIN_AUTH_CLEARED_EVENT)
    window.addEventListener(ADMIN_AUTH_CLEARED_EVENT, stopAdminBalanceSync);

/** Only called by the explicitly labelled simulator gate, not by live OAuth. */
export const startAdminPaperRealtime = () => {
    if (controller) return;
    if (!isAdminBalanceSyncReady()) throw new Error('Paper balance session not ready');
    const userId = ownerId;
    const epoch = generation;
    const settings = getPaperRealtimeSettings();
    const instance = createPaperRealtimeController({
        open: callbacks => openPaperBalanceChannel({ ...settings, ...callbacks, userId,
            getToken: async () => { assertSession(epoch); const token = await getAdminAccessToken(); assertSession(epoch); return token; } }),
        close: channel => channel.close(),
        read: async () => {
            assertSession(epoch);
            const rows = await readPaperOptionsBalances(userId);
            const result = {};
            for (const mode of MODES) {
                const matches = rows.filter(row => row.account_mode === mode);
                const value = Number(matches[0]?.balance_cents);
                if (matches.length !== 1 || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid paper balance snapshot');
                result[mode] = value;
            }
            assertSession(epoch);
            return result;
        },
        publish: snapshot => {
            if (controller !== instance || epoch !== generation || !isAdminBalanceSyncReady() ||
                pendingCount() || inFlight.demo || inFlight.real || busyWithSet || refreshTask) return;
            server = snapshot;
            notify();
            window.dispatchEvent(new Event(PAPER_REMOTE_BALANCES_EVENT));
        },
        onError: error => { if (epoch === generation) notify(error); },
    });
    controller = instance;
    instance.start(pendingCount(), Number(!!inFlight.demo) + Number(!!inFlight.real) + Number(busyWithSet) + Number(!!refreshTask));
};

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
export const isAdminBalanceSyncReady = () => initialized && !!ownerId && getAdminAuthUser()?.id === ownerId;
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
    stopAdminBalanceSync();
    const epoch = generation;
    ownerId = user.id;
    blockedUntil = { demo: 0, real: 0 };
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
    if (epoch !== generation || getAdminAuthUser()?.id !== ownerId) throw new Error('Paper session changed');
    balancesFromSnapshot(snapshot);
    initialized = true;
    notify();
    timer = setInterval(() => {
        for (const mode of MODES) {
            if ((states[mode].flight || states[mode].pending) && Date.now() >= blockedUntil[mode]) {
                void flushMode(mode).catch(error => {
                    if (epoch === generation) {
                        blockedUntil[mode] = Date.now() + 5000;
                        notify(error);
                    }
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
    activity();
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
    const epoch = generation;
    const instance = controller;
    const work = Promise.resolve().then(async () => {
        if (instance) await instance.waitWritable();
        assertSession(epoch);
        return adminRpc('dclone_sim_apply_batch', {
        p_client_id: clientId,
        p_mode: mode,
        p_events: [flight],
        });
    }).then(result => {
        assertSession(epoch);
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
    }).finally(() => {
        if (epoch === generation && inFlight[mode] === work) {
            inFlight[mode] = null;
            activity();
        }
    });
    inFlight[mode] = work;
    activity();
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
    const epoch = generation;
    activity();
    try {
        while (states[mode].flight || states[mode].pending) await flushMode(mode);
        assertSession(epoch);
        const row = states[mode];
        row.flight = { seq: row.ack + 1, kind: 'set', account: 'optionsUsd', cents };
        save();
        activity();
        await flushMode(mode);
        assertSession(epoch);
        return displayed()[mode];
    } finally { if (epoch === generation) { busyWithSet = false; activity(); } }
};
export const refreshAdminRemoteBalances = async () => {
    if (!isAdminBalanceSyncReady()) throw new Error('Balance sync not ready.');
    if (refreshTask) return refreshTask;
    const epoch = generation;
    const instance = controller;
    const task = Promise.resolve().then(async () => {
        // The snapshot RPC initializes rows, so treat it as an outgoing operation.
        await flushAdminBalanceSync();
        if (instance) await instance.waitWritable();
        assertSession(epoch);
        const snapshot = await adminRpc('dclone_sim_snapshot', { p_client_id: clientId });
        assertSession(epoch);
        balancesFromSnapshot(snapshot);
        notify();
        return displayed();
    }).finally(() => {
        if (epoch === generation && refreshTask === task) { refreshTask = null; activity(); }
    });
    refreshTask = task;
    activity();
    return task;
};

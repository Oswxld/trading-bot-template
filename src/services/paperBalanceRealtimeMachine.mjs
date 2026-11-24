/**
 * Transport-independent lifecycle for an explicitly labelled paper-wallet.
 * Phase 4: standalone paper-wallet lifecycle; production transport is not attached.
 *
 * The adapter must execute commands serially, await actual channel removal
 * before dispatching DETACHED, and echo the command's generation on callbacks.
 * A generation change invalidates all older channel/snapshot callbacks.
 * CLOCK uses a monotonic clock (performance.now), not wall-clock time.
 */
export const COOLDOWN_MS = 2000;
export const initialPaperSyncState = () => ({
  phase: 'STOPPED', generation: 0, pending: 0, inFlight: 0,
  detached: true, idleSince: null, stage: null, dirty: false, closed: false,
});
const busy = state => state.pending > 0 || state.inFlight > 0;
const result = (state, ...commands) => ({ state, commands });
const command = (state, type) => ({ type, generation: state.generation });
const validCount = count => Number.isSafeInteger(count) && count >= 0;

export const maySend = state => !state.closed && state.phase === 'WRITING' && state.detached;
export const mayReceive = (state, generation) =>
  !state.closed && state.phase === 'LISTENING' && generation === state.generation;

function writing(state) {
  const next = { ...state, phase: 'WRITING', generation: state.generation + 1,
    idleSince: null, stage: null, dirty: false };
  return next.detached ? result(next) : result(next, command(next, 'UNSUBSCRIBE'));
}
function drained(state, now) {
  if (busy(state) || !state.detached) return result(state);
  const next = { ...state, phase: 'COOLDOWN', idleSince: now };
  return result(next, { ...command(next, 'WAKE'), delayMs: COOLDOWN_MS });
}
function reconnect(state) {
  const next = { ...state, phase: 'RECONNECTING', generation: state.generation + 1,
    idleSince: null, stage: state.detached ? 'SUBSCRIBING' : 'DETACHING', dirty: false, detached: false };
  return result(next, command(next, state.detached ? 'SUBSCRIBE' : 'UNSUBSCRIBE'));
}

/**
 * Events:
 * START / ACTIVITY: pending, inFlight, now (both modes combined).
 * CLOCK: generation, now.
 * DETACHED / SUBSCRIBED / CHANGE / SNAPSHOT_READY / CONNECTION_LOST:
 * generation; DETACHED also includes now; SNAPSHOT_READY includes snapshot.
 * STOP: terminal for this instance (create a new instance for a new user).
 *
 * Commands describe adapter work; no command writes balances directly.
 * INVALIDATE means fetch/reconcile the authoritative simulated snapshot.
 * Do not treat a Realtime row as a delta or replay it into the outbox.
 */
export function reducePaperSync(state, event) {
  if (state.closed) return result(state);
  if (event.type === 'STOP') {
    const next = { ...initialPaperSyncState(), closed: true,
      generation: state.generation + 1, detached: false };
    return result(next, command(next, 'UNSUBSCRIBE'));
  }
  if (event.type === 'START' || event.type === 'ACTIVITY') {
    if (!validCount(event.pending) || !validCount(event.inFlight) ||
        !Number.isFinite(event.now)) throw new Error('Invalid paper sync activity');
    if (event.type === 'START' && state.phase !== 'STOPPED') return result(state);
    if (event.type === 'ACTIVITY' && state.phase === 'STOPPED') return result(state);
    const next = { ...state, pending: event.pending, inFlight: event.inFlight };
    if (busy(next)) {
      if (next.phase === 'WRITING') return result(next);
      return writing(next);
    }
    if (next.phase === 'STOPPED') return reconnect(next);
    if (next.phase === 'WRITING') return drained(next, event.now);
    return result(next);
  }
  if (event.generation !== state.generation) return result(state);
  switch (event.type) {
    case 'DETACHED': {
      if (state.phase === 'WRITING') {
        const next = { ...state, detached: true };
        return busy(next) ? result(next) : drained(next, event.now);
      }
      if (state.phase === 'RECONNECTING' && state.stage === 'DETACHING') {
        const next = { ...state, detached: false, stage: 'SUBSCRIBING' };
        return result(next, command(next, 'SUBSCRIBE'));
      }
      break;
    }
    case 'CLOCK':
      if (state.phase === 'COOLDOWN' && !busy(state) && state.detached &&
          event.now - state.idleSince >= COOLDOWN_MS) return reconnect(state);
      break;
    case 'SUBSCRIBED':
      if (state.phase === 'RECONNECTING' && state.stage === 'SUBSCRIBING') {
        const next = { ...state, detached: false, stage: 'SNAPSHOT', dirty: false };
        return result(next, command(next, 'SNAPSHOT'));
      }
      break;
    case 'CHANGE':
      if (mayReceive(state, event.generation)) return result(state, command(state, 'INVALIDATE'));
      if (state.phase === 'RECONNECTING' && state.stage === 'SNAPSHOT')
        return result({ ...state, dirty: true });
      break;
    case 'SNAPSHOT_READY':
      if (state.phase === 'RECONNECTING' && state.stage === 'SNAPSHOT' && !busy(state)) {
        if (state.dirty) {
          const next = { ...state, dirty: false };
          return result(next, command(next, 'SNAPSHOT'));
        }
        const next = { ...state, phase: 'LISTENING', stage: null };
        return result(next, { ...command(next, 'PUBLISH_SNAPSHOT'), snapshot: event.snapshot });
      }
      break;
    case 'CONNECTION_LOST':
      if (state.phase === 'LISTENING' || state.phase === 'RECONNECTING')
        return reconnect({ ...state, detached: false });
      break;
  }
  return result(state);
}

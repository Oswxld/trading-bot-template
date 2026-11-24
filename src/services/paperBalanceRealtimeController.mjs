import { initialPaperSyncState, reducePaperSync, maySend, mayReceive } from './paperBalanceRealtimeMachine.mjs';

/**
 * A single authenticated paper-wallet subscription. Realtime is an invalidation
 * signal; fetch all rows in one read so transfers never display half a transaction.
 * The transport and publication callbacks are injected for deterministic tests.
 */
export function createPaperRealtimeController({
  open, close, read, publish, onError = () => {},
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
}) {
  let state = initialPaperSyncState();
  let channel = null;
  let serial = Promise.resolve();
  let wake = null;
  let retry = null;
  let invalidationQueued = false;
  let invalidationDirty = false;
  let invalidationGeneration = -1;

  const current = gen => !state.closed && state.generation === gen;
  const enqueue = work => {
    const next = serial.then(work);
    serial = next.catch(() => {});
    return next;
  };
  const recover = (gen, error, command) => {
    if (!current(gen)) return;
    onError(error);
    if (retry !== null) cancel(retry);
    retry = schedule(() => {
      retry = null;
      if (!current(gen)) return;
      if (command.type === 'UNSUBSCRIBE') run(command);
      else dispatch({ type: 'CONNECTION_LOST', generation: gen });
    }, 1000);
  };
  function dispatch(event) {
    const previous = state.generation;
    const next = reducePaperSync(state, event);
    state = next.state;
    if (previous !== state.generation) {
      if (wake !== null) cancel(wake);
      if (retry !== null) cancel(retry);
      wake = retry = null;
      invalidationQueued = invalidationDirty = false;
      invalidationGeneration = -1;
    }
    for (const command of next.commands) run(command);
  }
  function run(command) {
    const gen = command.generation;
    if (command.type === 'WAKE') {
      if (wake !== null) cancel(wake);
      const tick = () => {
        wake = null;
        if (!current(gen) || state.phase !== 'COOLDOWN') return;
        const remaining = command.delayMs - (now() - state.idleSince);
        if (remaining > 0) { wake = schedule(tick, Math.ceil(remaining)); return; }
        dispatch({ type: 'CLOCK', generation: gen, now: now() });
      };
      wake = schedule(tick, command.delayMs);
      return;
    }
    if (command.type === 'PUBLISH_SNAPSHOT') {
      if (mayReceive(state, gen)) publish(command.snapshot);
      return;
    }
    if (command.type === 'INVALIDATE') {
      if (invalidationQueued && invalidationGeneration === gen) {
        invalidationDirty = true;
        return;
      }
      invalidationQueued = true;
      invalidationGeneration = gen;
    }
    void enqueue(async () => {
      if (!current(gen) && !(state.closed && command.type === 'UNSUBSCRIBE')) return;
      try {
        switch (command.type) {
          case 'UNSUBSCRIBE':
            if (channel !== null) {
              await close(channel);
              channel = null;
            }
            if (current(gen)) dispatch({ type: 'DETACHED', generation: gen, now: now() });
            break;
          case 'SUBSCRIBE':
            if (channel !== null) throw new Error('Previous paper subscription still exists');
            channel = await open({
              subscribed: () => dispatch({ type: 'SUBSCRIBED', generation: gen }),
              changed: () => dispatch({ type: 'CHANGE', generation: gen }),
              disconnected: () => {
                if (current(gen)) recover(gen, new Error('Paper balance connection interrupted'), command);
              },
            });
            break;
          case 'SNAPSHOT': {
            const snapshot = await read();
            if (current(gen)) dispatch({ type: 'SNAPSHOT_READY', generation: gen, snapshot });
            break;
          }
          case 'INVALIDATE': {
            try {
              do {
                invalidationDirty = false;
                const snapshot = await read();
                if (mayReceive(state, gen)) publish(snapshot);
              } while (current(gen) && invalidationDirty);
            } finally {
              if (invalidationGeneration === gen) invalidationQueued = false;
            }
            break;
          }
        }
      } catch (error) {
        if (state.closed) onError(error);
        else recover(gen, error, command);
      }
    });
  }

  return {
    start(pending, inFlight = 0) {
      dispatch({ type: 'START', pending, inFlight, now: now() });
    },
    activity(pending, inFlight = 0) {
      dispatch({ type: 'ACTIVITY', pending, inFlight, now: now() });
    },
    async waitWritable() {
      // A change of generation can enqueue another detach while the previous
      // command is in progress. Never permit a write without an actual detach.
      await serial;
      if (!maySend(state)) throw new Error('Paper balance writer is waiting for subscription removal');
    },
    get phase() { return state.phase; },
    get canSend() { return maySend(state); },
    stop() { dispatch({ type: 'STOP' }); return serial; },
  };
}

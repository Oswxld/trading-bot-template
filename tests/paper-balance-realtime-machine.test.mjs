import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPaperSyncState, reducePaperSync, maySend, mayReceive } from '../src/services/paperBalanceRealtimeMachine.mjs';

function harness() {
  let state = initialPaperSyncState();
  return {
    get state() { return state; },
    event(type, fields = {}) {
      const { state: next, commands } = reducePaperSync(state, { type, generation: state.generation, ...fields });
      state = next;
      return commands.map(c => c.type);
    },
    activity(pending, inFlight, now) { return this.event('ACTIVITY', { pending, inFlight, now }); },
    listen() {
      assert.deepEqual(this.event('START', { pending: 0, inFlight: 0, now: 0 }), ['SUBSCRIBE']);
      assert.deepEqual(this.event('SUBSCRIBED'), ['SNAPSHOT']);
      assert.deepEqual(this.event('SNAPSHOT_READY', { snapshot: {} }), ['PUBLISH_SNAPSHOT']);
      assert.equal(state.phase, 'LISTENING');
    },
  };
}
test('idle login subscribes then recovers a snapshot before listening', () => {
  const h = harness();
  h.listen();
  assert.equal(mayReceive(h.state, h.state.generation), true);
  assert.equal(maySend(h.state), false);
  assert.deepEqual(h.event('CHANGE'), ['INVALIDATE']);
});
test('writer must detach, drain all queued and in-flight work, then wait 2 seconds', () => {
  const h = harness(); h.listen();
  const old = h.state.generation;
  assert.deepEqual(h.activity(1, 0, 100), ['UNSUBSCRIBE']);
  assert.equal(maySend(h.state), false);
  assert.equal(mayReceive(h.state, old), false);
  assert.deepEqual(h.event('CHANGE', { generation: old }), []);
  h.event('DETACHED', { now: 150 });
  assert.equal(maySend(h.state), true);
  h.activity(0, 1, 200);
  assert.equal(h.state.phase, 'WRITING');
  assert.deepEqual(h.activity(0, 0, 300), ['WAKE']);
  assert.equal(h.state.phase, 'COOLDOWN');
  assert.equal(maySend(h.state), false);
  assert.deepEqual(h.event('CLOCK', { now: 2299 }), []);
  assert.deepEqual(h.event('CLOCK', { now: 2300 }), ['SUBSCRIBE']);
  h.event('SUBSCRIBED');
  h.event('SNAPSHOT_READY', { snapshot: {} });
  assert.equal(h.state.phase, 'LISTENING');
});
test('new queued work restarts cooldown; failed batch stays writing', () => {
  const h = harness();
  h.event('START', { pending: 1, inFlight: 0, now: 0 });
  assert.equal(maySend(h.state), true);
  h.activity(1, 1, 100);
  h.activity(1, 0, 200);
  assert.equal(h.state.phase, 'WRITING');
  h.activity(0, 0, 300);
  const old = h.state.generation;
  h.activity(1, 0, 1500);
  h.activity(0, 0, 1600);
  assert.deepEqual(h.event('CLOCK', { generation: old, now: 2300 }), []);
  assert.deepEqual(h.event('CLOCK', { now: 3599 }), []);
  assert.deepEqual(h.event('CLOCK', { now: 3600 }), ['SUBSCRIBE']);
});
test('new work during subscribe requires removal and ignores stale callbacks', () => {
  const h = harness();
  h.event('START', { pending: 0, inFlight: 0, now: 0 });
  const old = h.state.generation;
  assert.deepEqual(h.activity(1, 0, 20), ['UNSUBSCRIBE']);
  assert.equal(maySend(h.state), false);
  assert.deepEqual(h.event('SUBSCRIBED', { generation: old }), []);
  assert.deepEqual(h.event('SNAPSHOT_READY', { generation: old, snapshot: {} }), []);
  h.event('DETACHED', { now: 25 });
  assert.equal(maySend(h.state), true);
});
test('changes during snapshot recovery trigger another snapshot', () => {
  const h = harness();
  h.event('START', { pending: 0, inFlight: 0, now: 0 });
  h.event('SUBSCRIBED');
  h.event('CHANGE');
  assert.deepEqual(h.event('SNAPSHOT_READY', { snapshot: {} }), ['SNAPSHOT']);
  assert.equal(h.state.phase, 'RECONNECTING');
  assert.deepEqual(h.event('SNAPSHOT_READY', { snapshot: {} }), ['PUBLISH_SNAPSHOT']);
  assert.equal(h.state.phase, 'LISTENING');
});
test('connection loss detaches old channel; logout invalidates callbacks', () => {
  const h = harness(); h.listen();
  const old = h.state.generation;
  assert.deepEqual(h.event('CONNECTION_LOST'), ['UNSUBSCRIBE']);
  assert.equal(mayReceive(h.state, old), false);
  assert.deepEqual(h.event('DETACHED', { now: 5 }), ['SUBSCRIBE']);
  h.event('SUBSCRIBED');
  const current = h.state.generation;
  assert.deepEqual(h.event('STOP'), ['UNSUBSCRIBE']);
  assert.deepEqual(h.event('SNAPSHOT_READY', { generation: current, snapshot: {} }), []);
  assert.equal(maySend(h.state), false);
  assert.equal(h.state.closed, true);
});

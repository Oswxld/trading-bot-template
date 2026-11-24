import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperRealtimeController } from '../src/services/paperBalanceRealtimeController.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
function fixture(overrides = {}) {
  let time = 0, id = 0, value = 1000;
  const timers = new Map(), channels = [], published = [], errors = [];
  const controller = createPaperRealtimeController({
    open: async callbacks => {
      const channel = { callbacks, removed: false };
      channels.push(channel);
      queueMicrotask(callbacks.subscribed);
      return channel;
    },
    close: async channel => { channel.removed = true; },
    read: async () => value,
    publish: snapshot => published.push(snapshot),
    onError: error => errors.push(error),
    now: () => time,
    schedule: (fn, delay) => { const key = ++id; timers.set(key, { fn, due: time + delay }); return key; },
    cancel: key => timers.delete(key),
    ...overrides,
  });
  return {
    controller, channels, published, errors,
    setValue(v) { value = v; },
    async advance(ms) {
      time += ms;
      for (const [key, timer] of [...timers]) {
        if (timer.due <= time && timers.delete(key)) timer.fn();
      }
      await turn();
    },
  };
}
test('live notifications trigger read-only snapshots and no outgoing writes while listening', async () => {
  const f = fixture();
  f.controller.start(0);
  await turn();
  assert.equal(f.controller.phase, 'LISTENING');
  assert.deepEqual(f.published, [1000]);
  f.setValue(1020);
  f.channels[0].callbacks.changed();
  await turn();
  assert.deepEqual(f.published, [1000, 1020]);
  assert.equal(f.controller.canSend, false);
  await f.controller.stop();
  assert.equal(f.channels[0].removed, true);
});
test('waitWritable waits for actual removal, and old notifications cannot publish', async () => {
  const detach = deferred();
  const f = fixture({ close: async channel => { await detach.promise; channel.removed = true; } });
  f.controller.start(0);
  await turn();
  f.controller.activity(1, 0);
  let permitted = false;
  const waiting = f.controller.waitWritable().then(() => { permitted = true; });
  await turn();
  assert.equal(permitted, false);
  f.setValue(5555);
  f.channels[0].callbacks.changed();
  detach.resolve();
  await waiting;
  assert.equal(permitted, true);
  assert.deepEqual(f.published, [1000]);
  f.controller.activity(0, 1);
  await f.advance(4000);
  assert.equal(f.channels.length, 1);
  f.controller.activity(0, 0);
  await f.advance(1999);
  assert.equal(f.channels.length, 1);
  await f.advance(1);
  assert.equal(f.channels.length, 2);
  assert.equal(f.controller.phase, 'LISTENING');
  assert.deepEqual(f.published, [1000, 5555]);
  await f.controller.stop();
});
test('queued write invalidates in-progress listener snapshot', async () => {
  const pending = deferred();
  let reads = 0;
  const f = fixture({ read: async () => ++reads === 1 ? 1000 : pending.promise });
  f.controller.start(0);
  await turn();
  f.channels[0].callbacks.changed();
  await turn();
  f.controller.activity(1);
  pending.resolve(1111);
  await f.controller.waitWritable();
  assert.deepEqual(f.published, [1000]);
  assert.equal(f.controller.canSend, true);
  await f.controller.stop();
});
test('failed unsubscribe blocks writes until retry succeeds', async () => {
  let fail = true;
  const f = fixture({ close: async channel => {
    if (fail) throw new Error('remove failed');
    channel.removed = true;
  } });
  f.controller.start(0);
  await turn();
  f.controller.activity(1);
  await assert.rejects(f.controller.waitWritable());
  assert.equal(f.controller.canSend, false);
  assert.equal(f.errors.length, 1);
  fail = false;
  await f.advance(1000);
  await f.controller.waitWritable();
  assert.equal(f.controller.canSend, true);
  await f.controller.stop();
});
test('network interruption reconnects and recovers missed updates', async () => {
  const f = fixture();
  f.controller.start(0);
  await turn();
  f.setValue(1200);
  f.channels[0].callbacks.disconnected();
  await f.advance(1000);
  assert.equal(f.channels.length, 2);
  assert.equal(f.channels[0].removed, true);
  assert.deepEqual(f.published, [1000, 1200]);
  await f.controller.stop();
});

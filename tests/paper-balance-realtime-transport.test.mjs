import test from 'node:test';
import assert from 'node:assert/strict';
import { openPaperBalanceChannel } from '../src/services/paperBalanceRealtimeTransport.mjs';
const userId = '123e4567-e89b-42d3-a456-426614174000';
class FakeSocket extends EventTarget {
  static latest;
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; FakeSocket.latest = this; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  receive(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { this.readyState = 2; }
  closed() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
const setup = async () => {
  const calls = { subscribed: 0, changed: 0, disconnected: 0 };
  const channel = await openPaperBalanceChannel({
    url: 'https://example.supabase.co', key: 'public-key', userId,
    getToken: async () => 'test-token', Socket: FakeSocket,
    subscribed: () => calls.subscribed++, changed: () => calls.changed++,
    disconnected: () => calls.disconnected++,
  });
  const socket = FakeSocket.latest;
  socket.open();
  const join = socket.sent[0];
  const ack = () => socket.receive({ topic: join.topic, event: 'phx_reply', ref: '1',
    payload: { status: 'ok', response: { postgres_changes:
      join.payload.config.postgres_changes.map((binding, i) => ({ ...binding, id: i + 1 })) } } });
  const change = (owner = userId, type = 'optionsUsd') => socket.receive({
    topic: join.topic, event: 'postgres_changes',
    payload: { ids: [2], data: { schema: 'public', table: 'dclone_sim_account_balances',
      type: 'UPDATE', record: { user_id: owner, account_type: type } } },
  });
  const close = async () => { const promise = channel.close(); socket.closed(); await promise; };
  return { channel, socket, join, calls, ack, change, close };
};
test('authenticated receive-only subscription is scoped to owner and table', async () => {
  const f = await setup();
  assert.equal(new URL(f.socket.url).protocol, 'wss:');
  assert.equal(new URL(f.socket.url).searchParams.has('access_token'), false);
  assert.equal(f.join.payload.access_token, 'test-token');
  assert.deepEqual(f.join.payload.config.postgres_changes.map(b => b.event), ['INSERT', 'UPDATE']);
  assert.ok(f.join.payload.config.postgres_changes.every(b => b.filter === 'user_id=eq.' + userId));
  f.change(); assert.equal(f.calls.changed, 0);
  f.ack(); assert.equal(f.calls.subscribed, 1);
  f.change('other'); f.change(userId, 'walletUsd');
  assert.equal(f.calls.changed, 0);
  f.change(); assert.equal(f.calls.changed, 1);
  await f.close();
});
test('closure waits for actual socket close and ignores late messages', async () => {
  const f = await setup(); f.ack();
  let done = false;
  const pending = f.channel.close().then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  f.change(); assert.equal(f.calls.changed, 0);
  f.socket.closed(); await pending;
  assert.equal(done, true);
  assert.equal(f.calls.disconnected, 0);
});
test('join rejection is fail-closed and triggers reconnection', async () => {
  const f = await setup();
  f.socket.receive({ topic: f.join.topic, event: 'phx_reply', ref: '1',
    payload: { status: 'error', response: {} } });
  assert.equal(f.calls.subscribed, 0);
  assert.equal(f.calls.disconnected, 1);
  f.change(); assert.equal(f.calls.changed, 0);
  await f.close();
});

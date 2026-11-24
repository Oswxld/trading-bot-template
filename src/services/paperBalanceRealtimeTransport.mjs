/**
 * Dedicated, authenticated, receive-only Supabase Realtime v1 channel for the
 * explicitly identified paper-trading test environment. No broker API or
 * live funds. One socket per subscription; close waits for the close event.
 */
export async function openPaperBalanceChannel({
  url, key, userId, getToken, subscribed, changed, disconnected,
  Socket = globalThis.WebSocket,
}) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid paper session owner');
  const endpoint = new URL('/realtime/v1/websocket', url);
  if (endpoint.protocol !== 'https:') throw new Error('Secure paper Realtime endpoint required');
  endpoint.protocol = 'wss:';
  endpoint.searchParams.set('apikey', key);
  endpoint.searchParams.set('vsn', '1.0.0');
  let token = await getToken();
  if (!token) throw new Error('Paper session token unavailable');
  const socket = new Socket(endpoint.toString());
  const topic = 'realtime:paper-wallet-' + globalThis.crypto.randomUUID();
  const joinRef = '1';
  let nextRef = 1, joined = false, closing = false, failed = false, heartbeatRef = null;
  let heartbeat = null, timeout = null, tokenWork = false;
  let closeResolve;
  const closed = new Promise(resolve => { closeResolve = resolve; });
  const table = 'dclone_sim_account_balances';
  const bindings = ['INSERT', 'UPDATE'].map(event => ({
    event, schema: 'public', table, filter: 'user_id=eq.' + userId,
  }));
  let ids = new Set();
  const clear = () => { clearInterval(heartbeat); clearTimeout(timeout); };
  const send = (event, payload, ref = String(++nextRef), target = topic) => {
    if (socket.readyState !== 1) throw new Error('Paper Realtime connection is not open');
    socket.send(JSON.stringify({ topic: target, event, payload, ref,
      join_ref: target === 'phoenix' ? null : joinRef }));
    return ref;
  };
  const fail = () => {
    if (closing || failed) return;
    failed = true;
    clear();
    if (socket.readyState < 2) socket.close();
    disconnected();
  };
  socket.addEventListener('open', () => {
    if (closing || failed) return;
    try {
      send('phx_join', {
        access_token: token,
        config: { broadcast: { ack: false, self: false }, presence: { enabled: false },
          postgres_changes: bindings, private: false },
      }, joinRef);
      heartbeat = setInterval(async () => {
        if (closing || failed) return;
        try {
          if (heartbeatRef !== null) { fail(); return; }
          heartbeatRef = send('heartbeat', {}, undefined, 'phoenix');
          if (tokenWork) return;
          tokenWork = true;
          try {
            const latest = await getToken();
            if (closing || failed) return;
            if (!latest) throw new Error('Paper authentication lost');
            if (joined && latest !== token) {
              token = latest;
              send('access_token', { access_token: token });
            }
          } finally { tokenWork = false; }
        } catch { fail(); }
      }, 20000);
    } catch { fail(); }
  });
  socket.addEventListener('message', message => {
    if (closing || failed) return;
    let frame;
    try { frame = JSON.parse(message.data); } catch { return; }
    const { topic: incoming, event, payload, ref } = frame || {};
    if (incoming === 'phoenix' && event === 'phx_reply' && ref === heartbeatRef) {
      if (payload?.status !== 'ok') fail();
      else heartbeatRef = null;
      return;
    }
    if (incoming !== topic) return;
    if (event === 'phx_error' || event === 'phx_close' ||
        (event === 'system' && payload?.status === 'error')) { fail(); return; }
    if (event === 'phx_reply' && ref === joinRef && !joined) {
      const response = payload?.response?.postgres_changes;
      if (payload?.status !== 'ok' || !Array.isArray(response) ||
          !bindings.every(binding => response.some(row => row.event === binding.event &&
            row.schema === binding.schema && row.table === binding.table && Number.isFinite(row.id)))) {
        fail(); return;
      }
      ids = new Set(response.map(row => row.id));
      joined = true;
      clearTimeout(timeout);
      subscribed();
      return;
    }
    if (event === 'postgres_changes' && joined) {
      const row = payload?.data;
      if (row?.schema === 'public' && row.table === table &&
          ['INSERT', 'UPDATE'].includes(row.type) &&
          row.record?.user_id === userId && row.record?.account_type === 'optionsUsd' &&
          Array.isArray(payload?.ids) && payload.ids.some(id => ids.has(id))) changed();
    }
  });
  socket.addEventListener('error', fail);
  socket.addEventListener('close', () => {
    clear();
    closeResolve();
    if (!closing && !failed) { failed = true; disconnected(); }
  });
  timeout = setTimeout(fail, 12000);
  return {
    async close() {
      closing = true;
      clear();
      if (socket.readyState === 3) return;
      if (socket.readyState < 2) socket.close();
      let deadline;
      try {
        await Promise.race([closed, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Paper socket closure not confirmed')), 12000);
        })]);
      } finally { clearTimeout(deadline); }
    },
  };
}

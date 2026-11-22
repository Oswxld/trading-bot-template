# Supabase admin portal and persistent simulated balances

This feature is isolated from the public Deriv OAuth experience. **Do not deploy it to a live
client branch until its environment variables and Supabase Auth settings are configured.**

## Vercel variables (per site)

Add these to **Production** (and Preview if used), then redeploy so Rsbuild can
embed the public settings at build time:

- `PUBLIC_SUPABASE_URL`: Dwellio Supabase project URL.
- `PUBLIC_SUPABASE_ANON_KEY`: Supabase **publishable** / legacy anon key. Do not use a service-role key.
- `PUBLIC_SIM_CLIENT_ID`: One stable, generated UUID for **this client website**. Keep
  it unchanged between deploys. Do not share an ID with DClone, whose sequence cursors
  are separate, and do not change it with each user login.

Each deployment also retains its existing Deriv `CLIENT_ID` and other partner variables.

## Login

Visit `/secret-admin`. Sign in to an *existing* Supabase Auth account using
password or email OTP. Email OTP depends on Supabase email delivery configuration.
There is **no signup button** and no `4005` admin password. Anyone who can
authenticate to this Supabase project has admin-test access, per the current
product decision. To restrict access to individual site owners later, add
server-enforced site membership checks rather than only hiding the route.

The test kit's dot/dashboard shortcut is visible **only after** this Supabase
login has been validated and the simulated balance snapshot is loaded. Deriv
OAuth users remain in the ordinary public trading flow. Removing/reloading the
portal does not sign into a real Deriv account.

## Balance data

Database: `dclone_sim_account_balances` (existing). The two virtual accounts
map exactly to:

- `TEST_DEMO_ID` -> `account_mode = 'demo'`, `account_type = 'optionsUsd'`
- `TEST_REAL_ID` -> `account_mode = 'real'`, `account_type = 'optionsUsd'`

All rows are owned by Supabase `auth.uid()`, **not** a Deriv UUID. On login and
refresh, `dclone_sim_snapshot(p_client_id)` hydrates both balances and cursor
sequences. It creates default rows for new users without modifying existing
ones. These are fictional simulated funds, not live Deriv balances.

## Trade writes

Bot Builder and Bulk Trader share the simulator and therefore call the same
balance update path. Each buy/settlement updates the UI immediately, stores
the signed cents change in the browser's durable localStorage outbox, and
aggregates changes into a single sequenced PostgreSQL `adjust` event roughly
once per second **when changes exist**. The existing
`dclone_sim_apply_batch(p_client_id, p_mode, p_events)` RPC applies events
atomically and deduplicates acknowledged sequences.

If a request is interrupted, an unacknowledged flight is retried with **the
same sequence**; when the site reloads, the latest server cursor decides if
it was already committed. Browser storage is namespaced by Supabase user ID
and stable site UUID. Do not manually delete this pending queue.

Manual balance edits use a different `set` event after outstanding
trade deltas are flushed, and refresh the source-of-truth balance. A failed
sync never discards pending changes. Account switching and logout flush pending
writes and refuse to proceed if the flush fails.

**Important limits:** The outbox is browser-local, not a server-side ledger;
its durability depends on browser storage remaining available. The user has
assumed no simultaneous trading from DClone and this site; idempotent requests
still protect against network retries. A browser data clear before unconfirmed
events reach PostgreSQL can discard those events. The code does not batch
live Deriv trades, and it does not change a Deriv account's real balance.

## Security

- The secret URL is not an authorization boundary. Supabase Auth access tokens
  are required for RPC calls, and RPC functions derive the owner via `auth.uid()`.
- Only publishable Supabase keys are included in the browser bundle.
- No Deriv UUID comparison, local hardcoded test password, or unauthenticated
  UI shortcut may activate the Admin Test Kit.
- No additions or direct writes to the underlying Supabase balance tables are
  required: the existing authenticated RPC functions are reused.

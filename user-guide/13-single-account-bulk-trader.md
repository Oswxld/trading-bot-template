# Same-account Bulk Trader: Deriv-style UI, reports and demo verification

The Bulk Trader is **a new tab beside Charts** on the existing blue main navigation bar, not a separate top-header link or a second app. Open `https://localhost:8443/#bulk_trader`. The old `/bulk-trader` URL redirects to that tab.

## UI based on supplied reference screenshots

- Market / Trade Type at the top, Number of Ticks (history sample) and Prediction underneath.
- Market dropdown is populated from **Deriv live active_symbols**. It includes available Volatility and Step indices (up to Step Index 100 if Deriv lists that symbol for the connected market/account). There is a short Volatility fallback while the list loads; do not invent Step symbol codes.
- Deriv `ticks_history` (default 1,000 ticks) with live tick updates for current tick quote, last-digit (0–9) percentages, and 8 recent digit outcomes.
- Ticks duration, Stake per contract, Number of trades and a calculated Total Stake.
- Two large actions corresponding to the selected Trade Type: Differs/Matches, Under/Over, Even/Odd, or Fall/Rise. Contract types not offered by Deriv for the market are disabled when `contracts_for` data is available.
- The global **Run Bot** button and Bot Builder's RunPanel are **not rendered while Bulk Trader is selected**; Bulk Trader's own action buttons control its independent order loop. This prevents the misleading cross-tab Run Bot action. It does not stop a Bot Builder strategy that was already running before tab switching; the Bulk Trader's existing checks reject new bulk orders when the shared API marks the bot as running.
- On the right, a dedicated **inline report panel** uses Deriv's original **StatisticsSummary** component and matching visual style but no longer embeds the fixed-position legacy Drawer/Tabs components, which could result in an unreadable white overlay. It provides visible **Summary / Transactions / Journal**, six stats, Reset, Download, View Detail, and **Expand/Restore**. On desktop it opens by default with a 420px column; a prominent **View Summary / Transactions / Journal** / **Hide reports** button controls it. On smaller screens the panel starts closed and opens over the trading form. If the Bulk Trader component itself fails to render, an error boundary displays a message rather than a blank screen.
- View Detail uses the **existing draggable, resizable Deriv detailed-transactions wrapper** and displays trade records plus account/run/stake/payout/win/loss/P&L/balance summaries.
- Results, journal, and stats are **bulk-trader-specific**, stored by authenticated account in browser session storage. Reset only erases this local report; Deriv's account statement remains authoritative.
- Profit/loss and payouts are reported only when Deriv's contract-status response confirms settlement. No placeholder winnings or fabricated balances.

## Implementation and safety

This is NOT Deriv's REST Bulk Purchase for multiple different accounts. For each single-account demo order:

1. Confirm account and WebSocket connection match the selected **demo** login ID. No real-money trading is enabled.
2. Check user configuration: 1–50 trades, stake > 0 and <= 100 per trade, duration 1–10 ticks, history window 10–5,000.
3. Get a streaming `proposal` with `subscribe:1`, `underlying_symbol`, a unique `req_id`, and prediction barrier when needed.
4. Verify quoted price is no higher than the configured stake; only then submit the separate `buy`. Never automatically retry a buy whose response was lost.
5. Record confirmed contract ID and purchase price. Listen to the app's existing `proposal_open_contract` stream for settlement; query status only if a contract still appears open after the grace period, and reconcile old open records on returning to the tab.
6. Allow up to **min(5, chosen number of trades)** independent purchase operations in flight. Each operation still waits for its own streaming `proposal` before sending its `buy`, but does **not** wait for other workers' buy confirmations. Reserve each trade index only once (no duplicate attempts), replenish a free slot until the chosen quantity is processed, and stagger worker starts by at least **500 ms** across the batch to limit request bursts. This concurrency cap is an upper bound, not a guarantee five are simultaneously outstanding.
7. The Stop button prevents new starts and prevents a not-yet-submitted buy after the quote returns. Buys already sent may still execute and confirm after Stop; never automatically retry ambiguous requests. Halt new starts on an ambiguous acknowledgement or repeated purchase errors. Track completed operations and in-flight operations independently.
8. If an account switch happens while purchases are outstanding, do not attribute their late confirmations to the newly selected account; preserve them in the originating account's report.
9. Deriv's documented WebSocket budget for `proposal`, `buy`, `proposal_open_contract`, and `sell` is shared (currently 360 requests/minute and 14,400/hour). The 500 ms pacing is a proposed initial setting with an independent shared soft request budget (240/min, 12,000/hour); it does not guarantee API acceptance when other traffic shares the same session.
10. Don't simultaneously run the existing automated Deriv bot on the same account.


### Step 2: Request-budget protection (500 ms start spacing)

- **500 ms is the requested minimum gap between the starts of separate trade operations**, not an API-mandated delay, a guarantee of completed purchase speed, or an increase to the Deriv trading limits. At most `min(5, chosen quantity)` workers overlap.
- Official published shared trading-group ceilings: **360/minute and 14,400/hour** across `proposal`, `buy`, `sell`, and `proposal_open_contract`.
- This app voluntarily gates **Bulk Trader trading sends** at **240/minute and 12,000/hour**, with rolling windows. The counters observe all trading request frames emitted on the application's **shared WebSocket**, including Bot Builder requests. Other features are *measured only*, not delayed by this change.
- A rejected trading request indicating a rate limit triggers a bounded exponential cooldown (1, 2, 4, 8, 16, up to 30 seconds), with escalation reset after a minute without another rate-limit error. Waiting bulk requests remain cancellable with Stop/account switch, and their 15-second response timeout starts **only after they are sent**.
- An unexpected raw WebSocket frame is counted conservatively instead of silently undercounting. If the shared socket's `send` meter is replaced, Bulk Trader fails closed instead of trading without visibility.
- **Scope limitation:** Counter state is held in the browser page process. Opening other tabs, browsers, devices, or separate app deployments may produce independently tracked connections, and requests from outside this app are not observable. The limit is a **best-effort client-side safety margin**, not a Deriv-provided authoritative remaining-quota value or a guarantee against server rejection.
- Local unit tests: `npx jest src/services/__tests__/trading-request-budget.test.js --runInBand --coverage=false`. Tests use synthetic WebSocket frames and fake clocks. They do not replace live Deriv demo-account tests.

### Step 3: Bounded bulk purchase scheduler

- The operation queue lives in `src/pages/bulk-trader/bulk-execution.js`. It reserves a unique **0-based trade index** before each pacing delay and never schedules more than the quantity selected.
- Worker count is `min(5, quantity)`: selecting **2 trades starts at most 2 workers**, selecting **7 trades at most 5**, and selecting **50 trades at most 5**. Workers refill slots only after their own operation finishes; unrelated proposals/buys overlap.
- A minimum **500 ms gap applies between operation starts**; the shared trading request budget can impose additional delays. This does **not** guarantee a purchase every 500 ms or any trading result.
- While a batch runs, the Stop control shows the number of processed operations and currently in-flight operations. At completion, the feedback and Journal report elapsed time and **peak active operations** alongside confirmed, failed/unconfirmed and skipped counts.
- During the 500 ms pacing wait, Stop and account switches are checked at intervals no longer than 100 ms. Unexpected scheduler errors halt new reservations and are reported only after active workers have completed.
- Unit test command: `npx jest src/pages/bulk-trader/__tests__/bulk-execution.test.js --runInBand --coverage=false`. Test cases cover quantities **1, 2, 3, 5, 7, 10, 50**, pacing, delayed purchase confirmations, Stop, and unexpected errors.
- **No Step 4 settlement or Step 5 error-handling redesign is included in this step.** Use the Deriv demo statement as the authoritative purchase count; mock scheduler tests cannot verify actual broker execution.

### Step 4: Contract status and settlement verification

- Deriv's official `proposal_open_contract` documentation states that `subscribe: 1` **without** `contract_id` returns updates for all open contracts. `APIBase.authorizeAndSubscribe()` already creates that stream; Bulk Trader listens to it and filters results to its recorded contract IDs instead of issuing another subscription per new purchase.
- A one-tick contract may **settle before its `buy` response is recorded**. Completed contract events received during an active batch are buffered by contract ID for up to 60 seconds (maximum 100 entries). When the matching buy confirmation is recorded, its buffered final status is immediately merged.
- A contract becomes **won/lost only if Deriv reports closure AND a finite profit value**. String-valued profit is parsed as a number; invalid or absent profit is never treated as zero, and a stale `open` event cannot undo a verified settlement. No predictions or historical tick percentages are used to calculate fabricated wins/losses.
- **Realized payout:** Deriv's contract `payout` can mean a potential winning payout rather than money actually returned. The Bulk Trader Summary and detailed reports therefore calculate realized return for a verified settled option as the confirmed buy price plus Deriv's realized profit (floored at zero). For example, a 0.50 stake with -0.50 profit returns 0.00 even if a prospective payout of 1.85 appeared earlier. Old locally cached rows are corrected at display time. Deriv's account statement remains authoritative.
- Live updates normally require **zero extra per-contract status requests**. For a newly confirmed contract that remains open locally after the configured grace period, the app requests a targeted `proposal_open_contract` snapshot, then one delayed retry only if still open. These recovery requests pass the Step 2 API budget and are never additional `buy` requests.
- **Connection recovery:** every 1.5 seconds the monitoring effect checks whether the authenticated WebSocket has changed, reattaches its listener after reconnection, and checks **only up to 50 saved contracts still marked open**. Completed records are not polled. Old-account or disconnected-socket replies cannot update current-account settlement.
- Local unit test: `npx jest src/pages/bulk-trader/__tests__/bulk-contract-monitor.test.js --runInBand --coverage=false`. It covers early settlement, stale/out-of-order events, incomplete profits, cross-contract ID protection, and event buffer expiry.
- Scope: This is **code-complete but not verified with live Deriv demo contracts**. When statuses cannot be confirmed, the app intentionally leaves them open/unresolved; Deriv's transaction statement is authoritative.

### Step 5: Uncertain-buy safety and connection/error handling

- Every Deriv WebSocket request is correlated by `req_id`. The request timeout starts on actual dispatch, not while waiting for the Step 2 request budget. Closing the WebSocket immediately ends the outstanding wait and releases its listener; the request's error includes whether `api.send` was already attempted.
- **Failed** means Deriv explicitly rejected a buy with the matching `req_id`, or that the proposal/local dispatch failed with no confirmed purchase. **Skipped** means Stop/account switch cancelled the queued request *before* dispatch. **Unconfirmed** means a buy might have been submitted but no authoritative buy receipt arrived (timeout, disconnection, send promise rejection, or malformed/missing `buy.contract_id`).
- An **unconfirmed buy immediately stops new purchases**, but any requests already dispatched can still execute. The Journal and completion message show unconfirmed separately from failed; they instruct the operator to check Deriv's statement. There is **no automatic retry** and a new batch is blocked while a locally recorded unconfirmed row remains (only clear the local report after reconciling with Deriv).
- After **two request errors in one batch**, even if other concurrent buys succeed between them, stop starts of future operations. This avoids timing-dependent error streaks when up to five workers overlap.
- A module-level per-account run guard prevents a second batch while one batch is outstanding across Bulk Trader component remounts **within the same loaded browser page**. It does **not** coordinate separate browser tabs, devices, browser restarts, or deployments.
- **Critical dispatch fix:** Step 2's budget gate previously held a shared send mutex while awaiting the API's response promise; that could unintentionally serialize all five workers. The gate now releases immediately after dispatch. Individual `req_id` confirmations remain independently awaited by the caller.
- Testable request adapter: `src/pages/bulk-trader/bulk-api-request.js` owns `req_id` correlation, send timing, socket-close cleanup, queued cancellation, and error tagging; `bulk-trader.jsx` provides IDs from its existing shared sequence.
- Local test commands: `npx jest src/pages/bulk-trader/__tests__/bulk-api-request.test.js src/pages/bulk-trader/__tests__/bulk-request-safety.test.js src/services/__tests__/trading-request-budget.test.js --runInBand --coverage=false`. Simulated tests exercise out-of-order acknowledgements, rejected and unconfirmed buys, stops, disconnected sockets, timeouts, and independent request dispatch; they **do not prove real Deriv purchases are safe**.
- **Risk limitation:** A browser-side guard cannot fully prevent purchases duplicated by a manual retrade from a different tab/device after an uncertain response. Always reconcile unconfirmed purchases against Deriv's account statement before trying again.

**Step 6 automated verification is complete** (58/58 Jest tests and a successful production build in GitHub Actions). Actual Deriv demo-account trading and statement reconciliation remain unverified because no authenticated test account is available to the CI runner. Five concurrent operations, 500 ms start pacing and demo-only mode remain unchanged.

### Step 6: Automated integration and performance verification (11 November 2026)

**Verified on `develop` in GitHub Actions:** [Bulk Trader verification, successful run](https://github.com/Oswxld/trading-bot-template/actions/runs/42955657620). GitHub's Node.js 22 job passed **6 test suites / 58 tests** and produced the production `dist/` build; Rsbuild reported a **7.29-second CI compilation**. An ephemeral build artifact was uploaded to the workflow run.

- The new `bulk-trader-integration.test.js` composes the real 500 ms scheduler, rate-limit gate, `req_id`-correlated proposal/buy handling, error classification, and verified contract-settlement buffer against a **fully mocked Deriv WebSocket**. In the synthetic seven-trade scenario, proposal starts occur at 0, 500, 1,000, 1,500, 2,000, 2,500 and 3,000 ms. Confirmed buys, early settlements, win/loss reporting, realized payouts, and request counts are asserted.
- The synthetic 50-trade stress case checks that **exactly 50 proposals and 50 buys** are submitted, never more than five concurrent operations. It uses **0 ms artificial spacing solely to exercise the quantity cap quickly**; the real app's 500 ms setting is unchanged.
- Failure cases simulate lost buy acknowledgement/socket disconnection, Stop during a run, and out-of-order confirmations. No automatic duplicate buy is allowed after an uncertain response.
- The synthetic seven-trade pacing comparison gives **3.00 seconds between first and last start at 500 ms**, versus **5.10 seconds at 850 ms** (a 41.2% reduction in the start window). This is **not** a measurement of actual Deriv API latency, purchase confirmations, settlement speed, or strategy profitability.
- **Important dependency issue:** The repository's existing `package-lock.json` is currently out of sync with `package.json`. `npm ci` failed on the first CI attempt; the workflow temporarily uses `npm install --legacy-peer-deps` to run tests and build. Regenerating and reviewing the lockfile is a separate reproducibility task.
- **Not yet verified:** real Deriv demo-account purchases and actual broker request/response latency, account statement reconciliation, multi-browser-session request coordination, or real-account safety. These require a valid authenticated Deriv demo connection and should not be inferred from mocked tests. **Remain demo-only; do not enable real-money trading.**

The `Bulk Trader verification` GitHub Actions workflow automatically reruns the targeted tests and build after relevant commits to `develop`; no manual test execution is needed for those code paths.

## Run on your own laptop

If you have local work, first `git stash push -u -m "before bulk trader layout"`; then `git switch develop`, `git pull origin develop`, and `git stash pop` (resolve any conflicts).

Run `npm run build`, then `npm start`; open `https://localhost:8443/#bulk_trader`.

1. Verify the **same** main bar has Dashboard / Bot Builder / Charts / Bulk Trader / Tutorials and the older extra app-header Bulk link is gone.
2. Choose **Volatility 100 Index**, **Matches/Differs**, sample 1000, prediction 5, duration 1 tick, stake permitted by Deriv, and **one trade**.
3. Verify tick quote and history-derived distribution, then **click the right-side chevron** to open Summary / Transactions / Journal.
4. Switch to a confirmed demo account. Place one demo trade only; confirm it against Deriv's actual demo account statement. Check that closed P/L is reported correctly, not merely the buy acknowledgement.
5. **Then test quantities 2, 5, 7 and 10** on a demo account, confirming the run never has more than min(5, quantity) operations in flight and never sends more than the selected total. Test Stop and account switching during the run; check every confirmed and uncertain purchase against Deriv's statement.
6. Click Transactions → View Detail and verify the full draggable report; test CSV Download and Reset.
7. Test invalid stake/history, unsupported Step trade type, account switching, Stop, logout, WebSocket loss, and changing away from the Bulk tab mid-run before considering public use.
8. If you can reproduce a build or API error, provide the terminal/Console error **without API keys, OAuth codes, access tokens, or other credentials**.

**Step 1 audit:** Fixed double-counted rate-limit rejections, cross-account attribution of late confirmations, and incorrectly labeled cancelled purchase requests. **Step 2:** Strengthened per-page shared WebSocket metering, rolling soft quotas and backoff, and reduced start spacing to 500 ms. **Step 3:** Extracted and tested a quantity-bounded purchase operation scheduler, preserving five-slot concurrency and 500 ms start pacing while adding elapsed-time and peak-concurrency feedback. **Step 4:** Reused the app's existing settlement stream, buffered verified early close events, and reattached monitoring after WebSocket changes with targeted fallback checks. **Step 5:** Distinguished unconfirmed buys from rejected/skipped requests, added request-close handling and an in-page run guard, and corrected dispatch locking. **Step 6:** Six Bulk Trader-focused test suites (58 tests) and a production Rsbuild bundle passed on Node 22 in GitHub Actions; live authenticated Deriv demo execution remains unverified.

**Not yet validated:** production build on your laptop, OAuth login / API against your account, live tick/history behavior, accurate settlement stats, menu responsiveness and Deriv contract availability. This work stays on `develop` until tested. Do NOT deploy it for real-money trading as-is.

Official Deriv API docs:
- https://developers.deriv.com/docs/data/active-symbols/
- https://developers.deriv.com/docs/data/contracts-for/
- https://developers.deriv.com/docs/data/ticks-history/
- https://developers.deriv.com/docs/trading/proposal/
- https://developers.deriv.com/docs/trading/buy/
- https://developers.deriv.com/docs/trading/proposal-open-contract/
- https://developers.deriv.com/docs/trading/bulk-purchase/

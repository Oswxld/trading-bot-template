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

Remaining stages: verify end-to-end execution behavior, correctness of settlement updates, and actual throughput before enabling real-money trading. The 500 ms setting remains demo-only.

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

**Step 1 audit:** Fixed double-counted rate-limit rejections, cross-account attribution of late confirmations, and incorrectly labeled cancelled purchase requests. **Step 2:** Strengthened per-page shared WebSocket metering, rolling soft quotas and backoff, and reduced start spacing to 500 ms. The test suite has not yet been run against the app on your machine; further execution and settlement verification remains pending.

**Not yet validated:** production build on your laptop, OAuth login / API against your account, live tick/history behavior, accurate settlement stats, menu responsiveness and Deriv contract availability. This work stays on `develop` until tested. Do NOT deploy it for real-money trading as-is.

Official Deriv API docs:
- https://developers.deriv.com/docs/data/active-symbols/
- https://developers.deriv.com/docs/data/contracts-for/
- https://developers.deriv.com/docs/data/ticks-history/
- https://developers.deriv.com/docs/trading/proposal/
- https://developers.deriv.com/docs/trading/buy/
- https://developers.deriv.com/docs/trading/proposal-open-contract/
- https://developers.deriv.com/docs/trading/bulk-purchase/

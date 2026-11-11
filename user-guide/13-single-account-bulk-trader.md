# Same-account Bulk Trader: Deriv-style UI, reports and demo verification

The Bulk Trader is **a new tab beside Charts** on the existing blue main navigation bar, not a separate top-header link or a second app. Open `https://localhost:8443/#bulk_trader`. The old `/bulk-trader` URL redirects to that tab.

## UI based on supplied reference screenshots

- Market / Trade Type at the top, Number of Ticks (history sample) and Prediction underneath.
- Market dropdown is populated from **Deriv live active_symbols**. It includes available Volatility and Step indices (up to Step Index 100 if Deriv lists that symbol for the connected market/account). There is a short Volatility fallback while the list loads; do not invent Step symbol codes.
- Deriv `ticks_history` (default 1,000 ticks) with live tick updates for current tick quote, last-digit (0–9) percentages, and 8 recent digit outcomes.
- Ticks duration, Stake per contract, Number of trades and a calculated Total Stake.
- Two large actions corresponding to the selected Trade Type: Differs/Matches, Under/Over, Even/Odd, or Fall/Rise. Contract types not offered by Deriv for the market are disabled when `contracts_for` data is available.
- The global **Run Bot** button and Bot Builder's RunPanel are **not rendered while Bulk Trader is selected**; Bulk Trader's own action buttons control its independent order loop. This prevents the misleading cross-tab Run Bot action. It does not stop a Bot Builder strategy that was already running before tab switching; the Bulk Trader's existing checks reject new bulk orders when the shared API marks the bot as running.
- On the right, the **existing Deriv Drawer, Tabs and StatisticsSummary UI components** provide a collapsible panel with **Summary / Transactions / Journal**, six stats, Reset, Download and View Detail. On desktop it opens by default, is widened to 420px, and reserves space so it does not cover Bulk Trader's controls. The prominent **View Summary / Transactions / Journal** / **Hide reports** button opens or closes it; the original arrow still works. On smaller screens it starts closed.
- View Detail uses the **existing draggable, resizable Deriv detailed-transactions wrapper** and displays trade records plus account/run/stake/payout/win/loss/P&L/balance summaries.
- Results, journal, and stats are **bulk-trader-specific**, stored by authenticated account in browser session storage. Reset only erases this local report; Deriv's account statement remains authoritative.
- Profit/loss and payouts are reported only when Deriv's contract-status response confirms settlement. No placeholder winnings or fabricated balances.

## Implementation and safety

This is NOT Deriv's REST Bulk Purchase for multiple different accounts. For each single-account demo order:

1. Confirm account and WebSocket connection match the selected **demo** login ID. No real-money trading is enabled.
2. Check user configuration: 1–50 trades, stake > 0 and <= 100 per trade, duration 1–10 ticks, history window 10–5,000.
3. Get a streaming `proposal` with `subscribe:1`, `underlying_symbol`, a unique `req_id`, and prediction barrier when needed.
4. Verify quoted price is no higher than the configured stake; only then submit the separate `buy`. Never automatically retry a buy whose response was lost.
5. Record confirmed contract ID and purchase price. Listen to `proposal_open_contract` and request contract-status snapshots for confirmed buys to update settled profit/loss.
6. Keep purchases sequential and paced; stop on ambiguous acknowledgements or repeated failures. Stop prevents *future* purchases, not already submitted orders.
7. Don't simultaneously run the existing automated Deriv bot on the same account.

## Run on your own laptop

If you have local work, first `git stash push -u -m "before bulk trader layout"`; then `git switch develop`, `git pull origin develop`, and `git stash pop` (resolve any conflicts).

Run `npm run build`, then `npm start`; open `https://localhost:8443/#bulk_trader`.

1. Verify the **same** main bar has Dashboard / Bot Builder / Charts / Bulk Trader / Tutorials and the older extra app-header Bulk link is gone.
2. Choose **Volatility 100 Index**, **Matches/Differs**, sample 1000, prediction 5, duration 1 tick, stake permitted by Deriv, and **one trade**.
3. Verify tick quote and history-derived distribution, then **click the right-side chevron** to open Summary / Transactions / Journal.
4. Switch to a confirmed demo account. Place one demo trade only; confirm it against Deriv's actual demo account statement. Check that closed P/L is reported correctly, not merely the buy acknowledgement.
5. Click Transactions → View Detail and verify the full draggable report; test CSV Download and Reset.
6. Test invalid stake/history, unsupported Step trade type, account switching, Stop, logout, WebSocket loss, and changing away from the Bulk tab mid-run before considering public use.
7. If you can reproduce a build or API error, provide the terminal/Console error **without API keys, OAuth codes, access tokens, or other credentials**.

**Not yet validated:** production build on your laptop, OAuth login / API against your account, live tick/history behavior, accurate settlement stats, menu responsiveness and Deriv contract availability. This work stays on `develop` until tested. Do NOT deploy it for real-money trading as-is.

Official Deriv API docs:
- https://developers.deriv.com/docs/data/active-symbols/
- https://developers.deriv.com/docs/data/contracts-for/
- https://developers.deriv.com/docs/data/ticks-history/
- https://developers.deriv.com/docs/trading/proposal/
- https://developers.deriv.com/docs/trading/buy/
- https://developers.deriv.com/docs/trading/proposal-open-contract/
- https://developers.deriv.com/docs/trading/bulk-purchase/

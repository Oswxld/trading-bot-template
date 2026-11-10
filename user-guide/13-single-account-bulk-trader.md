# Single-account Bulk Trader — demo implementation

The bulk trader is at `/bulk-trader` on the `develop` branch, with navigation added to the desktop header and mobile menu.

## Scope

This is the *single-account* bulk trader requested for the white-label website. It creates **multiple separate contracts on the same logged-in Deriv account**, not the REST Bulk Purchase API for 2–100 different accounts.

The initial implementation is deliberately restricted to **DEMO accounts only** until validated end to end; do not remove the demo guard as a shortcut to production.

Available fields:
- Volatility markets: 10/25/50/75/100 regular and 1s variants.
- Digit Differs, Matches, Over, Under, Even, Odd.
- Last-digit prediction for applicable contract types.
- Stake per trade, 1–50 separate purchases, duration 1 tick.
- Expected total stake before an additional confirmation, Stop button, per-purchase acknowledgements, and total confirmed purchase cost.

## How it works

1. The active Deriv account is taken from the existing OAuth/OTP-backed bot connection; no extra tokens, API keys or credentials are introduced.
2. The page requires the active account's `account_type` to be `demo`, and checks that the socket and account match.
3. After deliberate confirmation, each trade requests a **streaming** `proposal` using `subscribe:1`, `underlying_symbol` and a unique `req_id`.
4. It submits `buy` for that proposal ID with a price no higher than the user's configured stake, records only the acknowledged contract ID and purchase price, and sends `forget` for the proposal subscription.
5. Requests are paced and serial. Failures are shown per order. A timeout/ambiguous buy acknowledgement **stops the run**; never automatically retry an ambiguous buy.
6. Stop prevents the next purchase, but cannot undo a submitted contract. If the active account changes, the WebSocket changes/disconnects, or the existing bot starts trading, no further bulk purchases should start.
7. The results are purchase acknowledgements, **not live win/loss or settled P&L**.

## Local setup and testing

1. On `develop`, pull the latest changes and ensure `.env` has your working `CLIENT_ID`.
2. Run `npm run build`. The original Deriv template has separate legacy TypeScript errors; do not conflate these with the build command.
3. Run `npm start`, sign in to **a demo account**, and open `https://localhost:8443/bulk-trader`.
4. Make the smallest possible test, e.g. one Digit Differs trade at the permitted market minimum; read the pre-trade total and confirm.
5. Check the trade was purchased in the Deriv demo statement and is associated with the same account. If the purchase response is missing, do not immediately run again.
6. Test Stop during a multi-order run, low balance, invalid prediction, unsupported market/type, logout, account switching and socket drop.
7. Only after passing the browser build, demo trading, UX/accessibility, and account isolation tests should we consider a separately controlled, clearly disclosed real-account trading rollout. This demo implementation has **not** been end-to-end tested or deployed.

## API references

- https://developers.deriv.com/docs/trading/proposal/
- https://developers.deriv.com/docs/trading/buy/
- https://developers.deriv.com/comparison/proposal/
- https://developers.deriv.com/docs/limits/
- https://developers.deriv.com/docs/trading/bulk-purchase/

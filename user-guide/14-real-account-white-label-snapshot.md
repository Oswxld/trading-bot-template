# White-label snapshot: Bulk Trader real-account release gates

## Scope
Baseline branch `develop` adds real-account support to the existing one-account
Bulk Trader and retains Bot Builder. It does not use Deriv's separate REST
multi-account bulk purchase API.

## Practice and real accounts
- Only account IDs and explicit types returned through the authenticated
  Deriv account list can initiate a batch. Unknown accounts fail closed.
- Real-account orders use the already selected and authenticated Deriv
  WebSocket connection. They are sent only after the user's confirmation.
- Before every real-money batch, request the fresh `balance: 1` broker value
  on the active WebSocket and verify its currency and any returned login ID.
- Real account caps: maximum 20 contracts, 2 concurrent operations, stake
  10 account-currency units per contract, 100 units per batch and 10% of
  the freshly checked account balance (whichever is stricter).
- The user confirms the exact count/stake/account, then must explicitly
  type `REAL <account-id>`. Simply selecting a real account does not trade.

## Existing protections
- Pacing of bulk proposal/buy operations, shared soft request budgets,
  rate-limit backoff and the five-operation practice maximum are retained.
- An unconfirmed buy may have executed; never automatically retry it.
  Operators must reconcile against the Deriv statement before clearing
  unresolved records or starting another batch.
- An account switch, socket disconnect, Stop or navigation away prevents
  new operations, but may not cancel orders already submitted.
- P/L and realized payout are derived from confirmed Deriv contract updates.
- Bulk runs are guarded within one loaded browser page only. Separate tabs,
  browsers/devices and deployments are **not** coordinated, so simultaneous
  operations on the same account remain a residual financial risk.

## Validation required before a production client release
1. Run `npm run build` and the Bulk Trader Jest suites.
2. In a practice account, run 1, 2, 5, 7 and 10 trades; reconcile order counts,
   execution pacing and settlement/P&L against the Deriv account statement.
3. Exercise disconnected sockets, account switching, missing balance, currency
   mismatches, unsupported symbols, unsettled purchases and Stop mid-run.
4. Without submitting real trades, verify real-account identification,
   broker balance checks and all limits/confirmation flows.
5. A responsible account holder must separately approve any smallest-permitted
   real-account integration check. Confirm the broker statement and inspect
   buy/settlement reports. No real trades were carried out by this change.
6. Verify partner app OAuth/permission scopes, availability of contract types,
   regulatory/terms requirements and client API markup prior to launch.

**Status:** code completed pending external authenticated practice and
real-account broker validation. Any snapshot created at this stage is a
**source-code baseline**, not a certification of safe real-money execution.

# Ready-made bot library

These six XML strategies are bundled for the Trading Bots tab. They use the existing Deriv Blockly engine and import via the repository's standard `load` function. Clicking a bot only imports it; it does **not** start trading.

| File | Entry conditions |
| --- | --- |
| rsi-direction.xml | RSI(14) >= 70 → Fall; <= 30 → Rise |
| moving-average.xml | SMA(10) > SMA(21) → Rise; lower → Fall |
| bollinger-bands.xml | Close above upper BB → Fall; below lower BB → Rise |
| macd-momentum.xml | MACD histogram > 0 → Rise; below 0 → Fall |
| digit-differs.xml | Digit Differs versus predicted digit 5 |
| digit-over-under.xml | Last digit >= 5 → Under 5; otherwise Over 5 |

Defaults: Volatility 100, 0.35 USD stake per trade, 5 ticks (1 tick on digit contracts), maximum 20 completed trades, stop scheduling subsequent trades at session P/L <= -3 USD or >= +5 USD. These are after-settlement rules: losses can exceed the threshold before another trade is prevented. Actual minimum stake/duration/available contract types depend on the market and user's account. All six have fixed stakes and no martingale.

These strategies demonstrate automation; they do **not** provide a verified statistical trading advantage or guaranteed profitability. Check import compatibility, contract availability and run/stop behavior on a Deriv demo account before enabling real trading. The Digit Over/Under last-digit selection is an example of conditional automation, not a predictive signal.

The XML source is generated in this repo from built-in Blockly primitives; no premium bot packages or unlicensed external XML are redistributed.

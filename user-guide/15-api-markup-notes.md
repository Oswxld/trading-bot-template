# API markup and Bulk Trader integration

Deriv registers an application's markup percentage on the **Deriv side**, not
in this repository's frontend. The application uses a configured OAuth client
ID (`process.env.CLIENT_ID`) and a Deriv-authenticated account WebSocket;
Bulk Trader sends `proposal`, then `buy` with Deriv's returned proposal ID
and asking price. Bulk Trader reports broker-confirmed buy prices and settled
profit and realized payout from the returned account/contract events. It does
not manually add a markup, and should **never invent a local 33% deduction**.

Deriv's official documentation states that API app markup is **up to 3%**,
not 33%. A 33% configured markup is outside the published limit.
See https://developers.deriv.com/docs/intro/markup/

**Verification needed:** the source repository alone does not demonstrate
what percentage is actually registered for a specific application's client
ID, or that a particular client trade is correctly attributed for markup.
Confirm the corresponding app's settings in Deriv's developer dashboard and
compare authenticated broker quotes, buy prices, settlement and markup
statistics. The `/applications/v1/markup-statistics` partner endpoint is
documented at:
https://developers.deriv.com/docs/partners/markup-statistics/

Do not fabricate markup on the frontend or assume a desired percentage is
enabled just because the code uses an API.

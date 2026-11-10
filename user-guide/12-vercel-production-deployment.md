# Production deployment on Vercel — one client website

This guide applies to the `develop` branch until tested and promoted to `clients-sites`. Do **not** launch real-money trading without testing, compliance and security review.

## What changed

- `api/oauth/token.ts`: a same-origin Vercel Function exchanges OAuth authorization codes with Deriv over HTTPS. The function validates origin, registered redirect URI and basic payload shape. It does not print or persist credentials.
- `src/services/oauth-token-exchange.service.ts`: deployed websites POST to `/api/oauth/token`. For local `https://localhost:8443` development only, the previous direct token exchange is preserved to avoid requiring a local serverless emulator.
- `vercel.json`: builds Rsbuild with `npm run build`, outputs `dist`. Vercel's file-based `api/` function is deployed alongside the static app.
- `isProduction()`: public websites (including `*.vercel.app`) use Deriv's production API. An explicitly listed staging hostname selects Deriv's staging infrastructure. **Production API does not mean trading with real funds**; account selection controls that.

## Configure the first deployment

1. Create a client branch from `clients-sites` **only once these changes pass tests**. Each client branch may be the Production Branch for a separate Vercel project.
2. For Vercel, use the existing GitHub repository and connect your client's intended branch as its Production Branch. Framework is **Other**, Build Command is `npm run build`, Output Directory is `dist` (also specified in `vercel.json`). Root Directory is the repository root.
3. Create an OAuth 2.0 application in the **developer account that will own the API app**. In Deriv's application dashboard, register the exact public callback URL, e.g. `https://client-one.example.com` **without a trailing slash**. Our app uses `window.location.origin` (the root URL), not `/callback`.
4. In **that Vercel project's environment settings**, set:
   - `CLIENT_ID=...`: the registered Deriv OAuth **App ID** for this deployment. This is referenced by both the built frontend and the serverless function.
   - `OAUTH_REDIRECT_URI=https://client-one.example.com`: **exact** root redirect URI registered at Deriv. Mandatory server-side; a different slash, hostname, or scheme will cause the function to reject the exchange.
   - `AFFILIATE_TOKEN=...`: the client's own trader signup referral tracking token, once verified with the Partners dashboard.
   - `AFFILIATE_TOKEN_PARAM=t`: use the actual alias (`t`, `affiliate_token`, `sidi`, or `ca`).
   - `AFFILIATE_ID` / `AFFILIATE_CAMPAIGN`: optional tracking values where Deriv supplies them. Verify commission attribution before launch.
5. Set Vercel variables for the **Production environment**. Set separate exact redirect URIs for preview/testing environments only when the corresponding URL is registered with Deriv. Environment variable changes require a redeploy.
6. Publish with an appropriate **commercial Vercel plan**. Hobby is for non-commercial personal use, not paid client websites.

## Pre-launch verification

1. Visit the public deployment domain. Confirm the bot loads and uses the expected Deriv API endpoint.
2. Test **Log In** in a browser with a Deriv **demo** account. Use Developer Tools → Network to confirm `POST /api/oauth/token` returns 200 and NOT a browser call to `auth.deriv.com/oauth2/token`. Do not share access tokens, authorization codes, code verifiers, or screenshots containing them.
3. Confirm a demo account appears with correct demo balance. Verify transactions/summary; avoid placing trades with real funds.
4. Test **Sign Up** and confirm only one affiliate tracking token parameter is sent. Confirm an eligible signup appears under the client's Deriv Partner reporting before promising commissions.
5. Verify a missing/mismatched `OAUTH_REDIRECT_URI` produces an error and never falls back to exchanging the code directly from the browser.
6. Run `npm run build` and `npm run type-check`, review `npm audit` findings, and test the deployed serverless function. Don't treat source-code review as a production build or end-to-end test.
7. Review the existing browser token/session storage design, content security policy, application scopes, dependency vulnerabilities, trade safety/disclosures, and Deriv developer/API markup terms before onboarding real-money traders. The Vercel function addresses **the location of the code exchange**, not all frontend security risks.

## Known limitations

- The current application still keeps access tokens in `sessionStorage` because its Deriv accounts/OTP workflow is browser-driven. The server-side token exchange makes the exchange comply with Deriv's backend requirement but does **not** replace that storage with an HttpOnly session.
- Deriv's current OAuth guide says third-party access tokens are renewed by re-running OAuth; refresh tokens are not issued. The existing legacy `refreshAccessToken` method should not be relied on in production.
- If the site is deployed outside Vercel, that host must provide an equivalent same-origin `POST /api/oauth/token` backend endpoint; a static-only deployment is insufficient for production login.
- The Vercel function currently does not implement application-level request throttling. Consider this and audit controls before a public rollout.

References:
- Deriv OAuth: https://developers.deriv.com/docs/intro/oauth/
- Vercel Functions: https://vercel.com/docs/functions
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel Hobby use limits: https://vercel.com/docs/limits/fair-use-guidelines

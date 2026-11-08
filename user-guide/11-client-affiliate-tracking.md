# Per-client affiliate signup configuration

The existing Deriv trading bot, Login button, OAuth PKCE and trading workflow remain unchanged. Only **Sign Up** can carry Deriv Partner attribution.

## Development setup

1. Work on the `develop` branch.
2. Copy `.env.example` to `.env` (your local `.env` remains ignored).
3. Set `CLIENT_ID` to an OAuth App ID registered at https://developers.deriv.com/dashboard/.
4. Once a client has a Deriv **trader referral** link, get **that client's** tracking token from their Partners dashboard. **Do not use your own Master Partner recruitment link** as the client's trader token.
5. Set the signup tracking variables:
    - `AFFILIATE_TOKEN`: client's trader referral token, e.g. `ABC123` from `?t=ABC123`.
    - `AFFILIATE_TOKEN_PARAM`: the one alias used by the referral link: `t` (default), `affiliate_token`, `sidi`, or `ca`.
    - `AFFILIATE_ID`: client's partner/affiliate ID used in `utm_source`, when supplied by the Partners dashboard.
    - `AFFILIATE_CAMPAIGN`: client's campaign label used in `utm_campaign`.
6. Restart `npm start` after editing `.env`.

## Test checklist

- **Log in** should send the usual OAuth URL, with no affiliate attribution fields.
- **Sign up** should redirect to Deriv with `prompt=registration`, one tracking token parameter, `utm_medium=affiliate`, and configured `utm_source` and `utm_campaign`.
- In the browser's Network view, inspect only the outgoing URL's **parameter names**, not authorization codes/tokens. Test with a controlled new account and verify the referral in the client's Partner dashboard after approval.
- If `AFFILIATE_TOKEN` is unset, signup still works normally but **attribution is not configured** and a console warning is emitted.
- If a tracking token is set but the affiliate ID or campaign is missing, a warning is emitted; confirm correct attribution with Deriv Partner Support before launch.

## For production and each new client branch

- Create a client branch from the stable `clients-sites` baseline **after** promoting tested changes from `develop`.
- Set each deployment's environment variables in its own hosting project; never commit client-specific `.env` files.
- Set `brand.config.json` hostnames to the actual production site and register the exact OAuth redirect URL with Deriv. The current `isProduction()` check only recognizes listed production domains plus localhost.
- Review and migrate the existing browser-side OAuth **token exchange** to an appropriate backend/token-handling architecture before public launch. Deriv's official OAuth docs require the exchange server-side.
- Do not claim referral attribution or API markup is active until the specific client signup test and Deriv dashboard confirm it.

Official documentation: https://developers.deriv.com/docs/intro/oauth/

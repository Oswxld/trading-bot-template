# Apex wealth — client deployment notes

- Source branch: `client/precioustraders` (all trading features inherited)
- Client branch: `client/apex-wealth`
- Header: the AW trading emblem cropped from the client's uploaded design, with "Apex wealth" beside it.
- Browser title, favicon, and social preview metadata: Apex wealth.

## Configuration required before deploying

This branch intentionally does **not** reuse Precious Traders' domain, OAuth client ID or affiliate token.

Configure a separate Vercel project using production branch `client/apex-wealth`, build command `npm run build`, output directory `dist`.

Set these environment variables for the new client, using the details from the Apex wealth owner:

```dotenv
CLIENT_ID=<APEX_DERIV_OAUTH_APP_ID>
AFFILIATE_TOKEN=<APEX_DERIV_AFFILIATE_TOKEN>
AFFILIATE_TOKEN_PARAM=t
OAUTH_REDIRECT_URI=https://<APEX_SITE_DOMAIN>
```

Register the **exact** `OAUTH_REDIRECT_URI` in the corresponding Deriv developers application. Login should use OAuth; signup may carry affiliate tracking. Never use another client's redirect URI or partner token.

When the Apex wealth domain is known, update `brand.config.json` with its hostname values. Brand and code changes in this branch do not deploy it automatically.

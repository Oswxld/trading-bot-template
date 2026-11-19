# Apex wealth — deployment configuration

This client branch `client/apex-wealth` is based on `client/precioustraders`, retaining its trading functionality. Only logo and brand/domain identity differ.

- Production domain: `https://apexwealth.site`
- Deriv OAuth client ID: `350iopNCqSoktVVFzRMvv`
- Trader sign-up affiliate token: `GHY7QFQBHHFN` (query parameter `t`)

## Vercel

Set production branch to `client/apex-wealth`, build command `npm run build`, output directory `dist`, Node.js 22.x.

```dotenv
CLIENT_ID=350iopNCqSoktVVFzRMvv
AFFILIATE_TOKEN=GHY7QFQBHHFN
AFFILIATE_TOKEN_PARAM=t
OAUTH_REDIRECT_URI=https://apexwealth.site
```

Register `https://apexwealth.site` as an **exact** redirect URI for this Deriv OAuth app. For local development, retain the corresponding local callback in the Deriv portal. Affiliate tracking applies only to Deriv **Sign Up**, not to OAuth **Login**.

If the DNS settings for `apexwealth.site` do not point to Vercel, the project can build successfully but the domain will not serve it until DNS is configured.

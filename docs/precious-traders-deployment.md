# Precious Traders — deployment parameters

This branch was created from `clients/kevin-forex-trader/develop`, preserving its trading, builder, analysis, OAuth, and admin features.

- Branch: `client/precioustraders`
- Production domain: `https://precioustraders.site`
- Public-facing brand name: `Precious Traders`
- Source: the client's provided monochrome candlestick logo; the navigation icon is a cropped emblem from that image, with the brand name alongside it.
- Deriv OAuth application client ID: `350dQftktv2cnX2HcKIlp`
- Deriv trader signup affiliate token: `E279ZRNUG2KP`

## Vercel environment values (configure when deploying)

```dotenv
CLIENT_ID=350dQftktv2cnX2HcKIlp
AFFILIATE_TOKEN=E279ZRNUG2KP
AFFILIATE_TOKEN_PARAM=t
OAUTH_REDIRECT_URI=https://precioustraders.site
```

Register the **exact same redirect URI** in the Deriv Developers application settings before testing OAuth login. Configure the production branch and domain in Vercel separately; nothing in this branch creation deploys it automatically.

The affiliate token belongs only on the Deriv **Sign Up** URL; OAuth **Login** must use the client's OAuth application ID without a referral parameter.

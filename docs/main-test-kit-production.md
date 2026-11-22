# MAIN TEST KIT — production testing from master

The connected Vercel project `main-test-kit` deploys the GitHub
`Oswxld/trading-bot-template` `master` branch as the integration testing
environment. Changes are tested here before propagation to individual client
branches.

Project build settings:
- Node.js 22
- Install: `npm install --no-audit --no-fund --legacy-peer-deps`
- Build: `npm run build`
- Output directory: `dist`

Configure public trading properties in Vercel Environment Variables:
- `CLIENT_ID`: Deriv third-party OAuth application ID (site-specific).
- `AFFILIATE_TOKEN`: Deriv Revenue Share trader-referral token.
- `AFFILIATE_TOKEN_PARAM`: `t`.
- `OAUTH_REDIRECT_URI`: exact HTTPS production **origin**, no trailing slash
  and no extra callback path. Register this exact URI in Deriv Developers.
- `PUBLIC_SIM_CLIENT_ID`: stable UUID unique to this project.

**Manual action required** before using the private admin login:
- `PUBLIC_SUPABASE_URL`: Dwellio Supabase URL.
- `PUBLIC_SUPABASE_ANON_KEY`: publishable/anon key (never service-role).

Environment values are not stored in the repository. Rsbuild embeds the
public settings during a build, so redeploy master after changing them.

Admin login: `/secret-admin`. Supabase email/password or email OTP (with
email delivery configured). The Admin Test Kit is separate from Deriv OAuth.
The simulated Real and Demo balances read and update the user's corresponding
`optionsUsd` wallets using existing Dwellio authenticated RPC functions.

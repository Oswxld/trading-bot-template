/**
 * Deriv OAuth authorization-code exchange (Vercel Node.js Function).
 *
 * Only POST from the configured website is accepted. This endpoint talks to
 * Deriv's token endpoint server-side, never storing or logging authorization
 * codes, PKCE verifiers, or OAuth access tokens.
 *
 * Required Vercel environment variables:
 *   CLIENT_ID          - OAuth application ID for this client deployment
 *   OAUTH_REDIRECT_URI - Exact registered URI, e.g. https://client.example.com
 */
const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };

const respond = (data, status) =>
    new Response(JSON.stringify(data), { status, headers: noStore });

const isNonEmpty = (value, maxLength) =>
    typeof value === 'string' && value.length > 0 && value.length <= maxLength;

export default {
    async fetch(request) {
        if (request.method !== 'POST') {
            return respond({ error: 'method_not_allowed' }, 405);
        }

        const clientId = process.env.CLIENT_ID?.trim();
        const redirectUri = process.env.OAUTH_REDIRECT_URI?.trim();
        if (!clientId || !redirectUri) {
            return respond({ error: 'not_configured', error_description: 'OAuth deployment settings are missing.' }, 503);
        }

        let expectedOrigin;
        try {
            const redirect = new URL(redirectUri);
            if (redirect.protocol !== 'https:' || redirect.pathname !== '/' || redirect.search || redirect.hash) {
                return respond({ error: 'not_configured', error_description: 'Invalid configured redirect URI.' }, 503);
            }
            expectedOrigin = redirect.origin;
        } catch {
            return respond({ error: 'not_configured', error_description: 'Invalid configured redirect URI.' }, 503);
        }

        // Prevent another site from using this deployment as an arbitrary OAuth proxy.
        const requestOrigin = request.headers.get('origin');
        // Apex Wealth currently serves its UI on www due to an existing Vercel
        // domain redirect, although Deriv is registered with the apex URI.
        // Allow only these two exact origins; the *OAuth redirect_uri* stays apex.
        const isApprovedApexWwwOrigin =
            expectedOrigin === 'https://apexwealth.site' && requestOrigin === 'https://www.apexwealth.site';
        if (!requestOrigin || (requestOrigin !== expectedOrigin && !isApprovedApexWwwOrigin)) {
            return respond({ error: 'forbidden_origin' }, 403);
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
            return respond({ error: 'invalid_request' }, 415);
        }

        try {
            // An OAuth code and verifier are short: reject larger payloads.
            const raw = await request.text();
            if (raw.length > 4096) return respond({ error: 'invalid_request' }, 413);
            const body = JSON.parse(raw);
            if (!body || typeof body !== 'object') return respond({ error: 'invalid_request' }, 400);

            const payload = body;
            const { code, code_verifier: verifier, redirect_uri: suppliedRedirect } = payload;
            if (
                !isNonEmpty(code, 2048) ||
                !isNonEmpty(verifier, 128) ||
                typeof verifier !== 'string' ||
                verifier.length < 43 ||
                suppliedRedirect !== redirectUri
            ) {
                return respond({ error: 'invalid_request', error_description: 'Invalid OAuth code, verifier or redirect URI.' }, 400);
            }

            const form = new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                redirect_uri: redirectUri,
                code,
                code_verifier: verifier,
            });
            const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
                signal: AbortSignal.timeout(15000),
            });

            const data = await upstream.json();
            if (!data || typeof data !== 'object') {
                return respond({ error: 'invalid_response' }, 502);
            }

            const result = data;
            if (!upstream.ok || typeof result.access_token !== 'string') {
                return respond({
                    error: typeof result.error === 'string' ? result.error : 'token_exchange_failed',
                    error_description: typeof result.error_description === 'string'
                        ? result.error_description : 'Deriv rejected the authorization code.',
                }, 400);
            }

            // Owner-linked sign-in is restricted to the isolated test deployment.
            // The account list is fetched server-side using this newly exchanged OAuth token.
            // Never accept a claimed account ID from the browser.
            const ownerId = process.env.AUTO_ADMIN_DERIV_ACCOUNT_ID?.trim();
            if (expectedOrigin === 'https://oswaldtest.vercel.app' && ownerId) {
                try {
                    const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                        headers: { Authorization: `Bearer ${result.access_token}` },
                        signal: AbortSignal.timeout(10000),
                    });
                    const accountData = await accountsResponse.json();
                    if (!accountsResponse.ok || !Array.isArray(accountData?.data)) {
                        return respond({ error: 'owner_verification_failed' }, 502);
                    }
                    const owner = accountData.data.find(account =>
                        account?.account_id === ownerId && account?.account_type === 'real'
                    );
                    if (owner) {
                        const email = process.env.ADMIN_SUPABASE_EMAIL?.trim();
                        const password = process.env.ADMIN_SUPABASE_PASSWORD;
                        const url = process.env.PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '');
                        const key = process.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
                        if (!email || !password || !url || !/^https:\/\/[a-z0-9.-]+$/i.test(url) || !key) {
                            return respond({ error: 'owner_simulation_not_configured' }, 503);
                        }
                        const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
                            method: 'POST',
                            headers: { apikey: key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, password }),
                            signal: AbortSignal.timeout(10000),
                        });
                        const session = await authResponse.json();
                        if (!authResponse.ok || typeof session?.access_token !== 'string' ||
                            typeof session?.refresh_token !== 'string') {
                            return respond({ error: 'owner_simulation_auth_failed' }, 403);
                        }
                        // No live Deriv access token is delivered for this test-only session.
                        // Return only the session necessary for the existing authenticated paper-wallet RPCs.
                        return respond({
                            admin_auto_simulation: true,
                            admin_session: {
                                access_token: session.access_token,
                                refresh_token: session.refresh_token,
                                expires_in: session.expires_in,
                            },
                        }, 200);
                    }
                } catch {
                    return respond({ error: 'owner_verification_failed' }, 502);
                }
            }

            // This app currently needs the token in the browser for Deriv WebSocket
            // account/OTP initialization. A later BFF design can use HttpOnly sessions.
            return respond({
                access_token: result.access_token,
                token_type: typeof result.token_type === 'string' ? result.token_type : 'Bearer',
                expires_in: typeof result.expires_in === 'number' ? result.expires_in : 3600,
                scope: typeof result.scope === 'string' ? result.scope : undefined,
            }, 200);
        } catch {
            // Never return raw upstream request details or credentials to the browser.
            return respond({ error: 'network_error', error_description: 'OAuth token exchange could not be completed.' }, 502);
        }
    },
};

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

const respond = (data: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(data), { status, headers: noStore });

const isNonEmpty = (value: unknown, maxLength: number) =>
    typeof value === 'string' && value.length > 0 && value.length <= maxLength;

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return respond({ error: 'method_not_allowed' }, 405);
        }

        const clientId = process.env.CLIENT_ID?.trim();
        const redirectUri = process.env.OAUTH_REDIRECT_URI?.trim();
        if (!clientId || !redirectUri) {
            return respond({ error: 'not_configured', error_description: 'OAuth deployment settings are missing.' }, 503);
        }

        let expectedOrigin: string;
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
        if (!requestOrigin || requestOrigin !== expectedOrigin) {
            return respond({ error: 'forbidden_origin' }, 403);
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
            return respond({ error: 'invalid_request' }, 415);
        }

        try {
            // An OAuth code and verifier are short: reject larger payloads.
            const raw = await request.text();
            if (raw.length > 4096) return respond({ error: 'invalid_request' }, 413);
            const body: unknown = JSON.parse(raw);
            if (!body || typeof body !== 'object') return respond({ error: 'invalid_request' }, 400);

            const payload = body as Record<string, unknown>;
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
                code: code as string,
                code_verifier: verifier,
            });
            const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
                signal: AbortSignal.timeout(15000),
            });

            const data: unknown = await upstream.json();
            if (!data || typeof data !== 'object') {
                return respond({ error: 'invalid_response' }, 502);
            }

            const result = data as Record<string, unknown>;
            if (!upstream.ok || typeof result.access_token !== 'string') {
                return respond({
                    error: typeof result.error === 'string' ? result.error : 'token_exchange_failed',
                    error_description: typeof result.error_description === 'string'
                        ? result.error_description : 'Deriv rejected the authorization code.',
                }, 400);
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

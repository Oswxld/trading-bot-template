import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/oauth/token.mjs';

const url = 'https://oswaldtest.vercel.app';
const request = () => new Request(url + '/api/oauth/token', {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'mock-code', code_verifier: 'x'.repeat(43), redirect_uri: url }),
});
const testEnv = {
    CLIENT_ID: 'test-client', OAUTH_REDIRECT_URI: url,
    AUTO_ADMIN_DERIV_ACCOUNT_ID: 'DOT123', ADMIN_SUPABASE_EMAIL: 'test@example.invalid',
    ADMIN_SUPABASE_PASSWORD: 'mock-password-not-real',
    PUBLIC_SUPABASE_URL: 'https://example.invalid', PUBLIC_SUPABASE_ANON_KEY: 'mock-publishable',
};
const withMock = async (accounts, callback, { authStatus = 200, listStatus = 200, missingPassword = false } = {}) => {
    const oldFetch = globalThis.fetch;
    const old = Object.fromEntries(Object.keys(testEnv).map(key => [key, process.env[key]]));
    Object.assign(process.env, testEnv);
    if (missingPassword) delete process.env.ADMIN_SUPABASE_PASSWORD;
    let authCalls = 0;
    globalThis.fetch = async (endpoint, options) => {
        if (endpoint === 'https://auth.deriv.com/oauth2/token') return Response.json({ access_token: 'live-token' });
        if (endpoint === 'https://api.derivws.com/trading/v1/options/accounts') {
            assert.equal(options.headers.Authorization, 'Bearer live-token');
            return Response.json({ data: accounts }, { status: listStatus });
        }
        if (endpoint === 'https://example.invalid/auth/v1/token?grant_type=password') {
            authCalls++;
            assert.equal(JSON.parse(options.body).password, testEnv.ADMIN_SUPABASE_PASSWORD);
            return Response.json({ access_token: 'paper-token', refresh_token: 'paper-refresh', expires_in: 3600 }, { status: authStatus });
        }
        throw new Error('Unexpected endpoint');
    };
    try {
        const response = await handler.fetch(request());
        const data = await response.json();
        await callback(response, data, authCalls);
    } finally {
        globalThis.fetch = oldFetch;
        for (const [key, value] of Object.entries(old)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
};
test('verified owner: session is paper-only and no live token or password is returned', async () => {
    await withMock([{ account_id: 'DOTDEMO', account_type: 'demo' }, { account_id: 'DOT123', account_type: 'real' }], (response, data, calls) => {
        assert.equal(response.status, 200); assert.equal(calls, 1);
        assert.equal(data.admin_auto_simulation, true);
        assert.equal(data.admin_session.access_token, 'paper-token');
        assert.equal(data.access_token, undefined);
        assert.ok(!JSON.stringify(data).includes(testEnv.ADMIN_SUPABASE_PASSWORD));
    });
});
test('other users keep the normal OAuth path', async () => {
    await withMock([{ account_id: 'DOT999', account_type: 'real' }], (response, data, calls) => {
        assert.equal(response.status, 200); assert.equal(calls, 0);
        assert.equal(data.access_token, 'live-token'); assert.equal(data.admin_session, undefined);
    });
});
test('missing owner credentials and failed Supabase login never fall through to live trading', async () => {
    for (const settings of [{ missingPassword: true }, { authStatus: 401 }]) {
        await withMock([{ account_id: 'DOT123', account_type: 'real' }], (response, data) => {
            assert.ok(response.status >= 400);
            assert.equal(data.access_token, undefined); assert.equal(data.admin_session, undefined);
        }, settings);
    }
});
test('unverified account list never grants a session', async () => {
    await withMock([], (response, data, calls) => {
        assert.equal(response.status, 502); assert.equal(calls, 0);
        assert.equal(data.access_token, undefined);
    }, { listStatus: 503 });
});

/**
 * Dedicated Supabase Auth for the hidden admin portal.
 * Never uses Deriv OAuth and never embeds a service-role key in the browser.
 */
const STORAGE_KEY = 'yolo:supabase-admin-auth:v1';
let currentSession = null;
let verifiedUser = null;
let refreshing = null;

const getSettings = () => {
    const url = (process.env.PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = (process.env.PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) || !key) {
        throw new Error('Admin login is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in Vercel.');
    }
    return { url, key };
};
export const isAdminAuthConfigured = () => {
    try { getSettings(); return true; } catch { return false; }
};
const failWithError = async response => {
    if (response.ok) return response;
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.msg || payload.error_description || payload.message || payload.error || `Supabase request failed (${response.status})`);
};
const requestAuth = async (path, method = 'GET', body = null, token = null) => {
    const { url, key } = getSettings();
    const response = await fetch(`${url}/auth/v1/${path}`, {
        method,
        headers: {
            apikey: key,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await failWithError(response);
    if (response.status === 204) return {};
    return response.json();
};
const storeSession = session => {
    if (!session?.access_token || !session?.refresh_token) throw new Error('Supabase did not return an authenticated session.');
    currentSession = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(currentSession));
};
const clearSession = () => {
    currentSession = null;
    verifiedUser = null;
    sessionStorage.removeItem(STORAGE_KEY);
};
export const getAdminAuthUser = () => verifiedUser;
export const signInAdminPassword = async (email, password) => {
    const data = await requestAuth('token?grant_type=password', 'POST', { email, password });
    storeSession(data);
    const user = await requestAuth('user', 'GET', null, currentSession.access_token);
    if (!user?.id) throw new Error('Could not verify the Supabase login.');
    verifiedUser = user;
    return user;
};
export const sendAdminEmailOtp = email =>
    requestAuth('otp', 'POST', { email, create_user: false });
export const verifyAdminEmailOtp = async (email, token) => {
    const data = await requestAuth('verify', 'POST', { email, token, type: 'email' });
    storeSession(data);
    const user = await requestAuth('user', 'GET', null, currentSession.access_token);
    if (!user?.id) throw new Error('Could not verify the email code.');
    verifiedUser = user;
    return user;
};
const refreshAccessToken = async () => {
    if (refreshing) return refreshing;
    if (!currentSession?.refresh_token) throw new Error('Admin session expired. Sign in again.');
    refreshing = requestAuth('token?grant_type=refresh_token', 'POST', {
        refresh_token: currentSession.refresh_token,
    }).then(data => {
        storeSession(data);
        return currentSession.access_token;
    }).catch(error => {
        clearSession();
        throw error;
    }).finally(() => { refreshing = null; });
    return refreshing;
};
export const getAdminAccessToken = async (forceRefresh = false) => {
    if (!currentSession) throw new Error('Supabase admin authentication required.');
    if (forceRefresh || currentSession.expires_at < Math.floor(Date.now() / 1000) + 60) {
        await refreshAccessToken();
    }
    return currentSession.access_token;
};
export const restoreAdminAuth = async () => {
    if (!currentSession) {
        try { currentSession = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); }
        catch { clearSession(); return null; }
    }
    if (!currentSession?.access_token || !currentSession?.refresh_token) return null;
    try {
        const token = await getAdminAccessToken();
        const user = await requestAuth('user', 'GET', null, token);
        if (!user?.id) throw new Error('Invalid Supabase session');
        verifiedUser = user;
        return user;
    } catch {
        try {
            const token = await getAdminAccessToken(true);
            const user = await requestAuth('user', 'GET', null, token);
            if (!user?.id) throw new Error('Invalid Supabase session');
            verifiedUser = user;
            return user;
        } catch {
            clearSession();
            return null;
        }
    }
};
/** Execute an authenticated RPC; postgres auth.uid() enforces row ownership. */
export const adminRpc = async (name, args) => {
    const { url, key } = getSettings();
    const call = async token => {
        const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(args),
        });
        return failWithError(response).then(res => res.json());
    };
    try { return await call(await getAdminAccessToken()); }
    catch (error) {
        if (!/401|JWT|token|expired/i.test(String(error?.message || ''))) throw error;
        return call(await getAdminAccessToken(true));
    }
};
export const signOutAdmin = async () => {
    const token = currentSession?.access_token;
    clearSession();
    if (token) await requestAuth('logout', 'POST', null, token).catch(() => {});
};

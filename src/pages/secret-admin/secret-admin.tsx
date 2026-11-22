import { FormEvent, useEffect, useState } from 'react';
import {
    getAdminAuthUser,
    isAdminAuthConfigured,
    restoreAdminAuth,
    sendAdminEmailOtp,
    signInAdminPassword,
    verifyAdminEmailOtp,
} from '@/services/admin-supabase-auth';
import {
    initializeAdminBalanceSync,
} from '@/services/admin-sim-balance-sync';
import { enterAdminTest, hydrateAdminTestBalances, isAdminTestActive } from '@/services/admin-test-kit';
import './secret-admin.scss';

/** This route is intentionally outside the ordinary Deriv/OAuth layout. */
export default function SecretAdmin() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [method, setMethod] = useState<'password' | 'otp'>('password');
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(true);
    const [signedIn, setSignedIn] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let mounted = true;
        void restoreAdminAuth().then(user => {
            if (mounted) setSignedIn(!!user);
        }).catch(() => {}).finally(() => {
            if (mounted) setChecking(false);
        });
        return () => { mounted = false; };
    }, []);

    const activate = async () => {
        await initializeAdminBalanceSync(hydrateAdminTestBalances);
        if (!isAdminTestActive() && !enterAdminTest()) {
            throw new Error('Could not start the Admin Test Kit. Check Supabase settings.');
        }
        window.location.assign('/');
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        try {
            if (signedIn && getAdminAuthUser()) {
                await activate();
                return;
            }
            if (method === 'password') {
                await signInAdminPassword(email.trim(), password);
                await activate();
                return;
            }
            if (!sent) {
                await sendAdminEmailOtp(email.trim());
                setSent(true);
                setMessage('If this account is registered, check its email for a login code.');
                return;
            }
            await verifyAdminEmailOtp(email.trim(), code.trim());
            await activate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed.');
        } finally { setBusy(false); }
    };
    return (
        <main className='secret-admin'>
            <form className='secret-admin__card' onSubmit={submit}>
                <div className='secret-admin__eyebrow'>Private account access</div>
                <h1>Admin sign in</h1>
                <p>Sign in with your existing Supabase account to open the simulated trading test kit.
                    This does not sign you in to Deriv.</p>
                {!isAdminAuthConfigured() ? <p role='alert' className='secret-admin__error'>
                    Supabase is not configured for this deployment. Add the public environment variables to Vercel.
                </p> : checking ? <p>Checking your session…</p> : <>
                    {!signedIn && <>
                        <label htmlFor='secret-admin-email'>Email address</label>
                        <input id='secret-admin-email' type='email' autoComplete='email' value={email}
                            onChange={event => setEmail(event.target.value)} required disabled={busy || sent} />
                        {method === 'password' ? <>
                            <label htmlFor='secret-admin-password'>Password</label>
                            <input id='secret-admin-password' type='password' autoComplete='current-password'
                                value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
                        </> : sent ? <>
                            <label htmlFor='secret-admin-code'>Email verification code</label>
                            <input id='secret-admin-code' type='text' inputMode='numeric' autoComplete='one-time-code'
                                value={code} onChange={event => setCode(event.target.value)} required disabled={busy} />
                        </> : null}
                    </>}
                    {error && <p role='alert' className='secret-admin__error'>{error}</p>}
                    {message && <p role='status'>{message}</p>}
                    <button type='submit' disabled={busy}>
                        {busy ? 'Connecting…' : signedIn ? 'Enter simulated trading' :
                            method === 'password' ? 'Sign in' : sent ? 'Verify and enter' : 'Send email code'}
                    </button>
                    {!signedIn && <button className='secret-admin__secondary' type='button' disabled={busy}
                        onClick={() => { setMethod(method === 'password' ? 'otp' : 'password'); setSent(false); setError(''); setMessage(''); }}>
                        {method === 'password' ? 'Use an email OTP instead' : 'Use password instead'}
                    </button>}
                </>}
                <a href='/'>Return to trading site</a>
            </form>
        </main>
    );
}

import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { signOutAdmin } from '@/services/admin-supabase-auth';
import {
    ADMIN_BALANCE_SYNC_EVENT,
    flushAdminBalanceSync,
    hasPendingAdminBalances,
    refreshAdminRemoteBalances,
} from '@/services/admin-sim-balance-sync';
import {
    ADMIN_TEST_MANAGE_EVENT,
    ADMIN_TEST_OPEN_EVENT,
    exitAdminTest,
    getAdminTestBalances,
    getAdminTestContracts,
    getAdminTestExecutionMode,
    getAdminTestWinProbability,
    isAdminTestActive,
    setAdminTestBalance,
    setAdminTestExecutionMode,
    setAdminTestWinProbability,
    switchAdminTestAccount,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';
import './admin-test-kit.scss';

/** The dot is rendered only after a Supabase session has been verified. */
export default function AdminTestKit() {
    const [opened, setOpened] = useState(false);
    const [demo, setDemo] = useState(() => String(getAdminTestBalances()[TEST_DEMO_ID]));
    const [real, setReal] = useState(() => String(getAdminTestBalances()[TEST_REAL_ID]));
    const [winProbability, setWinProbability] = useState(() => getAdminTestWinProbability());
    const [executionMode, setExecutionMode] = useState(() => getAdminTestExecutionMode());
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [pending, setPending] = useState(() => hasPendingAdminBalances());
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHold = () => {
        if (holdTimer.current !== null) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
        }
    };
    const openPanel = () => {
        if (!isAdminTestActive()) return;
        const balances = getAdminTestBalances();
        setDemo(String(balances[TEST_DEMO_ID]));
        setReal(String(balances[TEST_REAL_ID]));
        setError('');
        setOpened(true);
    };
    const startHold = () => {
        if (holdTimer.current !== null || opened || !isAdminTestActive()) return;
        holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            openPanel();
        }, 3000);
    };
    useEffect(() => {
        const open = () => openPanel();
        const onSync = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            setPending(!!detail?.pending);
            // Trade persistence errors should never be silently hidden.
            if (detail?.error) setError('Balance sync: ' + detail.error);
        };
        window.addEventListener(ADMIN_TEST_OPEN_EVENT, open);
        window.addEventListener(ADMIN_TEST_MANAGE_EVENT, open);
        window.addEventListener(ADMIN_BALANCE_SYNC_EVENT, onSync);
        return () => {
            cancelHold();
            window.removeEventListener(ADMIN_TEST_OPEN_EVENT, open);
            window.removeEventListener(ADMIN_TEST_MANAGE_EVENT, open);
            window.removeEventListener(ADMIN_BALANCE_SYNC_EVENT, onSync);
        };
        // Intentional single mount: dashboard shortcut opens the same panel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    if (!isAdminTestActive()) return null;
    const noOpenContracts = () =>
        [TEST_DEMO_ID, TEST_REAL_ID].every(id =>
            getAdminTestContracts(id).every(contract => contract.is_sold)
        );
    const safeToChange = () => {
        if (api_base.is_running || !noOpenContracts()) {
            setError('Stop simulated strategies and allow open contracts to settle before changing balances or accounts.');
            return false;
        }
        return true;
    };
    const withSaving = async (action: () => Promise<void>) => {
        if (saving || !safeToChange()) return;
        setSaving(true);
        setError('');
        try { await action(); }
        catch (err) { setError(err instanceof Error ? err.message : 'Operation failed. Pending changes are safely retained.'); }
        finally { setSaving(false); }
    };
    const resetBalances = () => void withSaving(async () => {
        await flushAdminBalanceSync();
        // Each account mode is an independent atomic PostgreSQL transaction.
        await setAdminTestBalance(TEST_DEMO_ID, demo);
        await setAdminTestBalance(TEST_REAL_ID, real);
        window.location.reload();
    });
    const switchTo = (id: string) => void withSaving(async () => {
        await flushAdminBalanceSync();
        if (switchAdminTestAccount(id)) window.location.reload();
    });
    const logout = () => void withSaving(async () => {
        await flushAdminBalanceSync();
        exitAdminTest();
        await signOutAdmin();
        window.location.assign('/');
    });
    const refresh = () => void withSaving(async () => {
        await refreshAdminRemoteBalances();
        window.location.reload();
    });

    return (
        <>
            <button className='admin-test-kit__secret' type='button'
                aria-label='Press and hold for 3 seconds to open Admin Test Kit'
                title='Hold for 3 seconds'
                onPointerDown={event => {
                    if (event.pointerType !== 'mouse' || event.button === 0) {
                        event.preventDefault();
                        startHold();
                    }
                }}
                onPointerUp={cancelHold} onPointerCancel={cancelHold}
                onPointerLeave={cancelHold} onContextMenu={event => event.preventDefault()}
                onKeyDown={event => {
                    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                        event.preventDefault();
                        startHold();
                    }
                }}
                onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') cancelHold(); }}
                onBlur={cancelHold}
            >·</button>
            {opened && <div className='admin-test-kit__overlay' role='presentation'
                onClick={() => { if (!saving) setOpened(false); }}>
                <section className='admin-test-kit__dialog' role='dialog' aria-modal='true'
                    aria-label='Supabase Admin Test Kit' onClick={e => e.stopPropagation()}>
                    <div className='admin-test-kit__head'>
                        <h2>Admin Test Kit</h2>
                        <button type='button' disabled={saving} onClick={() => setOpened(false)} aria-label='Close'>×</button>
                    </div>
                    <p className='admin-test-kit__warning'>
                        SIMULATED TRADING ONLY — not a real Deriv account. Balances are stored
                        in your Supabase Options wallets; no real money is spent.
                    </p>
                    {pending && <p role='status'>Saving simulated balance changes to Supabase…</p>}
                    <div className='admin-test-kit__balances'>
                        <label>DEMO OPTIONS (simulated USD)
                            <input type='number' min='0' max='1000000' step='0.01'
                                value={demo} onChange={e => setDemo(e.target.value)} disabled={saving} />
                        </label>
                        <label>REAL OPTIONS (simulated USD)
                            <input type='number' min='0' max='1000000' step='0.01'
                                value={real} onChange={e => setReal(e.target.value)} disabled={saving} />
                        </label>
                    </div>
                    <div className='admin-test-kit__probability'>
                        <label htmlFor='admin-test-execution-mode'>Bot Builder simulated execution</label>
                        <select id='admin-test-execution-mode' value={executionMode}
                            disabled={saving || api_base.is_running}
                            onChange={event => {
                                const next = event.target.value;
                                if (setAdminTestExecutionMode(next)) setExecutionMode(next);
                            }}>
                            <option value='presentation'>Presentation (paper results and reports)</option>
                            <option value='engine'>Engine test (actual Blockly against simulated API)</option>
                        </select>
                        <small>Both Bot Builder and Bulk Trader use these same simulated account balances.</small>
                    </div>
                    <div className='admin-test-kit__probability'>
                        <div className='admin-test-kit__probability-labels'>
                            <label htmlFor='admin-test-win-probability'>Win probability <strong>{winProbability}%</strong></label>
                            <span>Loss probability <strong>{100 - winProbability}%</strong></span>
                        </div>
                        <input id='admin-test-win-probability' type='range' min='0' max='100' step='1'
                            value={winProbability} aria-valuetext={`${winProbability}% win, ${100 - winProbability}% loss`}
                            onChange={event => {
                                const next = Number(event.target.value);
                                if (setAdminTestWinProbability(next)) setWinProbability(next);
                            }} disabled={saving} />
                        <div className='admin-test-kit__probability-scale' aria-hidden='true'>
                            <span>0%</span><span>50%</span><span>100%</span>
                        </div>
                        <small>Simulated outcomes only · Updates immediately</small>
                    </div>
                    <button type='button' onClick={resetBalances} disabled={saving}>Save Options balances to Supabase</button>
                    <button type='button' onClick={refresh} disabled={saving}>Reload balances from Supabase</button>
                    <div className='admin-test-kit__row'>
                        <button className='admin-test-kit__primary' type='button'
                            disabled={saving} onClick={() => switchTo(TEST_DEMO_ID)}>Switch to Demo</button>
                        <button className='admin-test-kit__primary' type='button'
                            disabled={saving} onClick={() => switchTo(TEST_REAL_ID)}>Switch to Real (simulated)</button>
                    </div>
                    <button className='admin-test-kit__exit' type='button' disabled={saving} onClick={logout}>
                        Save changes & sign out of admin
                    </button>
                    {error && <p role='alert' className='admin-test-kit__error'>{error}</p>}
                </section>
            </div>}
        </>
    );
}

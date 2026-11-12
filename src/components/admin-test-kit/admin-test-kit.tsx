import React, { useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    enterAdminTest,
    exitAdminTest,
    getAdminTestBalances,
    isAdminTestActive,
    isAdminTestAvailable,
    setAdminTestBalance,
    switchAdminTestAccount,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';
import './admin-test-kit.scss';

/**
 * Hidden local development control: tap the dot five times within four seconds.
 * It cannot be enabled on a deployed client domain by a URL, cookie, or PIN.
 */
export default function AdminTestKit() {
    const [opened, setOpened] = useState(false);
    const [demo, setDemo] = useState(() => String(getAdminTestBalances()[TEST_DEMO_ID]));
    const [real, setReal] = useState(() => String(getAdminTestBalances()[TEST_REAL_ID]));
    const [error, setError] = useState('');
    const taps = useRef({ count: 0, first: 0 });
    if (!isAdminTestAvailable()) return null;
    const active = isAdminTestActive();
    const openSecret = () => {
        const now = Date.now();
        if (now - taps.current.first > 4000) taps.current = { first: now, count: 0 };
        taps.current.count += 1;
        if (taps.current.count >= 5) {
            taps.current = { first: 0, count: 0 };
            setOpened(true);
        }
    };
    const resetBalances = () => {
        if (!setAdminTestBalance(TEST_DEMO_ID, demo) || !setAdminTestBalance(TEST_REAL_ID, real)) {
            setError('Enter valid simulated balances from 0 to 1,000,000.');
            return;
        }
        window.location.reload();
    };
    const switchTo = id => {
        if (api_base.is_running) {
            setError('Stop the running Bot Builder strategy before changing accounts.');
            return;
        }
        if (switchAdminTestAccount(id)) window.location.reload();
    };
    return (
        <>
            {active && <div className='admin-test-kit__banner' role='status'>
                TEST MODE — SIMULATED FUNDS / NO DERIV PURCHASES
                <button type='button' onClick={() => setOpened(true)}>Manage</button>
            </div>}
            <button
                className='admin-test-kit__secret'
                type='button'
                aria-label='Local test kit access'
                title='Local development controls'
                onClick={openSecret}
            >·</button>
            {opened && <div className='admin-test-kit__overlay' role='presentation' onClick={() => setOpened(false)}>
                <section className='admin-test-kit__dialog' role='dialog' aria-modal='true'
                    aria-label='Local Admin Test Kit' onClick={e => e.stopPropagation()}>
                    <div className='admin-test-kit__head'>
                        <h2>Admin Test Kit</h2>
                        <button type='button' onClick={() => setOpened(false)} aria-label='Close'>×</button>
                    </div>
                    <p className='admin-test-kit__warning'>
                        LOCAL SIMULATION ONLY — not a Deriv account. All balances, prices, orders and
                        settlements are generated inside this browser. No real money can be spent.
                    </p>
                    {!active ? <>
                        <p>Start without Deriv login and test the existing Bot Builder and Bulk Trader
                            using two independent virtual accounts labelled Demo and Real.</p>
                        <button className='admin-test-kit__primary' type='button'
                            onClick={() => { if (enterAdminTest()) window.location.reload(); }}>
                            Enter simulated admin mode
                        </button>
                    </> : <>
                        <div className='admin-test-kit__balances'>
                            <label>DEMO (simulated USD)
                                <input type='number' min='0' max='1000000' step='0.01'
                                    value={demo} onChange={e => setDemo(e.target.value)} />
                            </label>
                            <label>REAL (simulated USD)
                                <input type='number' min='0' max='1000000' step='0.01'
                                    value={real} onChange={e => setReal(e.target.value)} />
                            </label>
                        </div>
                        <button type='button' onClick={resetBalances}>Save test balances & reload</button>
                        <div className='admin-test-kit__row'>
                            <button className='admin-test-kit__primary' type='button'
                                onClick={() => switchTo(TEST_DEMO_ID)}>Switch to Demo</button>
                            <button className='admin-test-kit__primary' type='button'
                                onClick={() => switchTo(TEST_REAL_ID)}>Switch to Real (simulated)</button>
                        </div>
                        <button className='admin-test-kit__exit' type='button'
                            onClick={() => { if (api_base.is_running) {
                                setError('Stop the bot before leaving test mode.');
                            } else if (exitAdminTest()) window.location.reload(); }}>
                            Exit test kit and restore previous login
                        </button>
                    </>}
                    {error && <p role='alert' className='admin-test-kit__error'>{error}</p>}
                </section>
            </div>}
        </>
    );
}

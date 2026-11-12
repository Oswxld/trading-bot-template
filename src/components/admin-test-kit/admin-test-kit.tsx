import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    enterAdminTest,
    ADMIN_TEST_MANAGE_EVENT,
    exitAdminTest,
    getAdminTestBalances,
    getAdminTestWinProbability,
    isAdminTestActive,
    isAdminTestAvailable,
    setAdminTestBalance,
    setAdminTestWinProbability,
    switchAdminTestAccount,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';
import './admin-test-kit.scss';

/**
 * Hidden local development control: press and hold the footer dot for 3 seconds.
 * It cannot be enabled on a deployed client domain by a URL, cookie, or PIN.
 */
export default function AdminTestKit() {
    const [opened, setOpened] = useState(false);
    const [demo, setDemo] = useState(() => String(getAdminTestBalances()[TEST_DEMO_ID]));
    const [real, setReal] = useState(() => String(getAdminTestBalances()[TEST_REAL_ID]));
    const [winProbability, setWinProbability] = useState(() => getAdminTestWinProbability());
    const [error, setError] = useState('');
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHold = () => {
        if (holdTimer.current !== null) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
        }
    };
    const startHold = () => {
        if (holdTimer.current !== null || opened) return;
        holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            setOpened(true);
        }, 3000);
    };
    useEffect(() => {
        const openManage = () => {
            if (isAdminTestActive()) {
                setError('');
                setOpened(true);
            }
        };
        window.addEventListener(ADMIN_TEST_MANAGE_EVENT, openManage);
        return () => {
            if (holdTimer.current !== null) clearTimeout(holdTimer.current);
            window.removeEventListener(ADMIN_TEST_MANAGE_EVENT, openManage);
        };
    }, []);
    if (!isAdminTestAvailable()) return null;
    const active = isAdminTestActive();
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
            <button
                className='admin-test-kit__secret'
                type='button'
                aria-label='Press and hold for 3 seconds to open local Admin Test Kit'
                title='Hold for 3 seconds'
                onPointerDown={event => {
                    if (event.pointerType !== 'mouse' || event.button === 0) {
                        event.preventDefault();
                        startHold();
                    }
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onPointerLeave={cancelHold}
                onContextMenu={event => event.preventDefault()}
                onKeyDown={event => {
                    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
                        event.preventDefault();
                        startHold();
                    }
                }}
                onKeyUp={event => {
                    if (event.key === 'Enter' || event.key === ' ') cancelHold();
                }}
                onBlur={cancelHold}
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
                        <div className='admin-test-kit__probability'>
                            <div className='admin-test-kit__probability-labels'>
                                <label htmlFor='admin-test-win-probability'>
                                    Win probability <strong>{winProbability}%</strong>
                                </label>
                                <span>Loss probability <strong>{100 - winProbability}%</strong></span>
                            </div>
                            <input
                                id='admin-test-win-probability'
                                type='range'
                                min='0'
                                max='100'
                                step='1'
                                value={winProbability}
                                aria-valuetext={`${winProbability}% win, ${100 - winProbability}% loss`}
                                onChange={event => {
                                    const next = Number(event.target.value);
                                    if (setAdminTestWinProbability(next)) {
                                        setWinProbability(next);
                                    }
                                }}
                            />
                            <div className='admin-test-kit__probability-scale' aria-hidden='true'>
                                <span>0%</span><span>50%</span><span>100%</span>
                            </div>
                            <small>Simulated trades only · Updates immediately</small>
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

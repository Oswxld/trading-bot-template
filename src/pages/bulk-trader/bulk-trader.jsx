import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import './bulk-trader.scss';

/**
 * Single-account bulk trader: make N sequential proposal+buy purchases.
 * This is deliberately DEMO-ONLY until we test the complete flow with Deriv.
 * Deriv's REST bulk-purchase endpoint is for multiple DIFFERENT accounts.
 */
const MARKETS = [
    ['1HZ10V', 'Volatility 10 (1s)'],
    ['1HZ25V', 'Volatility 25 (1s)'],
    ['1HZ50V', 'Volatility 50 (1s)'],
    ['1HZ75V', 'Volatility 75 (1s)'],
    ['1HZ100V', 'Volatility 100 (1s)'],
    ['R_10', 'Volatility 10'],
    ['R_25', 'Volatility 25'],
    ['R_50', 'Volatility 50'],
    ['R_75', 'Volatility 75'],
    ['R_100', 'Volatility 100'],
];
const CONTRACTS = [
    ['DIGITDIFF', 'Digit Differs'],
    ['DIGITMATCH', 'Digit Matches'],
    ['DIGITOVER', 'Digit Over'],
    ['DIGITUNDER', 'Digit Under'],
    ['DIGITEVEN', 'Digit Even'],
    ['DIGITODD', 'Digit Odd'],
];
const NEEDS_DIGIT = new Set(['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER']);
const MAX_TRADES = 50;
const MIN_PACING_MS = 850; // proposal+buy share Deriv's 360/minute WS budget
let nextRequestId = Math.floor(Math.random() * 10000000) + 50000000;

const readableError = error => error?.message || error?.error?.message || 'The trading request was rejected.';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Request-response matching uses a unique req_id. Subscribes before sending,
 * and never retries a buy: a lost response may mean a purchase DID succeed.
 */
function request(api, payload, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const reqId = ++nextRequestId;
        let settled = false;
        let subscription;
        let timer;
        const done = (error, response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            subscription?.unsubscribe();
            if (error) reject(error);
            else resolve(response);
        };
        try {
            subscription = api.onMessage().subscribe(event => {
                const message = event?.data || event;
                if (Number(message?.req_id) !== reqId) return;
                if (message.error) return done(new Error(readableError(message.error)));
                // A proposal stream may update after the first response.
                done(null, message);
            });
            timer = setTimeout(() => done(new Error('Request timed out. Check your account before trying again.')), timeout);
            api.send({ ...payload, req_id: reqId });
        } catch (error) {
            done(error);
        }
    });
}

function BulkTrader() {
    const [symbol, setSymbol] = useState('1HZ100V');
    const [contractType, setContractType] = useState('DIGITDIFF');
    const [prediction, setPrediction] = useState('5');
    const [stake, setStake] = useState('0.35');
    const [quantity, setQuantity] = useState('5');
    const [status, setStatus] = useState('idle');
    const [results, setResults] = useState([]);
    const [message, setMessage] = useState('');
    const [finished, setFinished] = useState(0);
    const stopRef = useRef(false);
    const runRef = useRef(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopRef.current = true;
        };
    }, []);

    const accountId = localStorage.getItem('active_loginid') || '';
    const storedAccounts = DerivWSAccountsService.getStoredAccounts() || [];
    const account = storedAccounts.find(item => item.account_id === accountId);
    const currency = account?.currency || 'USD';
    const isDemo = account?.account_type === 'demo';
    const stakeNumber = Number(stake);
    const count = Number(quantity);
    const valid = Number.isFinite(stakeNumber) && stakeNumber > 0 && stakeNumber <= 100 &&
        Number.isInteger(count) && count >= 1 && count <= MAX_TRADES &&
        (!NEEDS_DIGIT.has(contractType) || /^[0-9]$/.test(prediction));
    const exposure = valid ? stakeNumber * count : 0;
    const purchased = results.filter(item => item.status === 'Purchased').length;
    const spent = results.reduce((sum, item) => sum + (item.price || 0), 0);

    const stop = () => {
        stopRef.current = true;
        if (mountedRef.current) setMessage('Stopping after the currently submitted request. An already submitted purchase cannot be cancelled.');
    };

    const start = async () => {
        if (runRef.current) return;
        if (!valid) {
            setMessage('Enter a valid stake (over 0 and up to 100), quantity (1–50), and prediction (0–9).');
            return;
        }
        if (!isDemo || !accountId || !account?.currency) {
            setMessage('Bulk Trader is DEMO-ONLY during testing. Switch to an authenticated Deriv demo account.');
            return;
        }
        const api = api_base.api;
        if (!api || api.connection?.readyState !== 1 || api_base.account_id !== accountId) {
            setMessage('The active demo account is not connected. Wait for login/WebSocket initialization.');
            return;
        }
        if (api_base.is_running) {
            setMessage('Stop the existing trading bot before using Bulk Trader on this account.');
            return;
        }

        const approved = window.confirm(
            `Place ${count} separate ${contractType} demo trades on ${accountId}?\n` +
            `Stake per trade: ${stakeNumber.toFixed(2)} ${currency}\n` +
            `Total intended stake: ${exposure.toFixed(2)} ${currency}\n\n` +
            'Each purchase is a real Deriv DEMO-account order. Proceed?'
        );
        if (!approved) return;

        runRef.current = true;
        stopRef.current = false;
        setResults([]);
        setFinished(0);
        setMessage('Submitting demo purchases one at a time…');
        setStatus('running');

        let successful = 0;
        let failed = 0;
        // The same JS closure protects against changing accounts mid-run.
        const isSafe = () => !stopRef.current &&
            localStorage.getItem('active_loginid') === accountId &&
            api_base.api === api &&
            api.connection?.readyState === 1 &&
            !api_base.is_running;
        try {
            for (let index = 0; index < count; index++) {
                if (!isSafe()) break;
                const startedAt = Date.now();
                let subscriptionId = null;
                try {
                    // New Deriv API requires a streaming proposal ID before buy.
                    const proposalRequest = {
                        proposal: 1,
                        amount: stakeNumber,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration: 1,
                        duration_unit: 't',
                        underlying_symbol: symbol,
                        subscribe: 1,
                    };
                    if (NEEDS_DIGIT.has(contractType)) proposalRequest.barrier = prediction;
                    const proposalResult = await request(api, proposalRequest);
                    const proposed = proposalResult?.proposal;
                    subscriptionId = proposalResult?.subscription?.id || proposed?.id || null;
                    if (!proposed?.id || !Number.isFinite(Number(proposed.ask_price))) {
                        throw new Error('No usable price proposal was returned.');
                    }
                    if (!isSafe()) break;
                    const maxPrice = Number(proposed.ask_price);
                    // Never buy at a higher price than the configured stake.
                    if (maxPrice <= 0 || maxPrice > stakeNumber + 0.00001) {
                        throw new Error('Quoted price exceeded your configured stake; order skipped.');
                    }
                    const response = await request(api, { buy: proposed.id, price: maxPrice });
                    if (!response?.buy?.contract_id) {
                        throw new Error('The buy response did not confirm a contract. Check your statement before retrying.');
                    }
                    successful += 1;
                    if (mountedRef.current) setResults(old => [{
                        number: index + 1,
                        status: 'Purchased',
                        price: Number(response.buy.buy_price ?? maxPrice),
                        contractId: String(response.buy.contract_id),
                    }, ...old]);
                } catch (error) {
                    failed += 1;
                    if (mountedRef.current) setResults(old => [{
                        number: index + 1,
                        status: 'Failed / unconfirmed',
                        price: 0,
                        reason: readableError(error),
                    }, ...old]);
                    // A request timeout (especially after buy) is ambiguous. Stop
                    // rather than accidentally placing duplicate orders.
                    if (/timed out|did not confirm a contract/i.test(readableError(error))) {
                        stopRef.current = true;
                    }
                } finally {
                    if (subscriptionId && api.connection?.readyState === 1) {
                        try { api.send({ forget: subscriptionId }); } catch { /* socket may have closed */ }
                    }
                    if (mountedRef.current) setFinished(index + 1);
                    const elapsed = Date.now() - startedAt;
                    if (!stopRef.current && index < count - 1) await delay(Math.max(0, MIN_PACING_MS - elapsed));
                }
            }

            if (mountedRef.current) {
                const stopped = stopRef.current || localStorage.getItem('active_loginid') !== accountId;
                setStatus(stopped ? 'stopped' : 'finished');
                setMessage(`${stopped ? 'Stopped' : 'Finished'}. ${successful} purchase(s) confirmed; ${failed} failed/unconfirmed. Results show purchases, not settled profit/loss.`);
            }
        } finally {
            runRef.current = false;
        }
    };

    return (
        <section className='bulk-trader'>
            <div className='bulk-trader__heading'>
                <div><h1>Bulk Trader</h1><p>Open multiple separate contracts on one Deriv account.</p></div>
                <span className='bulk-trader__demo'>DEMO TESTING ONLY</span>
            </div>
            <div className='bulk-trader__notice'>
                This tool submits orders sequentially, not simultaneously. Each purchase has market risk.
                A Stop request prevents future orders but cannot undo an order already submitted.
            </div>
            <div className='bulk-trader__layout'>
                <div className='bulk-trader__card'>
                    <h2>Trade setup</h2>
                    <div className='bulk-trader__account'>
                        Active account: <strong>{accountId || 'Not logged in'}</strong>
                        <span>{isDemo ? 'Demo' : 'Demo account required'} · {currency}</span>
                    </div>
                    <div className='bulk-trader__fields'>
                        <label>Market
                            <select value={symbol} onChange={e => setSymbol(e.target.value)} disabled={runRef.current}>
                                {MARKETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </label>
                        <label>Trade type
                            <select value={contractType} onChange={e => setContractType(e.target.value)} disabled={runRef.current}>
                                {CONTRACTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </label>
                        {NEEDS_DIGIT.has(contractType) && <label>Prediction (last digit)
                            <select value={prediction} onChange={e => setPrediction(e.target.value)} disabled={runRef.current}>
                                {Array.from({ length: 10 }, (_, i) => <option key={i} value={String(i)}>{i}</option>)}
                            </select>
                        </label>}
                        <label>Stake per trade ({currency})
                            <input type='number' min='0.01' max='100' step='0.01' value={stake}
                                disabled={runRef.current} onChange={e => setStake(e.target.value)} />
                        </label>
                        <label>Number of trades (max {MAX_TRADES})
                            <input type='number' min='1' max={MAX_TRADES} step='1' value={quantity}
                                disabled={runRef.current} onChange={e => setQuantity(e.target.value)} />
                        </label>
                        <label>Duration
                            <input value='1 tick (fixed for digit trades)' readOnly />
                        </label>
                    </div>
                    <div className='bulk-trader__exposure'>
                        <span>Maximum intended stake (quantity × stake)</span>
                        <strong>{valid ? exposure.toFixed(2) : '—'} {currency}</strong>
                    </div>
                    <div className='bulk-trader__actions'>
                        <button className='bulk-trader__submit' type='button' onClick={start}
                            disabled={status === 'running' || !valid || !isDemo}>Confirm &amp; buy demo contracts</button>
                        <button className='bulk-trader__stop' type='button' onClick={stop}
                            disabled={status !== 'running'}>Stop</button>
                    </div>
                    {message && <p className='bulk-trader__message' role='status'>{message}</p>}
                </div>
                <div className='bulk-trader__card'>
                    <h2>Execution results</h2>
                    <div className='bulk-trader__stats'>
                        <div><small>Processed</small><strong>{finished}/{status === 'running' ? quantity : (finished || quantity)}</strong></div>
                        <div><small>Confirmed purchases</small><strong>{purchased}</strong></div>
                        <div><small>Total purchased</small><strong>{spent.toFixed(2)} {currency}</strong></div>
                    </div>
                    <p className='bulk-trader__explanation'>These are purchase acknowledgements only. Settled wins, losses and profit/loss belong in your Deriv account statement.</p>
                    <div className='bulk-trader__table'>
                        <table>
                            <thead><tr><th>#</th><th>Status</th><th>Price</th><th>Contract ID / error</th></tr></thead>
                            <tbody>{results.length ? results.map(item => (
                                <tr key={item.number}><td>{item.number}</td><td>{item.status}</td>
                                    <td>{item.price ? item.price.toFixed(2) : '—'}</td>
                                    <td>{item.contractId || item.reason || '—'}</td></tr>
                            )) : <tr><td colSpan='4'>No orders submitted in this session.</td></tr>}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}

export default BulkTrader;

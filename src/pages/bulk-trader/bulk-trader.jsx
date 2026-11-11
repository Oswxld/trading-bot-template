import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { useStore } from '@/hooks/useStore';
import BulkReports from './bulk-reports';
import './bulk-trader.scss';

/**
 * Single-account bulk trader, intentionally DEMO-ONLY until all API flows and
 * market/contract combinations are tested. Never silently switch accounts.
 * Unlike Deriv's REST multi-account bulk endpoint, each purchase is a separate
 * proposal+buy on the existing active-account WebSocket connection.
 */
const DEFAULT_MARKETS = [
    { value: 'R_100', label: 'Volatility 100 Index', pipSize: 2 },
    { value: 'R_75', label: 'Volatility 75 Index', pipSize: 2 },
    { value: 'R_50', label: 'Volatility 50 Index', pipSize: 2 },
    { value: 'R_25', label: 'Volatility 25 Index', pipSize: 2 },
    { value: 'R_10', label: 'Volatility 10 Index', pipSize: 2 },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index', pipSize: 2 },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index', pipSize: 2 },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index', pipSize: 2 },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index', pipSize: 2 },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index', pipSize: 2 },
];
const TRADE_TYPES = [
    { value: 'MATCH_DIFF', label: 'Matches/Differs', actions: [['DIGITDIFF', 'Differs'], ['DIGITMATCH', 'Matches']] },
    { value: 'OVER_UNDER', label: 'Over/Under', actions: [['DIGITUNDER', 'Under'], ['DIGITOVER', 'Over']] },
    { value: 'EVEN_ODD', label: 'Even/Odd', actions: [['DIGITEVEN', 'Even'], ['DIGITODD', 'Odd']] },
    { value: 'RISE_FALL', label: 'Rise/Fall', actions: [['PUT', 'Fall'], ['CALL', 'Rise']] },
];
const NEEDS_DIGIT = new Set(['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER']);
const MAX_TRADES = 50;
const MIN_PACING_MS = 850;
let nextRequestId = Math.floor(Math.random() * 10000000) + 50000000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const messageFor = e => e?.message || e?.error?.message || 'The trading request was rejected.';
const digitsFrom = (price, pipSize = 2) => {
    const number = Number(price);
    if (!Number.isFinite(number)) return null;
    const decimals = Number.isInteger(Number(pipSize)) ? Math.max(0, Math.min(8, Number(pipSize))) : 2;
    return Number(number.toFixed(decimals).slice(-1));
};
const fromStorage = (accountId, type) => {
    if (!accountId) return [];
    try {
        const result = JSON.parse(sessionStorage.getItem(`bulk-trader:${type}:${accountId}`) || '[]');
        return Array.isArray(result) ? result.slice(0, 300) : [];
    } catch { return []; }
};
const marketOrder = item => {
    if (/^Volatility 100 Index$/i.test(item.label)) return -1000;
    if (/^Volatility/i.test(item.label)) return 0;
    if (/Step/i.test(item.label)) return 1000;
    return 2000;
};

/** Match reply by req_id; never retry an ambiguous buy. */
const request = (api, payload, timeout = 15000) => new Promise((resolve, reject) => {
    const reqId = ++nextRequestId;
    let subscription;
    let timer;
    let finished = false;
    const done = (error, data) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        subscription?.unsubscribe?.();
        if (error) reject(error);
        else resolve(data);
    };
    try {
        subscription = api.onMessage().subscribe(event => {
            const data = event?.data || event;
            if (Number(data?.req_id) !== reqId) return;
            if (data.error) done(new Error(messageFor(data.error)));
            else done(null, data);
        });
        timer = setTimeout(() => done(new Error('Request timed out. Check Deriv account history before making another purchase.')), timeout);
        api.send({ ...payload, req_id: reqId });
    } catch (error) { done(error); }
});

const BulkTrader = observer(() => {
    const { client } = useStore();
    const [market, setMarket] = useState('R_100');
    const [markets, setMarkets] = useState(DEFAULT_MARKETS);
    const [availableContracts, setAvailableContracts] = useState(null);
    const [tradeType, setTradeType] = useState('MATCH_DIFF');
    const [prediction, setPrediction] = useState('5');
    const [sampleSize, setSampleSize] = useState('1000');
    const [duration, setDuration] = useState('1');
    const [stake, setStake] = useState('0.50');
    const [quantity, setQuantity] = useState('1');
    const [ticks, setTicks] = useState([]);
    const [currentPrice, setCurrentPrice] = useState('—');
    const [marketError, setMarketError] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [progress, setProgress] = useState(0);

    // The session contains bulk records per *account* so tab navigation never
    // mixes contract history between users and does not wipe completed results.
    const activeAccountId = client?.loginid || localStorage.getItem('active_loginid') || '';
    const accounts = DerivWSAccountsService.getStoredAccounts() || [];
    const account = accounts.find(item => item.account_id === activeAccountId);
    const currency = account?.currency || client?.currency || 'USD';
    const isDemo = Boolean(account?.account_type === 'demo' || /^VRT/i.test(activeAccountId)) && Boolean(activeAccountId);
    const [reportAccount, setReportAccount] = useState(activeAccountId);
    const [records, setRecords] = useState(() => fromStorage(activeAccountId, 'records'));
    const [journal, setJournal] = useState(() => fromStorage(activeAccountId, 'journal'));
    const recordsRef = useRef(records);
    const runRef = useRef(false);
    const stopRef = useRef(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; stopRef.current = true; };
    }, []);

    useEffect(() => {
        stopRef.current = true;
        recordsRef.current = fromStorage(activeAccountId, 'records');
        setRecords(recordsRef.current);
        setJournal(fromStorage(activeAccountId, 'journal'));
        setReportAccount(activeAccountId);
    }, [activeAccountId]);

    useEffect(() => {
        if (reportAccount !== activeAccountId || !activeAccountId) return;
        try { sessionStorage.setItem(`bulk-trader:records:${reportAccount}`, JSON.stringify(records.slice(0, 300))); }
        catch { /* storage disabled or full */ }
    }, [records, reportAccount, activeAccountId]);

    useEffect(() => {
        if (reportAccount !== activeAccountId || !activeAccountId) return;
        try { sessionStorage.setItem(`bulk-trader:journal:${reportAccount}`, JSON.stringify(journal.slice(0, 300))); }
        catch { /* storage disabled or full */ }
    }, [journal, reportAccount, activeAccountId]);

    const log = text => {
        if (!mountedRef.current) return;
        setJournal(previous => [{ id: ++nextRequestId, timestamp: Date.now(), message: text }, ...previous].slice(0, 300));
    };
    const addRecord = item => {
        recordsRef.current = [item, ...recordsRef.current].slice(0, 300);
        if (mountedRef.current) setRecords(recordsRef.current);
    };
    const applyContractUpdate = contract => {
        if (!contract?.contract_id || !mountedRef.current) return;
        const contractId = String(contract.contract_id);
        const old = recordsRef.current.find(item => item.contractId === contractId);
        if (!old) return;
        const isClosed = ['won', 'lost', 'sold'].includes(String(contract.status || '').toLowerCase()) ||
            contract.is_sold === 1 || contract.is_sold === true;
        const reportedProfit = Number(contract.profit);
        const hasProfit = contract.profit !== undefined && contract.profit !== null && Number.isFinite(reportedProfit);
        const newStatus = isClosed && hasProfit ? (reportedProfit >= 0 ? 'won' : 'lost') : old.status;
        const update = {
            ...old,
            status: newStatus,
            profit: isClosed && hasProfit ? reportedProfit : old.profit,
            payout: isClosed && Number.isFinite(Number(contract.payout))
                ? Number(contract.payout) : old.payout,
            entrySpot: contract.entry_spot ?? old.entrySpot,
            exitSpot: contract.exit_spot ?? old.exitSpot,
        };
        if (JSON.stringify(update) === JSON.stringify(old)) return;
        recordsRef.current = recordsRef.current.map(item => item.contractId === contractId ? update : item);
        setRecords(recordsRef.current);
        if (newStatus !== old.status && ['won', 'lost'].includes(newStatus)) {
            log(`Contract ${contractId} settled ${newStatus.toUpperCase()}: ${reportedProfit >= 0 ? '+' : ''}${reportedProfit.toFixed(2)} ${currency}.`);
        }
    };

    // Monitor only our own submitted contract IDs using Deriv's authenticated
    // proposal_open_contract subscription, and refresh saved open trades on return.
    useEffect(() => {
        if (!activeAccountId || !isDemo) return undefined;
        let stopped = false;
        let socket;
        let localSubscription;
        let subscriptionId = null;
        const initialise = async () => {
            for (let attempt = 0; attempt < 15 && !stopped; attempt++) {
                const api = api_base.api;
                if (api?.connection?.readyState === 1 && api_base.account_id === activeAccountId) {
                    socket = api;
                    const requestId = ++nextRequestId;
                    localSubscription = api.onMessage().subscribe(event => {
                        const data = event?.data || event;
                        if (data.msg_type !== 'proposal_open_contract') return;
                        if (Number(data.req_id) === requestId && data.subscription?.id) {
                            subscriptionId = data.subscription.id;
                        }
                        if (data.proposal_open_contract) applyContractUpdate(data.proposal_open_contract);
                    });
                    try {
                        api.send({ proposal_open_contract: 1, subscribe: 1, req_id: requestId });
                        for (const record of recordsRef.current.filter(item => item.contractId && item.status === 'open').slice(0, 40)) {
                            request(api, { proposal_open_contract: 1, contract_id: Number(record.contractId) })
                                .then(data => { if (!stopped) applyContractUpdate(data.proposal_open_contract); })
                                .catch(() => {}); // Pending trade status may not yet be available.
                        }
                    } catch (error) { if (!stopped) setMarketError(messageFor(error)); }
                    return;
                }
                await delay(700);
            }
        };
        initialise();
        return () => {
            stopped = true;
            localSubscription?.unsubscribe?.();
            if (socket?.connection?.readyState === 1 && subscriptionId) {
                try { socket.send({ forget: subscriptionId }); } catch { /* websocket closed */ }
            }
        };
    }, [activeAccountId, isDemo]);

    // Fetch all currently available synthetic Volatility and Step indices from
    // Deriv. The built-in list is a short fallback, not a fabricated Step symbol.
    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
                const api = api_base.api;
                if (api?.connection?.readyState === 1) {
                    try {
                        const cached = Array.isArray(api_base.active_symbols) ? api_base.active_symbols : [];
                        const response = cached.length ? { active_symbols: cached } : await request(api, { active_symbols: 'brief' });
                        const available = (response?.active_symbols || [])
                            .filter(item => /volatility|step.*index/i.test(item.display_name || ''))
                            .filter(item => item.underlying_symbol || item.symbol)
                            .map(item => ({
                                value: item.underlying_symbol || item.symbol,
                                label: item.display_name,
                                pipSize: Number(item.pip_size ?? 2),
                                isOpen: ![0, false, '0'].includes(item.exchange_is_open) && ![1, true, '1'].includes(item.is_trading_suspended),
                            }))
                            .sort((a, b) => marketOrder(a) - marketOrder(b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
                        if (!cancelled && available.length) {
                            setMarkets(available);
                            setMarketError('');
                            setMarket(current => available.some(item => item.value === current) ? current : available[0].value);
                        }
                    } catch (error) {
                        if (!cancelled) setMarketError('Could not load all markets. Displaying the default Volatility indices.');
                    }
                    return;
                }
                await delay(700);
            }
        };
        run();
        return () => { cancelled = true; };
    }, []);

    // Contract availability varies by market: e.g. Step indices may not offer
    // Digit Matches/Differs. Disable unsupported actions instead of pretending
    // every trade type is available on every index.
    useEffect(() => {
        let cancelled = false;
        setAvailableContracts(null);
        const check = async () => {
            for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
                const api = api_base.api;
                if (api?.connection?.readyState === 1) {
                    try {
                        const response = await request(api, { contracts_for: market });
                        const offered = response?.contracts_for?.available;
                        if (!cancelled && Array.isArray(offered)) {
                            setAvailableContracts(new Set(offered.map(item => item.contract_type)));
                        }
                    } catch { /* the proposal endpoint still validates contract offers */ }
                    return;
                }
                await delay(700);
            }
        };
        check();
        return () => { cancelled = true; };
    }, [market, activeAccountId]);

    // Live 1,000-tick (configurable) last-digit distribution plus recent outcomes.
    // The WebSocket subscription is forgotten when the market/window changes.
    useEffect(() => {
        let cancelled = false;
        let apiInUse;
        let subId = null;
        let listener;
        const id = ++nextRequestId;
        const count = Math.min(5000, Math.max(10, Number(sampleSize) || 1000));
        setTicks([]);
        setCurrentPrice('—');
        const subscribe = async () => {
            for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
                const api = api_base.api;
                if (api?.connection?.readyState === 1) {
                    apiInUse = api;
                    listener = api.onMessage().subscribe(event => {
                        const data = event?.data || event;
                        if (cancelled) return;
                        const belongs = Number(data?.req_id) === id || (subId && data?.subscription?.id === subId);
                        if (!belongs) return;
                        if (data?.subscription?.id) subId = data.subscription.id;
                        if (data.error) {
                            setMarketError(messageFor(data.error));
                            return;
                        }
                        if (data.msg_type === 'history' && Array.isArray(data.history?.prices)) {
                            const pip = Number(data.pip_size ?? markets.find(item => item.value === market)?.pipSize ?? 2);
                            const digits = data.history.prices.map(price => digitsFrom(price, pip)).filter(digit => digit !== null);
                            setTicks(digits.slice(-count));
                            const last = data.history.prices[data.history.prices.length - 1];
                            if (last !== undefined) setCurrentPrice(Number(last).toFixed(Math.max(0, Math.min(8, pip))));
                        }
                        if (data.msg_type === 'tick' && data.tick && (!data.tick.symbol || data.tick.symbol === market)) {
                            const pip = Number(data.tick.pip_size ?? markets.find(item => item.value === market)?.pipSize ?? 2);
                            const digit = digitsFrom(data.tick.quote, pip);
                            if (digit === null) return;
                            setTicks(previous => [...previous, digit].slice(-count));
                            setCurrentPrice(Number(data.tick.quote).toFixed(Math.max(0, Math.min(8, pip))));
                        }
                    });
                    try { api.send({ ticks_history: market, end: 'latest', style: 'ticks', count, subscribe: 1, req_id: id }); }
                    catch (error) { if (!cancelled) setMarketError(messageFor(error)); }
                    return;
                }
                await delay(700);
            }
        };
        subscribe();
        return () => {
            cancelled = true;
            listener?.unsubscribe?.();
            if (apiInUse?.connection?.readyState === 1 && subId) {
                try { apiInUse.send({ forget: subId }); } catch { /* socket closed */ }
            }
        };
    }, [market, sampleSize, markets, activeAccountId]);

    const stakeValue = Number(stake);
    const numberTrades = Number(quantity);
    const durationTicks = Number(duration);
    const sample = Number(sampleSize);
    const valid = Number.isFinite(stakeValue) && stakeValue > 0 && stakeValue <= 100 &&
        Number.isInteger(numberTrades) && numberTrades >= 1 && numberTrades <= MAX_TRADES &&
        Number.isInteger(durationTicks) && durationTicks >= 1 && durationTicks <= 10 &&
        Number.isInteger(sample) && sample >= 10 && sample <= 5000 &&
        /^[0-9]$/.test(prediction);
    const exposure = valid ? stakeValue * numberTrades : 0;
    const counts = Array.from({ length: 10 }, (_, n) => ticks.filter(d => d === n).length);
    const sampleCount = ticks.length;
    const lastDigit = sampleCount ? ticks[sampleCount - 1] : null;
    const topThree = counts.map((count, index) => [count, index]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(i => i[1]);
    const currentSelection = TRADE_TYPES.find(item => item.value === tradeType) || TRADE_TYPES[0];
    const chosenMarket = markets.find(item => item.value === market);
    const isRunning = status === 'running';

    const stop = () => {
        stopRef.current = true;
        setMessage('Stopping after the request in progress. An already submitted purchase cannot be cancelled.');
    };

    const begin = async (contractType, buttonLabel) => {
        if (runRef.current) return;
        if (!valid) {
            setMessage('Enter valid stake (0–100), trades (1–50), duration (1–10 ticks) and history ticks (10–5,000).');
            return;
        }
        if (!isDemo || !account?.currency) {
            setMessage('DEMO-ONLY test mode. Switch to an authenticated Deriv demo account.');
            return;
        }
        if (availableContracts && !availableContracts.has(contractType)) {
            setMessage('Deriv does not offer this contract type on the selected market. Choose another trade type or market.');
            return;
        }
        if (chosenMarket?.isOpen === false) {
            setMessage('The chosen market is closed or suspended.');
            return;
        }
        const api = api_base.api;
        if (!api || api.connection?.readyState !== 1 || api_base.account_id !== activeAccountId) {
            setMessage('Wait for your demo account WebSocket to connect.');
            return;
        }
        if (api_base.is_running) {
            setMessage('Stop your running Deriv bot before bulk trading on the same account.');
            return;
        }
        if (!window.confirm(
            `Buy ${numberTrades} separate ${buttonLabel} DEMO contracts on ${activeAccountId}?\n` +
            `Market: ${chosenMarket?.label || market}\n` +
            `Stake each: ${stakeValue.toFixed(2)} ${currency}\n` +
            `Maximum intended stake: ${exposure.toFixed(2)} ${currency}\n\n` +
            'Orders are sequential and cannot be undone after submission. Proceed?'
        )) return;

        runRef.current = true;
        stopRef.current = false;
        setStatus('running');
        setProgress(0);
        setMessage('Sending demo trades one at a time…');
        log(`Started ${numberTrades} ${buttonLabel} demo purchases on ${chosenMarket?.label || market}; maximum intended stake ${exposure.toFixed(2)} ${currency}.`);

        let successes = 0;
        let failures = 0;
        let consecutiveErrors = 0;
        const isSafe = () => !stopRef.current &&
            localStorage.getItem('active_loginid') === activeAccountId &&
            api_base.api === api && api.connection?.readyState === 1 && !api_base.is_running;
        try {
            for (let i = 0; i < numberTrades; i++) {
                if (!isSafe()) break;
                const began = Date.now();
                let subscriptionId = null;
                try {
                    const proposalRequest = {
                        proposal: 1,
                        amount: stakeValue,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration: durationTicks,
                        duration_unit: 't',
                        underlying_symbol: market,
                        subscribe: 1,
                    };
                    if (NEEDS_DIGIT.has(contractType)) proposalRequest.barrier = prediction;

                    const quote = await request(api, proposalRequest);
                    const proposal = quote?.proposal;
                    subscriptionId = quote?.subscription?.id || null;
                    if (!proposal?.id || !Number.isFinite(Number(proposal.ask_price))) {
                        throw new Error('Deriv did not return a valid purchase proposal.');
                    }
                    if (!isSafe()) break;
                    const price = Number(proposal.ask_price);
                    if (price <= 0 || price > stakeValue + 0.00001) {
                        throw new Error('Quoted price exceeded your stake; this purchase was skipped.');
                    }
                    const result = await request(api, { buy: proposal.id, price });
                    if (!result?.buy?.contract_id) {
                        throw new Error('The purchase was not confirmed. Check the Deriv account statement before trying again.');
                    }
                    successes++;
                    consecutiveErrors = 0;
                    const contractId = String(result.buy.contract_id);
                    addRecord({
                        number: Date.now() + i,
                        timestamp: Date.now(),
                        contractId,
                        symbol: market,
                        symbolName: chosenMarket?.label || market,
                        contractType: buttonLabel,
                        price: Number(result.buy.buy_price ?? price),
                        prediction: NEEDS_DIGIT.has(contractType) ? prediction : null,
                        status: 'open',
                        payout: null, profit: null, entrySpot: null, exitSpot: null,
                    });
                    log(`Purchased ${buttonLabel} #${i + 1}, contract ${contractId}, stake ${price.toFixed(2)} ${currency}.`);
                    // Immediate snapshot complements live contract-status stream on
                    // markets where a one-tick contract can settle very quickly.
                    request(api, { proposal_open_contract: 1, contract_id: Number(contractId) })
                        .then(response => applyContractUpdate(response.proposal_open_contract))
                        .catch(() => {});
                } catch (error) {
                    failures++;
                    consecutiveErrors++;
                    const reason = messageFor(error);
                    addRecord({
                        number: Date.now() + i,
                        timestamp: Date.now(),
                        contractId: null,
                        symbol: market,
                        symbolName: chosenMarket?.label || market,
                        contractType: buttonLabel,
                        price: 0,
                        status: /timed out|not confirmed/i.test(reason) ? 'unconfirmed' : 'failed',
                        reason,
                        payout: null, profit: null,
                    });
                    log(`Purchase #${i + 1} failed or was unconfirmed: ${reason}`);
                    if (/timed out|not confirmed/i.test(reason) || consecutiveErrors >= 2) {
                        stopRef.current = true; // Avoid duplicate/unsupported repeated purchases.
                    }
                } finally {
                    if (subscriptionId && api.connection?.readyState === 1) {
                        try { api.send({ forget: subscriptionId }); } catch { /* websocket closed */ }
                    }
                    if (mountedRef.current) setProgress(i + 1);
                    const elapsed = Date.now() - began;
                    if (!stopRef.current && i < numberTrades - 1) await delay(Math.max(0, MIN_PACING_MS - elapsed));
                }
            }
            const stopped = stopRef.current || !isSafe();
            if (mountedRef.current) {
                setStatus(stopped ? 'stopped' : 'finished');
                setMessage(`${stopped ? 'Stopped' : 'Completed'}. ${successes} purchases confirmed; ${failures} failed/unconfirmed. Check the Summary/Transactions/Journal panel for settlement reports.`);
                log(`Execution ${stopped ? 'stopped' : 'completed'}: ${successes} confirmed purchases, ${failures} failed/unconfirmed.`);
            }
        } finally {
            runRef.current = false;
        }
    };

    const resetReport = () => {
        if (runRef.current) return;
        recordsRef.current = [];
        setRecords([]);
        setJournal([]);
        setProgress(0);
        setMessage('');
        setStatus('idle');
    };

    return (
        <section className='bulk-trader' aria-label='Bulk Trader'>
            <div className='bulk-trader__top'>
                <div className='bulk-trader__form-grid'>
                    <label>MARKET
                        <select value={market} disabled={isRunning} onChange={e => setMarket(e.target.value)}>
                            {markets.map(item => <option value={item.value} key={item.value}
                                disabled={item.isOpen === false}>{item.label}{item.isOpen === false ? ' (closed)' : ''}</option>)}
                        </select>
                    </label>
                    <label>TRADE TYPE
                        <select value={tradeType} disabled={isRunning} onChange={e => setTradeType(e.target.value)}>
                            {TRADE_TYPES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
                        </select>
                    </label>
                    <label>NUMBER OF TICKS
                        <input type='number' value={sampleSize} min='10' max='5000' step='1'
                            disabled={isRunning} onChange={e => setSampleSize(e.target.value)} />
                    </label>
                    <label>PREDICTION
                        <select value={prediction} disabled={isRunning || tradeType === 'EVEN_ODD' || tradeType === 'RISE_FALL'}
                            onChange={e => setPrediction(e.target.value)}>
                            {Array.from({ length: 10 }, (_, index) => <option key={index} value={index}>{index}</option>)}
                        </select>
                    </label>
                </div>
                {marketError && <p className='bulk-trader__market-error' role='status'>{marketError}</p>}
                <div className='bulk-trader__live'>
                    <span>CURRENT TICK</span>
                    <strong>{currentPrice}</strong>
                </div>
                <div className='bulk-trader__digits'>
                    {counts.map((count, digit) => (
                        <div key={digit} className='bulk-trader__digit-cell'>
                            <div className={['bulk-trader__digit',
                                digit === lastDigit ? 'bulk-trader__digit--active' : '',
                                topThree[0] === digit ? 'bulk-trader__digit--top' : '',
                                topThree[1] === digit ? 'bulk-trader__digit--second' : '',
                                topThree[2] === digit ? 'bulk-trader__digit--third' : ''
                            ].join(' ')} title={`${count} of ${sampleCount} ticks`}>
                                <b>{digit}</b>
                                <small>{sampleCount ? (100 * count / sampleCount).toFixed(1) : '0.0'}%</small>
                            </div>
                            {digit === lastDigit && <span className='bulk-trader__tick-indicator' aria-label='Latest digit'>▲</span>}
                        </div>
                    ))}
                </div>
                <div className='bulk-trader__recent' aria-label='Recent tick digit results'>
                    {ticks.slice(-8).map((digit, index) => (
                        <span key={index} className={digit === Number(prediction) ? 'bulk-trader__recent-match' : ''}>
                            {digit === Number(prediction) ? 'M' : 'D'}
                        </span>
                    ))}
                </div>
                <div className='bulk-trader__trade-grid'>
                    <label>TICKS
                        <input type='number' min='1' max='10' step='1' disabled={isRunning} value={duration}
                            onChange={e => setDuration(e.target.value)} />
                    </label>
                    <label>STAKE
                        <input type='number' min='0.01' max='100' step='0.01' disabled={isRunning} value={stake}
                            onChange={e => setStake(e.target.value)} />
                    </label>
                    <label>NO OF TRADES
                        <input type='number' min='1' max='50' step='1' disabled={isRunning} value={quantity}
                            onChange={e => setQuantity(e.target.value)} />
                    </label>
                </div>
                <div className='bulk-trader__total'>
                    <span>TOTAL STAKE</span>
                    <strong>{valid ? exposure.toFixed(2) : '—'} {currency}</strong>
                    <small>Intended maximum across {valid ? numberTrades : '—'} separate orders</small>
                </div>
                <div className='bulk-trader__buttons'>
                    {currentSelection.actions.map(([type, label], index) => (
                        <button key={type} type='button' className={index === 0 ? 'bulk-trader__buy-a' : 'bulk-trader__buy-b'}
                            disabled={isRunning || !valid || !isDemo || (availableContracts && !availableContracts.has(type))}
                            title={availableContracts && !availableContracts.has(type) ? 'Not offered on this market' : ''}
                            onClick={() => begin(type, label)}>
                            {label}
                        </button>
                    ))}
                </div>
                {isRunning && <button className='bulk-trader__stop' type='button' onClick={stop}>Stop bulk orders ({progress}/{quantity})</button>}
                {!isDemo && <p className='bulk-trader__notice'>Demo account required for bulk trading tests. Your regular Deriv bot remains unaffected.</p>}
                {message && <p className='bulk-trader__feedback' role='status'>{message}</p>}
            </div>

            <BulkReports records={records} journal={journal} accountId={activeAccountId}
                currency={currency} balance={client?.balance} isRunning={isRunning}
                onReset={resetReport} />
        </section>
    );
});

export default BulkTrader;

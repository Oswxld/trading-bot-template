import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { isAdminTestActive, isAdminTestTransportReady, isAdminTestSessionReady } from '@/services/admin-test-kit';
import { checkRealExposure, identifyBulkAccount, REAL_LIMITS } from './bulk-account-safety';
import { tradingBudgetSnapshot } from '@/services/trading-request-budget';
import { useStore } from '@/hooks/useStore';
import {
    createEarlySettlementBuffer,
    isVerifiedSettlement,
    mergeContractSettlement,
} from './bulk-contract-monitor';
import {
    acquireBulkRun,
    classifyBulkFailure,
    releaseBulkRun,
} from './bulk-request-safety';
import { requestBulkApi } from './bulk-api-request';
import { makePendingBulkRecord, recoverInterruptedBulkRecords, upsertBulkRecord } from './bulk-trade-records';
import { runBoundedBulkOperations } from './bulk-execution';
import BulkReports from './bulk-reports';
import './bulk-trader.scss';

/**
 * Single-account bulk trader for the selected practice or real account.
 * Never silently switch accounts or infer account type from login ID.
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
// Cap concurrent, unconfirmed purchase operations; fewer trades use fewer slots.
const MAX_IN_FLIGHT_PURCHASES = 5;
// Start up to 5 operations, staggered by 500 ms; actual trading requests
// also pass the shared 240/min and 12,000/hour soft request-budget gate.
const MIN_PACING_MS = 500;
let nextRequestId = Math.floor(Math.random() * 10000000) + 50000000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const messageFor = e => e?.message || e?.error?.message || 'The trading request was rejected.';
const digitsFrom = (price, pipSize = 2) => {
    const number = Number(price);
    if (!Number.isFinite(number)) return null;
    const decimals = Number.isInteger(Number(pipSize)) ? Math.max(0, Math.min(8, Number(pipSize))) : 2;
    return Number(number.toFixed(decimals).slice(-1));
};
const fromStorage = (accountId, type, recoverInterrupted = false) => {
    if (!accountId) return [];
    try {
        const result = JSON.parse(sessionStorage.getItem(`bulk-trader:${type}:${accountId}`) || '[]');
        const rows = Array.isArray(result) ? result.slice(0, 300) : [];
        return recoverInterrupted && type === 'records'
            ? recoverInterruptedBulkRecords(rows)
            : rows;
    } catch { return []; }
};
const marketOrder = item => {
    if (/^Volatility 100 Index$/i.test(item.label)) return -1000;
    if (/^Volatility/i.test(item.label)) return 0;
    if (/Step/i.test(item.label)) return 1000;
    return 2000;
};

// Keep a single, monotonically increasing req_id sequence shared with other
// subscriptions in this tab. The request helper is independently testable.
const request = (api, payload, timeout = 15000, canSend = () => true, onThrottle) =>
    requestBulkApi({
        api, payload, timeout, canSend, onThrottle,
        reqId: ++nextRequestId,
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
    // Show reports by default on larger screens; keep the entire trade form
    // visible initially on phones. The visible button toggles either way.
    const [reportsOpen, setReportsOpen] = useState(() => window.innerWidth >= 1024);
    const [message, setMessage] = useState('');
    const [isPreflighting, setIsPreflighting] = useState(false);
    const [refreshedAccounts, setRefreshedAccounts] = useState(null);
    const [progress, setProgress] = useState(0);
    const [inFlight, setInFlight] = useState(0);

    // The session contains bulk records per *account* so tab navigation never
    // mixes contract history between users and does not wipe completed results.
    const activeAccountId = client?.loginid || localStorage.getItem('active_loginid') || '';
    // Prefer the OAuth account list, but recover from incomplete sessionStorage.
    // The authenticated WebSocket is the source of truth for demo fallback;
    // a login-ID prefix alone must never authorize a purchase.
    const accounts = refreshedAccounts || DerivWSAccountsService.getStoredAccounts() || [];
    const account = accounts.find(item => item.account_id === activeAccountId);
    const liveAccount = api_base.account_info;
    const socketMatches = Boolean(
        api_base.is_authorized &&
        api_base.account_id === activeAccountId &&
        liveAccount?.loginid === activeAccountId &&
        api_base.api?.connection?.readyState === 1
    );
    const currency = account?.currency ||
        (socketMatches ? liveAccount?.currency : null) || client?.currency || 'USD';
    const accountMode = identifyBulkAccount(account, activeAccountId, {
        liveAccount, socketAuthorized: socketMatches,
        clientAccount: client?.accounts?.[activeAccountId],
    });
    const isSimulated = isAdminTestActive();
    const isReal = accountMode === 'real';
    const accountLabel = isSimulated
        ? (isReal ? 'SIMULATED REAL ACCOUNT' : accountMode === 'demo' ? 'SIMULATED DEMO ACCOUNT' : 'Select an account')
        : (isReal ? 'REAL ACCOUNT' : accountMode === 'demo' ? 'Practice account' : 'Select an account');
    const [reportAccount, setReportAccount] = useState(activeAccountId);
    const [records, setRecords] = useState(() => fromStorage(activeAccountId, 'records', true));
    const [journal, setJournal] = useState(() => fromStorage(activeAccountId, 'journal'));
    const recordsRef = useRef(records);
    // Use the rendered account, not just localStorage, before updating visible
    // reports: switching accounts can leave an older batch in flight.
    const activeAccountRef = useRef(activeAccountId);
    activeAccountRef.current = activeAccountId;
    const runRef = useRef(false);
    const preflightRef = useRef(false);
    const stopRef = useRef(false);
    const mountedRef = useRef(true);
    const settlementTimersRef = useRef(new Set());
    const earlySettlementsRef = useRef(null);
    if (!earlySettlementsRef.current) earlySettlementsRef.current = createEarlySettlementBuffer();

    // If OAuth completed but the stored list was lost/stale, re-fetch it.
    // This is especially important for real accounts: never guess real-money
    // permissions from an account ID or a locally cached display balance.
    useEffect(() => {
        if (isAdminTestActive() || !activeAccountId || accountMode !== 'unavailable' || !client?.is_logged_in) return;
        const accessToken = OAuthTokenExchangeService.getAccessToken();
        if (!accessToken) return;
        let cancelled = false;
        DerivWSAccountsService.fetchAccountsList(accessToken)
            .then(rows => { if (!cancelled && Array.isArray(rows)) setRefreshedAccounts(rows); })
            .catch(() => { /* The button will explain that verification is unavailable. */ });
        return () => { cancelled = true; };
    }, [activeAccountId, accountMode, client?.is_logged_in]);

    const clearSettlementTimers = () => {
        settlementTimersRef.current.forEach(timer => clearTimeout(timer));
        settlementTimersRef.current.clear();
    };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopRef.current = true;
            clearSettlementTimers();
            earlySettlementsRef.current.clear();
        };
    }, []);

    useEffect(() => {
        // Never let a timer or buffered event from account A update account B.
        clearSettlementTimers();
        earlySettlementsRef.current.clear();
        stopRef.current = true;
        if (runRef.current) {
            setStatus('stopped');
            setMessage('Account changed. No new bulk orders will be submitted; earlier requests may still confirm on the previous account.');
            setInFlight(0);
        }
        recordsRef.current = fromStorage(activeAccountId, 'records', true);
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
    const applyContractUpdate = contract => {
        if (!contract?.contract_id || !mountedRef.current) return;
        const contractId = String(contract.contract_id);
        const old = recordsRef.current.find(item => item.contractId === contractId);
        if (!old) {
            // One-tick contracts can settle on the shared stream before the
            // buy response yields its contract_id. Cache only actual closed
            // results while a bulk run is active; never infer a win or loss.
            if (runRef.current && isVerifiedSettlement(contract)) {
                earlySettlementsRef.current.remember(contract);
            }
            return;
        }

        const update = mergeContractSettlement(old, contract);
        if (JSON.stringify(update) === JSON.stringify(old)) return;
        recordsRef.current = recordsRef.current.map(item =>
            item.contractId === contractId ? update : item
        );
        setRecords(recordsRef.current);
        if (update.status !== old.status && ['won', 'lost'].includes(update.status)) {
            log(`Contract ${contractId} settled ${update.status.toUpperCase()}: ${update.profit >= 0 ? '+' : ''}${update.profit.toFixed(2)} ${currency}.`);
        }
    };

    // APIBase owns the authenticated proposal_open_contract stream with
    // subscribe: 1 (without contract_id: this streams all open contracts).
    // Reuse it; do not open another stream for each bulk purchase.
    //
    // Rebind our listener on WebSocket replacement. The trading socket can
    // reconnect without activeAccountId changing; the previous listener would
    // otherwise remain attached to the dead connection.
    useEffect(() => {
        if (!activeAccountId || accountMode === 'unavailable') return undefined;
        let stopped = false;
        let observedApi = null;
        let listener = null;
        let socketGeneration = 0;

        const validSocket = api => !stopped && mountedRef.current &&
            activeAccountRef.current === activeAccountId &&
            api_base.api === api && api_base.account_id === activeAccountId &&
            api?.connection?.readyState === 1;

        // When returning to this tab or reconnecting, reconcile saved records
        // that still appear open. Skip anything settled by the live stream
        // before its recovery request starts; never guess an outcome.
        const recoverUnsettled = async (api, generation) => {
            const canObserve = () => validSocket(api) && observedApi === api &&
                socketGeneration === generation;
            const pendingIds = recordsRef.current
                .filter(item => item.contractId && item.status === 'open')
                .slice(0, 50)
                .map(item => String(item.contractId));

            for (const contractId of pendingIds) {
                if (!canObserve()) return;
                if (!recordsRef.current.some(item =>
                    item.contractId === contractId && item.status === 'open'
                )) continue;
                try {
                    const data = await request(
                        api,
                        { proposal_open_contract: 1, contract_id: Number(contractId) },
                        12000,
                        canObserve
                    );
                    if (canObserve()) applyContractUpdate(data.proposal_open_contract);
                } catch {
                    // Keep it open, not fabricated as lost. The live stream
                    // or a later session may still deliver a final status.
                }
                if (canObserve()) await delay(120);
            }
        };

        const watchSocket = () => {
            const api = api_base.api;
            if (!validSocket(api)) {
                if (observedApi) {
                    listener?.unsubscribe?.();
                    listener = null;
                    observedApi = null;
                    socketGeneration++;
                }
                return;
            }
            if (observedApi === api) return;
            listener?.unsubscribe?.();
            listener = null;
            observedApi = api;
            const generation = ++socketGeneration;
            try {
                listener = api.onMessage().subscribe(event => {
                    if (!validSocket(api) || observedApi !== api ||
                        socketGeneration !== generation) return;
                    const data = event?.data || event;
                    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                        applyContractUpdate(data.proposal_open_contract);
                    }
                });
                void recoverUnsettled(api, generation);
            } catch {
                observedApi = null;
                listener?.unsubscribe?.();
                listener = null;
            }
        };

        watchSocket();
        const reconnectWatch = setInterval(watchSocket, 1500);
        return () => {
            stopped = true;
            socketGeneration++;
            clearInterval(reconnectWatch);
            listener?.unsubscribe?.();
        };
    }, [activeAccountId, accountMode]);

    // A one-tick contract can settle before its first streamed update reaches
    // this tab. Only query Deriv if the shared stream has NOT closed the
    // contract after a grace period. A second delayed check is a safety net.
    // This avoids the previous unconditional status request after each buy.
    const scheduleSettlementCheck = (api, contractId, initialDelayMs, remainingChecks = 1) => {
        const timer = setTimeout(async () => {
            settlementTimersRef.current.delete(timer);
            const canObserve = () => mountedRef.current && activeAccountRef.current === activeAccountId &&
                api_base.api === api && api_base.account_id === activeAccountId &&
                api.connection?.readyState === 1;
            const isStillOpen = () => recordsRef.current.some(record =>
                record.contractId === contractId && record.status === 'open'
            );

            if (!canObserve() || !isStillOpen()) return;
            try {
                const data = await request(
                    api, { proposal_open_contract: 1, contract_id: Number(contractId) },
                    12000, canObserve
                );
                if (canObserve()) applyContractUpdate(data.proposal_open_contract);
            } catch {
                // No automatic buy retry and no invented settlement result.
            }

            if (remainingChecks > 0 && canObserve() && isStillOpen()) {
                scheduleSettlementCheck(api, contractId, 8000, remainingChecks - 1);
            }
        }, initialDelayMs);
        settlementTimersRef.current.add(timer);
    };

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
    const maxOrders = isReal ? REAL_LIMITS.trades : MAX_TRADES;
    const maxStake = isReal ? REAL_LIMITS.stake : 100;

    const stop = () => {
        stopRef.current = true;
        setMessage('Stopping new operations. Already submitted buys may still confirm; check the Deriv statement if any confirmation is missing.');
    };

    const begin = async (contractType, buttonLabel) => {
        if (runRef.current || preflightRef.current) return;
        if (!valid) {
            setMessage('Enter valid stake, trades (1–50), duration (1–10 ticks) and history ticks (10–5,000).');
            return;
        }
        // A simulated account is never allowed to borrow a real Deriv socket.
        if (isSimulated && !isAdminTestTransportReady(api_base)) {
            setMessage('Simulated account is not connected. Re-enter Admin Test Mode.');
            return;
        }
        if (isSimulated && !isAdminTestSessionReady(api_base)) {
            await api_base.authorizeAndSubscribe();
            if (!isAdminTestSessionReady(api_base)) {
                setMessage('Simulated account could not initialize. Retry the trade.');
                return;
            }
        }
        if (accountMode === 'unavailable') {
            setMessage(isSimulated ? 'Simulated account not ready. Re-enter Admin Test Mode.' :
                'Select a verified authenticated Deriv account before trading.');
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
            setMessage('Wait for the selected account WebSocket to connect.');
            return;
        }
        if (api_base.is_running) {
            setMessage('Stop your running Deriv bot before bulk trading on the same account.');
            return;
        }
        if (recordsRef.current.some(item => item.status === 'unconfirmed')) {
            setMessage('An earlier purchase has no confirmation. Check the Deriv account statement before starting another batch. Only reset this local report after reconciling those purchases.');
            return;
        }
        // Verify balance with Deriv's authenticated socket, not a cached UI number.
        preflightRef.current = true;
        setIsPreflighting(true);
        try {
            if (isReal) {
                if (numberTrades > REAL_LIMITS.trades || stakeValue > REAL_LIMITS.stake ||
                    exposure > REAL_LIMITS.batch) {
                    setMessage('Real-account limits exceeded. Reduce stake, trade count or total exposure.');
                    return;
                }
                setMessage(isSimulated ? 'Verifying simulated Real-account balance and exposure…' :
                    'Verifying real-account balance and exposure…');
                let balanceData;
                try {
                    const response = await request(api, { balance: 1 }, 12000);
                    balanceData = response?.balance;
                } catch (error) {
                    setMessage(`Could not verify the account balance: ${messageFor(error)}`);
                    return;
                }
                const check = checkRealExposure({
                    stake: stakeValue, quantity: numberTrades,
                    balance: balanceData?.balance,
                    receivedCurrency: balanceData?.currency,
                    receivedAccount: balanceData?.loginid || balanceData?.account_id,
                    accountId: activeAccountId, currency: account.currency,
                });
                if (!check.allowed) {
                    setMessage(check.message);
                    return;
                }
            }
            if (!mountedRef.current || activeAccountRef.current !== activeAccountId ||
                api_base.account_id !== activeAccountId || api_base.api !== api ||
                api.connection?.readyState !== 1 || api_base.is_running ||
                localStorage.getItem('active_loginid') !== activeAccountId) {
                setMessage('Account or connection changed during verification. No batch started.');
                return;
            }
            if (!window.confirm(
                `Purchase ${numberTrades} separate ${buttonLabel} contracts using your ${accountLabel.toLowerCase()}?\n` +
                `Market: ${chosenMarket?.label || market}\n` +
                `Stake each: ${stakeValue.toFixed(2)} ${currency}\n` +
                `Maximum intended stake: ${exposure.toFixed(2)} ${currency}\n\n` +
                `Up to ${Math.min(isReal ? REAL_LIMITS.concurrent : MAX_IN_FLIGHT_PURCHASES, numberTrades)} purchase operations may overlap.\n` +
                (isSimulated ? 'No real purchases are made. Proceed?' : 'Submitted orders cannot be undone. Proceed?')
            )) return;
        } finally {
            preflightRef.current = false;
            if (mountedRef.current) setIsPreflighting(false);
        }
        if (!mountedRef.current || activeAccountRef.current !== activeAccountId ||
            api_base.account_id !== activeAccountId || api_base.api !== api ||
            api.connection?.readyState !== 1 || api_base.is_running ||
            localStorage.getItem('active_loginid') !== activeAccountId) {
            setMessage('Account or connection changed before submission. No batch started.');
            return;
        }
        // Prevent overlapping batches across Bulk Trader component remounts
        // within THIS browser page (other tabs/devices remain independent).
        if (!acquireBulkRun(activeAccountId)) {
            setMessage('Another Bulk Trader batch is still processing on this account. Wait for its outstanding confirmations or check the Deriv statement.');
            return;
        }

        runRef.current = true;
        stopRef.current = false;
        setStatus('running');
        setProgress(0);
        setInFlight(0);
        const workerLimit = Math.min(isReal ? REAL_LIMITS.concurrent : MAX_IN_FLIGHT_PURCHASES, numberTrades);
        setMessage(`Sending up to ${workerLimit} purchase operations on ${accountLabel} concurrently (staggered to respect API limits)…`);
        log(`Started ${numberTrades} ${buttonLabel} orders on ${accountLabel} for ${chosenMarket?.label || market}; max ${workerLimit} pending, intended stake ${exposure.toFixed(2)} ${currency}.`);

        let successes = 0;
        let failures = 0;
        let skipped = 0;
        let unconfirmed = 0;
        let errorCount = 0;

        const isSafe = () => mountedRef.current && activeAccountRef.current === activeAccountId &&
            !stopRef.current && localStorage.getItem('active_loginid') === activeAccountId &&
            api_base.account_id === activeAccountId && api_base.api === api &&
            api.connection?.readyState === 1 && !api_base.is_running;

        const onThrottle = waitMs => {
            if (!mountedRef.current || activeAccountRef.current !== activeAccountId ||
                localStorage.getItem('active_loginid') !== activeAccountId) return;
            const usage = tradingBudgetSnapshot();
            setMessage(
                `Rate limiter: waiting ~${Math.ceil(waitMs / 1000)}s for request capacity ` +
                `(last minute ${usage.minuteUsed}/${usage.minuteLimit}, ` +
                `last hour ${usage.hourUsed}/${usage.hourLimit}). You can press Stop.`
            );
        };

        // An outstanding buy can confirm AFTER a user switches accounts or
        // navigates away. Preserve its record under the account that submitted
        // it, never insert it into the newly selected account's report.
        const saveForRun = (type, entry) => {
            try {
                const previous = fromStorage(activeAccountId, type);
                sessionStorage.setItem(
                    `bulk-trader:${type}:${activeAccountId}`,
                    JSON.stringify([entry, ...previous].slice(0, 300))
                );
            } catch { /* storage may be unavailable */ }
        };
        const logRun = text => {
            if (mountedRef.current && activeAccountRef.current === activeAccountId &&
                localStorage.getItem('active_loginid') === activeAccountId) {
                log(text);
            } else {
                saveForRun('journal', { id: ++nextRequestId, timestamp: Date.now(), message: text });
            }
        };
        // Each operation has ONE stable local row, including while Deriv
        // hasn't responded yet. Update it in place rather than inserting
        // another transaction when the buy confirms or settles.
        const upsertRunRecord = item => {
            const sameAccount = mountedRef.current && activeAccountRef.current === activeAccountId &&
                localStorage.getItem('active_loginid') === activeAccountId;
            const previous = sameAccount ? recordsRef.current : fromStorage(activeAccountId, 'records');
            const next = upsertBulkRecord(previous, item);
            if (sameAccount) {
                recordsRef.current = next;
                setRecords(next);
            }
            // Persist immediately so late confirmations survive navigation,
            // account switching, and component unmounting.
            try {
                sessionStorage.setItem(`bulk-trader:records:${activeAccountId}`, JSON.stringify(next));
            } catch { /* session storage unavailable */ }
        };
        const batchLocalId = `${Date.now()}-${++nextRequestId}`;

        // Reservation, 500 ms start spacing and the five-slot limit are
        // centralised in a separately testable scheduler. Individual workers
        // still wait for their OWN proposal and buy reply, but never block
        // unrelated workers while waiting for those confirmations.
        const executePurchase = async i => {
                const pendingRecord = makePendingBulkRecord({
                    localId: `${batchLocalId}:${i}`,
                    number: i + 1,
                    symbol: market,
                    symbolName: chosenMarket?.label || market,
                    contractType: buttonLabel,
                    prediction: NEEDS_DIGIT.has(contractType) ? prediction : null,
                });
                upsertRunRecord(pendingRecord);
                let subscriptionId = null;
                let phase = 'proposal';
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

                    const quote = await request(api, proposalRequest, 15000, isSafe, onThrottle);
                    const proposal = quote?.proposal;
                    subscriptionId = quote?.subscription?.id || null;
                    if (!proposal?.id || !Number.isFinite(Number(proposal.ask_price))) {
                        throw new Error('Deriv did not return a valid purchase proposal.');
                    }
                    if (!isSafe()) {
                        skipped++;
                        upsertRunRecord({ ...pendingRecord, status: 'skipped', reason: 'Stopped before purchase.' });
                        logRun(`Trade #${i + 1} was skipped before purchase because the run stopped or the account changed.`);
                        return;
                    }
                    const price = Number(proposal.ask_price);
                    if (price <= 0 || price > stakeValue + 0.00001) {
                        throw new Error('Quoted price exceeded your stake; this purchase was skipped.');
                    }
                    phase = 'buy';
                    upsertRunRecord({ ...pendingRecord, status: 'buying' });
                    const result = await request(
                        api, { buy: proposal.id, price }, 15000, isSafe, onThrottle
                    );
                    if (!result?.buy?.contract_id) {
                        throw new Error('The purchase was not confirmed. Check the Deriv account statement before trying again.');
                    }
                    successes++;
                    const contractId = String(result.buy.contract_id);
                    const boughtRecord = {
                        ...pendingRecord,
                        contractId,
                        price: Number(result.buy.buy_price ?? price),
                        status: 'open',
                    };
                    // With 1-tick contracts the final result can arrive
                    // before buy's req_id acknowledgement. Apply the genuine
                    // Deriv close event to this same stable transaction row.
                    const early = earlySettlementsRef.current.take(contractId);
                    const finalRecord = early && activeAccountRef.current === activeAccountId
                        ? mergeContractSettlement(boughtRecord, early)
                        : boughtRecord;
                    upsertRunRecord(finalRecord);
                    logRun(`Purchased ${buttonLabel} #${i + 1}, contract ${contractId}, stake ${price.toFixed(2)} ${currency}.`);
                    // Shared live contract-status stream is the primary source
                    // for settlement. Query only if no settlement arrives.
                    scheduleSettlementCheck(
                        api, contractId, Math.max(5000, durationTicks * 2500 + 2000)
                    );
                } catch (error) {
                    const reason = messageFor(error);
                    const outcome = classifyBulkFailure(error, phase);
                    if (outcome.status === 'skipped') {
                        skipped++;
                        upsertRunRecord({ ...pendingRecord, status: 'skipped', reason });
                        logRun(`Trade #${i + 1} was skipped before its request was sent.`);
                        return;
                    }
                    errorCount++;
                    failures++;
                    if (outcome.status === 'unconfirmed') unconfirmed++;
                    upsertRunRecord({
                        ...pendingRecord,
                        status: outcome.status,
                        reason: `Trade #${i + 1} (${phase}): ${reason}`,
                    });
                    logRun(`Trade #${i + 1} ${outcome.status.toUpperCase()} during ${phase}: ${reason}`);
                    // A buy with a missing acknowledgement might have
                    // executed. Stop further purchases, drain outstanding
                    // operations, never retry this buy automatically.
                    if (outcome.stop || errorCount >= 2) stopRef.current = true;
                } finally {
                    if (subscriptionId && api.connection?.readyState === 1) {
                        try { api.send({ forget: subscriptionId }); } catch { /* websocket closed */ }
                    }
                }
        };

        try {
            const stats = await runBoundedBulkOperations({
                quantity: numberTrades,
                maxConcurrent: workerLimit,
                spacingMs: MIN_PACING_MS,
                shouldContinue: isSafe,
                execute: executePurchase,
                onProgress: ({ completed, active }) => {
                    if (mountedRef.current && activeAccountRef.current === activeAccountId) {
                        setProgress(completed);
                        setInFlight(active);
                    }
                },
            });
            const stopped = stopRef.current || !isSafe() || stats.completed < numberTrades;
            const elapsedSeconds = (stats.elapsedMs / 1000).toFixed(1);
            const rejected = failures - unconfirmed;
            const reconcileWarning = unconfirmed
                ? ' URGENT: Some buys might have executed; reconcile against the Deriv account statement before another batch.'
                : '';
            if (mountedRef.current && activeAccountRef.current === activeAccountId) {
                setStatus(stopped ? 'stopped' : 'finished');
                setMessage(`${stopped ? 'Stopped' : 'Completed'}. ${stats.completed}/${numberTrades} operations processed in ${elapsedSeconds}s; ${successes} confirmed, ${rejected} failed, ${unconfirmed} UNCONFIRMED, ${skipped} skipped. Peak concurrent operations: ${stats.peakInFlight}/${workerLimit}.${reconcileWarning}`);
            }
            logRun(`Execution ${stopped ? 'stopped' : 'completed'}: ${stats.completed}/${numberTrades} processed over ${elapsedSeconds}s; ${successes} confirmed, ${rejected} failed, ${unconfirmed} unconfirmed, ${skipped} skipped, peak concurrency ${stats.peakInFlight}/${workerLimit}.${reconcileWarning}`);
        } catch (error) {
            stopRef.current = true;
            if (mountedRef.current && activeAccountRef.current === activeAccountId) {
                setStatus('stopped');
                setMessage(`Bulk execution stopped unexpectedly: ${messageFor(error)}. Check the Deriv account statement for outstanding purchases.`);
            }
            logRun(`Bulk execution stopped unexpectedly: ${messageFor(error)}.`);
        } finally {
            runRef.current = false;
            releaseBulkRun(activeAccountId);
            if (mountedRef.current && activeAccountRef.current === activeAccountId) setInFlight(0);
        }
    };

    const resetReport = () => {
        if (runRef.current) return;
        recordsRef.current = [];
        setRecords([]);
        setJournal([]);
        setProgress(0);
        setInFlight(0);
        setMessage('');
        setStatus('idle');
    };

    return (
        <section className={`bulk-trader${reportsOpen ? ' bulk-trader--reports-open' : ''}`} aria-label='Bulk Trader'>
            <div className='bulk-trader__top'>
                <div className='bulk-trader__report-toolbar'>
                    <div className='bulk-trader__report-title'>
                        <strong>Bulk Trader</strong>
                        <span>Independent from Bot Builder · {accountLabel}</span>
                    </div>
                    <button
                        type='button'
                        className='bulk-trader__report-toggle'
                        onClick={() => setReportsOpen(previous => !previous)}
                        aria-controls='bulk-reports-panel'
                        aria-expanded={reportsOpen}
                    >
                        <span aria-hidden='true'>▤</span>
                        {reportsOpen ? 'Hide reports' : 'View Summary / Transactions / Journal'}
                        <span aria-hidden='true'>{reportsOpen ? '›' : '‹'}</span>
                    </button>
                </div>
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
                        <input type='number' min='0.01' max={maxStake} step='0.01' disabled={isRunning} value={stake}
                            onChange={e => setStake(e.target.value)} />
                    </label>
                    <label>NO OF TRADES
                        <input type='number' min='1' max={maxOrders} step='1' disabled={isRunning} value={quantity}
                            onChange={e => setQuantity(e.target.value)} />
                    </label>
                </div>
                <div className='bulk-trader__total'>
                    <span>TOTAL STAKE</span>
                    <strong>{valid ? exposure.toFixed(2) : '—'} {currency}</strong>
                    <small>Intended maximum across {valid ? numberTrades : '—'} separate orders</small>
                </div>
                <p className='bulk-trader__trade-label'>Run bulk trades — these buttons only submit the selected Bulk Trader orders.</p>
                <div className='bulk-trader__buttons'>
                    {currentSelection.actions.map(([type, label], index) => (
                        <button key={type} type='button' className={index === 0 ? 'bulk-trader__buy-a' : 'bulk-trader__buy-b'}
                            disabled={isRunning || isPreflighting || !valid ||
                                numberTrades > maxOrders || stakeValue > maxStake ||
                                (isReal && exposure > REAL_LIMITS.batch) ||
                                (availableContracts && !availableContracts.has(type))}
                            title={availableContracts && !availableContracts.has(type) ? 'Not offered on this market' : ''}
                            onClick={() => begin(type, label)}>
                            {label}
                        </button>
                    ))}
                </div>
                {isRunning && <button className='bulk-trader__stop' type='button' onClick={stop}>
                    Stop bulk orders ({progress}/{quantity} processed; {inFlight} in flight)
                </button>}
                {isReal && !isSimulated && <p className='bulk-trader__notice' role='alert'>
                    REAL MONEY: orders debit the selected account. Limits: {REAL_LIMITS.trades} trades,
                    {REAL_LIMITS.stake} {currency} per trade, {REAL_LIMITS.batch} {currency} per batch,
                    at most {REAL_LIMITS.percent * 100}% of freshly verified balance. Orders already sent cannot be recalled.
                </p>}
                {accountMode === 'unavailable' && <p className='bulk-trader__notice' role='status'>
                    Account verification is unavailable. Press a trade button to see the reason;
                    reconnect your Deriv account if necessary. No purchase is sent until the
                    account and WebSocket are verified.
                </p>}
                {!valid && <p className='bulk-trader__notice' role='status'>
                    Check stake, number of trades, duration, history ticks and prediction.
                </p>}
                {availableContracts && currentSelection.actions.every(([type]) => !availableContracts.has(type)) &&
                    <p className='bulk-trader__notice' role='status'>
                        Neither contract is offered on the selected market. Choose another market or trade type.
                    </p>}
                {message && <p className='bulk-trader__feedback' role='status'>{message}</p>}
            </div>

            <BulkReports records={records} journal={journal} accountId={activeAccountId}
                currency={currency} balance={client?.balance} isRunning={isRunning}
                onReset={resetReport} reportsOpen={reportsOpen} onReportsToggle={setReportsOpen} />
        </section>
    );
});

export default BulkTrader;

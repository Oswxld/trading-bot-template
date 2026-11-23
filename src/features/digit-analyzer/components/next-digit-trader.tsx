import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import {
    getAdminTestAccounts,
    getAdminTestBalances,
    isAdminTestActive,
    isAdminTestRequested,
    isAdminTestSessionReady,
    TEST_DEMO_ID,
    TEST_REAL_ID,
} from '@/services/admin-test-kit';
import { acquireBulkRun, releaseBulkRun } from '@/pages/bulk-trader/bulk-request-safety';
import { makePendingBulkRecord, recoverInterruptedBulkRecords, upsertBulkRecord } from '@/pages/bulk-trader/bulk-trade-records';
import BulkReports from '@/pages/bulk-trader/bulk-reports';
import { placeNextDigitMatch, preflightNextDigitAccount } from '../services/next-digit-order';
import type { NextDigitPrediction } from '../services/next-digit-transition';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

type AccountMode = 'real' | 'demo' | 'unavailable';
type Account = {
    id: string;
    mode: AccountMode;
    currency: string;
    verified: boolean;
    simulated: boolean;
    reason: string;
};
type TradeRecord = { contractId: string; digit: number; symbol: string; price: number; profit: number; status: string; at: number };
type ReportRow = {
    localId: string;
    number: number;
    timestamp: number;
    contractId: string | null;
    symbol: string;
    symbolName: string;
    contractType: string;
    prediction: string | null;
    price: number | null;
    status: string;
    profit: number | null;
    payout: number | null;
    entrySpot: number | string | null;
    exitSpot: number | string | null;
    reason?: string;
    reconciled?: boolean;
};
type JournalRow = { id: number; timestamp: number; message: string };
type RunState = {
    id: string;
    mode: Exclude<AccountMode, 'unavailable'>;
    simulated: boolean;
    currency: string;
    symbol: string;
    running: boolean;
    busy: boolean;
    locked: boolean;
    lastTickId: string;
    count: number;
    profit: number;
    losses: number;
    stake: number;
    limit: number;
    stopLoss: number;
};
const emptyAccount: Account = { id: '', mode: 'unavailable', currency: '', verified: false, simulated: false, reason: 'Log in with Deriv to enable trading.' };
const historyKey = (id: string) => `next-digit:history:${id}`;
const blockedKey = (id: string) => `next-digit:unconfirmed:${id}`;
const reportsKey = (id: string) => `next-digit:reports:${id}`;
const journalKey = (id: string) => `next-digit:journal:${id}`;
const readReportRows = (id: string, recover = false): ReportRow[] => {
    if (!id) return [];
    try {
        const result = JSON.parse(sessionStorage.getItem(reportsKey(id)) || '[]');
        return Array.isArray(result) ? (recover ? recoverInterruptedBulkRecords(result) : result).slice(0, 200) : [];
    } catch { return []; }
};
const readJournal = (id: string): JournalRow[] => {
    try {
        const result = JSON.parse(sessionStorage.getItem(journalKey(id)) || '[]');
        return Array.isArray(result) ? result.slice(0, 200) : [];
    } catch { return []; }
};
let nextJournalId = Date.now();
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Deriv request could not be completed.';
const readHistory = (id: string): TradeRecord[] => {
    if (!id) return [];
    try {
        const value = JSON.parse(sessionStorage.getItem(historyKey(id)) || '[]');
        return Array.isArray(value) ? value.slice(0, 30) : [];
    } catch { return []; }
};
const storeHistory = (id: string, record: TradeRecord) => {
    try {
        sessionStorage.setItem(historyKey(id), JSON.stringify([record, ...readHistory(id)].slice(0, 30)));
    } catch { /* Disabled browser storage must never change broker outcomes. */ }
};

/** Broker-backed accounts and explicitly authenticated local simulations are separate. */
const readAccount = (): Account => {
    if (typeof window === 'undefined') return emptyAccount;
    const id = localStorage.getItem('active_loginid') || '';
    if (isAdminTestActive()) {
        // These are the ONLY two simulated IDs. Never decide simulation from
        // a CR/VRT prefix, a cached balance, or an unverified browser flag.
        const allowed = id === TEST_DEMO_ID || id === TEST_REAL_ID;
        const mock = api_base.api as (typeof api_base.api & {
            isAdminSimulation?: boolean;
            simulatedAccountId?: string;
        }) | null;
        const account = allowed ? getAdminTestAccounts().find(item => item.account_id === id) : null;
        const verified = Boolean(account && mock?.isAdminSimulation === true &&
            mock.simulatedAccountId === id && isAdminTestSessionReady(api_base));
        return {
            id: allowed ? id : '',
            mode: account?.account_type ?? 'unavailable',
            currency: account?.currency ?? '',
            verified,
            simulated: true,
            reason: verified
                ? 'Admin Test Kit simulated account connected. Orders and balances are simulated; analysis uses real public Deriv ticks.'
                : 'Connecting to the authenticated Admin Test Kit simulator. No broker orders will be sent.',
        };
    }
    // When a Test Kit login has been requested but not verified, NEVER fall
    // through to a genuine broker socket or reuse cached Deriv OAuth data.
    if (isAdminTestRequested()) {
        return { ...emptyAccount, simulated: true,
            reason: 'Admin Test Kit session is not authenticated or balance sync is not ready. No trading allowed.' };
    }
    if ((api_base.api as (typeof api_base.api & { isAdminSimulation?: boolean }) | null)?.isAdminSimulation) {
        return { ...emptyAccount, reason: 'Simulated socket is still active. Reconnect to Deriv OAuth.' };
    }
    const connected = Boolean(id && api_base.is_authorized &&
        api_base.account_id === id &&
        (api_base.account_info as { loginid?: string }).loginid === id &&
        api_base.api?.connection?.readyState === 1);
    const account = DerivWSAccountsService.getStoredAccounts()?.find(item => item.account_id === id);
    const liveInfo = api_base.account_info as { loginid?: string; is_virtual?: number | boolean; currency?: string };
    const socketMode = connected && liveInfo.is_virtual !== undefined
        ? (liveInfo.is_virtual === 1 || liveInfo.is_virtual === true ? 'demo' : 'real') : 'unavailable';
    const mode: AccountMode = account?.account_type === 'real' || account?.account_type === 'demo'
        ? account.account_type : socketMode;
    const currency = account?.currency || (connected ? liveInfo.currency : '') || '';
    const verified = connected && mode !== 'unavailable' && !!currency;
    return {
        id, mode, currency, verified, simulated: false,
        reason: !id ? 'Log in with Deriv first.' :
            !connected ? 'Waiting for the selected Deriv Options account to authenticate.' :
            mode === 'unavailable' ? 'Account type not verified. Reconnect Deriv OAuth.' :
            'Connected to the selected Deriv Options account.',
    };
};

const NextDigitTrader = ({
    symbol, marketName, prediction, latestTick, tickStatus,
}: {
    symbol: string;
    marketName: string;
    prediction: NextDigitPrediction | null;
    latestTick: AnalyzerTick | null;
    tickStatus: string;
}) => {
    const [account, setAccount] = useState<Account>(readAccount);
    const [stake, setStake] = useState('0.50');
    const [maxTrades, setMaxTrades] = useState('5');
    const [stopLoss, setStopLoss] = useState('2.50');
    const [status, setStatus] = useState('Analysis only. Automatic trading is OFF. Press Run to see account checks and reports.');
    const [running, setRunning] = useState(false);
    const [arming, setArming] = useState(false);
    const [summary, setSummary] = useState({ count: 0, profit: 0 });
    const [history, setHistory] = useState<TradeRecord[]>(() => readHistory(readAccount().id));
    const [reportsOpen, setReportsOpen] = useState(false);
    const [records, setRecords] = useState<ReportRow[]>(() => readReportRows(readAccount().id, true));
    const [journal, setJournal] = useState<JournalRow[]>(() => readJournal(readAccount().id));
    const [blocked, setBlocked] = useState(() =>
        typeof window !== 'undefined' ? sessionStorage.getItem(blockedKey(readAccount().id)) || '' : ''
    );
    const mountedRef = useRef(true);
    const latestRef = useRef(latestTick);
    latestRef.current = latestTick;
    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;
    const runRef = useRef<RunState | null>(null);
    const armingRef = useRef(false);
    const reportsRef = useRef<HTMLDivElement>(null);
    const report = (id: string, entry: ReportRow) => {
        if (!id) return;
        const rows = upsertBulkRecord(readReportRows(id), entry, 200) as ReportRow[];
        try { sessionStorage.setItem(reportsKey(id), JSON.stringify(rows)); } catch { /* storage may be full */ }
        if (mountedRef.current && readAccount().id === id) setRecords(rows);
    };
    const log = (id: string, message: string) => {
        const entry = { id: ++nextJournalId, timestamp: Date.now(), message };
        const rows = [entry, ...readJournal(id)].slice(0, 200);
        try { sessionStorage.setItem(journalKey(id), JSON.stringify(rows)); } catch { /* storage may be full */ }
        if (mountedRef.current && readAccount().id === id) setJournal(rows);
    };

    useEffect(() => {
        if (!reportsOpen) return;
        // Show the three tabs immediately on desktop and small screens without
        // requiring a second click or hunting below the auto-trade form.
        if (typeof window.requestAnimationFrame !== 'function') return;
        const frame = window.requestAnimationFrame(() => {
            if (typeof reportsRef.current?.scrollIntoView === 'function') {
                reportsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [reportsOpen]);

    const finish = (run: RunState, reason: string) => {
        run.running = false;
        if (mountedRef.current) {
            setRunning(false);
            setStatus(reason);
        }
        if (!run.busy && run.locked) {
            releaseBulkRun(run.id);
            run.locked = false;
            if (runRef.current === run) runRef.current = null;
        }
    };
    const safeSocket = (id: string, currency: string, api: NonNullable<typeof api_base.api>,
        simulated: boolean) => {
        const current = readAccount();
        if (!current.verified || current.simulated !== simulated ||
            current.id !== id || current.currency !== currency ||
            api_base.api !== api || api_base.account_id !== id ||
            api.connection?.readyState !== 1 || api_base.is_running) return false;
        const socket = api as typeof api & { isAdminSimulation?: boolean; simulatedAccountId?: string };
        if (simulated) {
            return isAdminTestSessionReady(api_base) && socket.isAdminSimulation === true &&
                socket.simulatedAccountId === id &&
                (id === TEST_DEMO_ID || id === TEST_REAL_ID);
        }
        return !isAdminTestRequested() && !isAdminTestActive() &&
            socket.isAdminSimulation !== true && api_base.is_authorized;
    };

    // The selected account can change without navigation (header switcher).
    useEffect(() => {
        const refresh = () => {
            const next = readAccount();
            setAccount(previous =>
                previous.id === next.id && previous.mode === next.mode &&
                previous.simulated === next.simulated &&
                previous.currency === next.currency && previous.verified === next.verified &&
                previous.reason === next.reason ? previous : next
            );
        };
        refresh();
        const timer = setInterval(refresh, 1000);
        window.addEventListener('storage', refresh);
        return () => { clearInterval(timer); window.removeEventListener('storage', refresh); };
    }, []);

    // Some valid OAuth sessions restore the authenticated trading socket
    // before sessionStorage's account-type list. Populate it from Deriv REST
    // rather than making Run permanently unavailable or guessing from an ID.
    useEffect(() => {
        let canceled = false;
        let inFlight = false;
        const hydrateAccount = async () => {
            if (canceled || inFlight || isAdminTestRequested() || isAdminTestActive()) return;
            const id = localStorage.getItem('active_loginid') || '';
            if (!id || !api_base.is_authorized || api_base.account_id !== id ||
                api_base.api?.connection?.readyState !== 1 || readAccount().verified) return;
            const token = OAuthTokenExchangeService.getAccessToken();
            if (!token) return;
            inFlight = true;
            try {
                await DerivWSAccountsService.fetchAccountsList(token);
                if (!canceled) setAccount(readAccount());
            } catch { /* Run will display the explicit authentication error. */ }
            finally { inFlight = false; }
        };
        void hydrateAccount();
        const retry = setInterval(() => { void hydrateAccount(); }, 6000);
        return () => { canceled = true; clearInterval(retry); };
    }, []);

    useEffect(() => {
        const current = runRef.current;
        if (current && (current.id !== account.id || current.symbol !== symbol ||
            current.simulated !== account.simulated || current.mode !== account.mode || !account.verified)) {
            finish(current, 'Account, market or authentication changed. No new purchases will be sent.');
        }
        setHistory(readHistory(account.id));
        setRecords(readReportRows(account.id, true));
        setJournal(readJournal(account.id));
        setBlocked(account.id ? sessionStorage.getItem(blockedKey(account.id)) || '' : '');
        setSummary({ count: 0, profit: 0 });
        // Account/market changes invalidate running instructions even between ticks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account.id, account.verified, account.mode, account.simulated, symbol]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            const current = runRef.current;
            if (current) finish(current, 'Analysis closed. No further purchases.');
        };
        // Cleanup is a safety stop only; never reacquire a live trade on remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stop = () => {
        const current = runRef.current;
        if (current) {
            log(current.id, 'STOP requested. No new purchases; already purchased contracts still need settlement.');
            finish(current, 'Stopped. Any submitted order may still settle on Deriv; check its statement.');
        }
    };

    const resetReports = () => {
        if (running || arming) return;
        try {
            sessionStorage.removeItem(reportsKey(account.id));
            sessionStorage.removeItem(journalKey(account.id));
        } catch { /* local history may be unavailable */ }
        setRecords([]);
        setJournal([]);
        setStatus('Local reports cleared. No broker contracts or statements were changed.');
    };

    const start = async () => {
        // Run always opens the familiar reports immediately, including failed preflight.
        setReportsOpen(true);
        const runError = (message: string) => {
            setStatus(message);
            log(readAccount().id, message);
        };
        if (armingRef.current || runRef.current?.busy || runRef.current?.running) {
            runError('The previous run is still active or reconciling a contract.');
            return;
        }
        log(readAccount().id, 'Run requested: validating the selected Deriv account and risk limits.');
        const amount = Number(stake);
        const limit = Number(maxTrades);
        const maxLoss = Number(stopLoss);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000 ||
            !Number.isInteger(limit) || limit < 1 || limit > 50 ||
            !Number.isFinite(maxLoss) || maxLoss <= 0 || maxLoss > 50000 ||
            maxLoss < amount) {
            runError('Enter a stake (0–1000), 1–50 trades and a loss stop at least equal to one stake.');
            return;
        }
        if (!symbol) {
            runError('Select an available Deriv market before running the auto trader.');
            return;
        }
        // Run can arm while the read-only history and tick stream are loading.
        // Purchases remain disabled until a NEW verified live tick and prediction arrive.
        // A simulated account may need to recreate its local-only mock socket
        // after a reload. Never use OAuth or a genuine socket for this recovery.
        if (isAdminTestRequested()) {
            if (!isAdminTestActive()) {
                runError('Admin Test Kit authentication or balance synchronization is not ready.');
                return;
            }
            if (!isAdminTestSessionReady(api_base)) {
                setArming(true);
                setStatus('Initializing the Admin Test Kit simulated account…');
                try {
                    if (!await api_base.ensureAdminTestSession()) {
                        runError('Simulated account could not connect. Re-enter Admin Test Kit and retry.');
                        return;
                    }
                } catch (error) {
                    runError('Admin Test Kit initialization failed: ' + messageOf(error));
                    return;
                } finally {
                    if (mountedRef.current) setArming(false);
                }
            }
        }
        const current = readAccount();
        if (!current.verified || current.mode === 'unavailable') {
            runError(current.reason);
            return;
        }
        if (readReportRows(current.id).some(row => !row.reconciled && (row.status === 'buying' || row.status === 'unconfirmed')) &&
            !sessionStorage.getItem(blockedKey(current.id))) {
            try { sessionStorage.setItem(blockedKey(current.id), 'An earlier purchase may not have confirmed. Check the Deriv statement before trading again.'); } catch { /* keep blocked in UI */ }
        }
        if (sessionStorage.getItem(blockedKey(current.id))) {
            runError('An unconfirmed purchase requires statement reconciliation first.');
            setBlocked(sessionStorage.getItem(blockedKey(current.id)) || '');
            return;
        }
        const api = api_base.api;
        if (!api || !safeSocket(current.id, current.currency, api, current.simulated)) {
            runError('Selected Deriv account is not connected, or another bot is running.');
            return;
        }
        // Show the real-money authorization dialog directly from the user's
        // click. Browsers can suppress native confirms invoked after awaited
        // broker requests, leaving Run apparently inactive.
        const accepted = current.simulated || window.confirm(
            `ENABLE AUTHENTICATED DERIV AUTO TRADING\n\n` +
            `Account: ${current.id} (${current.mode.toUpperCase()})\n` +
            `Market: ${marketName} (${symbol})\n` +
            `Contract: 1-tick DIGIT MATCHES from live next-digit transition analysis\n` +
            `Stake: ${amount.toFixed(2)} ${current.currency} per purchase\n` +
            `Maximum trades: ${limit} (max gross stake ${(amount * limit).toFixed(2)} ${current.currency})\n` +
            `Loss stop: ${maxLoss.toFixed(2)} ${current.currency}\n\n` +
            `No win rate is guaranteed. This places ACTUAL Deriv orders on the selected ${current.mode} account. Continue?`
        );
        if (!accepted) {
            setStatus('Run canceled. No purchases sent.');
            log(current.id, 'User declined automatic trading authorization.');
            return;
        }
        log(current.id, current.simulated
            ? 'Admin Test Kit paper trading requested. No real broker purchases will be placed.'
            : 'User confirmed automatic trading for the selected broker account.');
        armingRef.current = true;
        setArming(true);
        setStatus(current.simulated
            ? 'Verifying Admin Test Kit mock contracts and simulated account balance…'
            : 'Verifying Deriv account, contract availability and available balance…');
        log(current.id, `Preflight: ${current.mode.toUpperCase()} ${current.id}, ${marketName}, maximum ${limit} trades at ${amount.toFixed(2)} ${current.currency}.`);
        try {
            if (current.simulated) {
                // Admin Test Kit has a Supabase-authenticated local transport.
                // It must never fetch/require a Deriv OAuth token.
                if (!isAdminTestSessionReady(api_base) ||
                    !getAdminTestAccounts().some(row => row.account_id === current.id &&
                        row.account_type === current.mode && row.currency === current.currency)) {
                    throw new Error('Admin Test Kit account or simulated socket was not verified.');
                }
            } else {
                const token = OAuthTokenExchangeService.getAccessToken();
                if (!token) throw new Error('Deriv OAuth session is missing. Please sign in again.');
                const fresh = await DerivWSAccountsService.fetchAccountsList(token);
                const verified = fresh.find(item => item.account_id === current.id);
                if (!verified || verified.account_type !== current.mode ||
                    verified.currency !== current.currency) {
                    throw new Error('Selected account type/currency could not be verified with Deriv.');
                }
            }
            await preflightNextDigitAccount({
                api, symbol, accountId: current.id, currency: current.currency,
                stake: amount, maxTrades: limit,
                canSend: () => safeSocket(current.id, current.currency, api, current.simulated) &&
                    symbolRef.current === symbol,
            });
            if (!safeSocket(current.id, current.currency, api, current.simulated) || symbolRef.current !== symbol) {
                throw new Error('Account or market changed during verification. No trading started.');
            }
            if (!acquireBulkRun(current.id)) {
                throw new Error('Bulk Trader or another trader is already active on this account.');
            }
            const run: RunState = {
                id: current.id, mode: current.mode, simulated: current.simulated,
                currency: current.currency,
                symbol, running: true, busy: false, locked: true,
                lastTickId: latestRef.current?.id || '',
                count: 0, profit: 0, losses: 0,
                stake: amount, limit, stopLoss: maxLoss,
            };
            runRef.current = run;
            setRunning(true);
            setSummary({ count: 0, profit: 0 });
            const accountLabel = current.simulated ? `SIMULATED ${current.mode.toUpperCase()}`
                : current.mode.toUpperCase();
            setStatus(`RUNNING on ${accountLabel} ${current.id}. Waiting for a fresh LIVE Deriv tick prediction.`);
            log(current.id, `AUTO TRADE RUNNING. ${current.simulated
                ? 'Real Deriv public ticks drive predictions; paper orders use Admin Test Kit balances and adjustable win probability. No live broker purchases.'
                : 'Predictions and purchases use genuine Deriv data and an authenticated broker account.'} Max ${limit} trades.`);
        } catch (error) {
            setStatus(messageOf(error));
            log(current.id, `Run could not start: ${messageOf(error)}`);
        } finally {
            armingRef.current = false;
            if (mountedRef.current) setArming(false);
        }
    };

    // Each fresh, genuine tick is considered once. Never trade historical
    // snapshot ticks, pre-Start ticks or a re-render of the same observation.
    useEffect(() => {
        const run = runRef.current;
        if (!run?.running || run.busy || !prediction || prediction.status !== 'ready' ||
            tickStatus !== 'streaming' || !latestTick ||
            latestTick.id === run.lastTickId) return;
        run.lastTickId = latestTick.id;
        if (!latestTick.id.startsWith(`${symbol}:`) ||
            latestTick.digit !== prediction.entryDigit ||
            prediction.nextDigit === null ||
            Date.now() - latestTick.epoch * 1000 > 5000 ||
            symbol !== run.symbol || !account.verified || account.id !== run.id ||
            account.simulated !== run.simulated) return;

        const api = api_base.api;
        if (!api || !safeSocket(run.id, run.currency, api, run.simulated)) {
            finish(run, 'Deriv account/socket changed. Trading halted.');
            return;
        }
        const candidate = prediction.nextDigit;
        run.busy = true;
        const pending = makePendingBulkRecord({
            localId: `next-digit:${run.id}:${latestTick.id}:${Date.now()}`,
            number: run.count + 1,
            symbol: run.symbol,
            symbolName: marketName,
            contractType: 'Matches',
            prediction: String(candidate),
        }) as ReportRow;
        report(run.id, pending);
        log(run.id, `LIVE DERIV SIGNAL: digit ${latestTick.digit} → candidate ${candidate}. Requesting a ${run.simulated ? 'paper Matches' : 'Deriv Matches'} quote.`);
        setReportsOpen(true);
        setStatus(`Live Deriv tick ${latestTick.digit} → ${candidate}. Requesting ${run.simulated ? 'simulated' : 'broker'} one-tick Matches proposal…`);
        const canObserve = () => safeSocket(run.id, run.currency, api, run.simulated);
        // A Deriv quote takes network time. Requiring the SAME latest-tick ID
        // when buying caused nearly every one-second-market order to expire
        // before sending. The frozen signal must instead still be recent, and
        // the market/account/session must be unchanged. The actual contract
        // applies to the next tick AFTER Deriv accepts the buy.
        const canBuy = () => run.running && canObserve() && symbolRef.current === run.symbol &&
            latestRef.current !== null &&
            Date.now() - latestTick.epoch * 1000 <= 5000;
        void (async () => {
            try {
                const result = await placeNextDigitMatch({
                    api, symbol: run.symbol, accountId: run.id,
                    currency: run.currency, digit: candidate, stake: run.stake,
                    canBuy, canObserve,
                    onProposal: ({ price }: { price: number }) => {
                        report(run.id, { ...pending, status: 'buying', price });
                        log(run.id, `${run.simulated ? 'SIMULATED quote' : 'Deriv quote'} ${price.toFixed(2)} ${run.currency} for Matches ${candidate}. Sending ${run.simulated ? 'paper' : 'broker'} purchase.`);
                    },
                    onBought: ({ contractId, price }: { contractId: string; price: number }) => {
                        report(run.id, { ...pending, status: 'open', contractId, price });
                        log(run.id, `${run.simulated ? 'PAPER BUY CONFIRMED' : 'BUY CONFIRMED'}: contract #${contractId}; ${price.toFixed(2)} ${run.currency}. Awaiting ${run.simulated ? 'Admin Test Kit' : 'Deriv'} settlement.`);
                    },
                });
                const saved = readReportRows(run.id).find(row => row.localId === pending.localId) ?? pending;
                report(run.id, {
                    ...saved, contractId: result.contractId, price: result.price,
                    profit: result.profit, status: result.status,
                    entrySpot: result.entrySpot, exitSpot: result.exitSpot,
                    payout: Math.max(0, result.price + result.profit),
                });
                log(run.id, `${run.simulated ? 'SIMULATED SETTLEMENT' : 'DERIV SETTLEMENT'} #${result.contractId}: ${result.status.toUpperCase()}, net ${result.profit >= 0 ? '+' : ''}${result.profit.toFixed(2)} ${run.currency} (${run.simulated ? 'Admin Test Kit win/loss slider controls simulated outcomes' : 'broker-confirmed'}).`);
                const record: TradeRecord = { ...result, at: Date.now() };
                storeHistory(run.id, record);
                run.count += 1;
                run.profit += result.profit;
                run.losses = result.profit < 0 ? run.losses + 1 : 0;
                if (mountedRef.current && account.id === run.id) {
                    setHistory(readHistory(run.id));
                    setSummary({ count: run.count, profit: run.profit });
                    setStatus(`Contract ${result.contractId}: ${result.status.toUpperCase()} (${result.profit >= 0 ? '+' : ''}${result.profit.toFixed(2)} ${run.currency}).`);
                }
                if (run.count >= run.limit || run.profit <= -run.stopLoss || run.losses >= 3) {
                    finish(run, `Session ended: ${run.count} trades, net ${run.profit.toFixed(2)} ${run.currency}.`);
                }
            } catch (error) {
                if (error instanceof Error && 'staleSignal' in error && run.running && canObserve()) {
                    report(run.id, { ...pending, status: 'skipped', reason: error.message });
                    log(run.id, 'Signal expired before the buy. No purchase submitted; awaiting another live tick.');
                    if (mountedRef.current) setStatus('Quote arrived after the signal expired. No purchase sent; waiting for the next live tick.');
                    return;
                }
                const uncertain = error !== null && typeof error === 'object' &&
                    'unconfirmed' in error && error.unconfirmed === true;
                const saved = readReportRows(run.id).find(row => row.localId === pending.localId) ?? pending;
                report(run.id, { ...saved, status: uncertain ? 'unconfirmed' : 'failed', reason: messageOf(error) });
                log(run.id, `${uncertain ? 'UNCONFIRMED ORDER — MANUAL RECONCILIATION REQUIRED' : 'Trade halted'}: ${messageOf(error)}`);
                if (uncertain) {
                    try { sessionStorage.setItem(blockedKey(run.id), messageOf(error)); } catch { /* still halt */ }
                    if (mountedRef.current && account.id === run.id) setBlocked(messageOf(error));
                }
                finish(run, uncertain
                    ? `STOPPED — UNCONFIRMED ORDER: ${messageOf(error)}`
                    : `Stopped without another purchase: ${messageOf(error)}`);
            } finally {
                run.busy = false;
                if (!run.running && run.locked) {
                    releaseBulkRun(run.id);
                    run.locked = false;
                    if (runRef.current === run) runRef.current = null;
                }
            }
        })();
        // Always re-run only for a fresh tick or account/market change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [latestTick?.id, prediction?.nextDigit, prediction?.entryDigit, tickStatus, account.id, account.verified, symbol]);

    const acknowledge = () => {
        if (!account.id || !window.confirm(
            'Only clear this block AFTER checking your Deriv account statement and reconciling any pending order. Continue?'
        )) return;
        // Acknowledgement must persist on the unsettled rows as well: otherwise
        // the next Run would immediately recreate the lock from old 'buying' rows.
        const rows = readReportRows(account.id).map(row =>
            (row.status === 'buying' || row.status === 'unconfirmed')
                ? { ...row, status: 'unconfirmed', reconciled: true, reason: row.reason || 'Statement manually reconciled by user; no settlement inferred.' }
                : row
        );
        try { sessionStorage.setItem(reportsKey(account.id), JSON.stringify(rows)); } catch { /* block key is still cleared */ }
        setRecords(rows);
        sessionStorage.removeItem(blockedKey(account.id));
        setBlocked('');
        setStatus('Statement reconciliation acknowledged. Trading remains OFF until you press Start.');
        log(account.id, 'User acknowledged Deriv account statement reconciliation. Unconfirmed order block cleared.');
    };

    return (
        <section className='digit-analyzer__next-trader' aria-label='Automated next-digit trading'>
            <div className='digit-analyzer__next-trader-header'>
                <div>
                    <h3>Auto trade · Next digit</h3>
                    <p>Predictions use genuine public Deriv ticks. Orders use either your authenticated broker account or the Admin Test Kit's isolated paper account.</p>
                </div>
                <span className={running ? 'digit-analyzer__auto-badge digit-analyzer__auto-badge--on' : 'digit-analyzer__auto-badge'}>
                    {running ? (account.simulated ? 'SIMULATED AUTO TRADING' : 'LIVE AUTO TRADING') : 'AUTO TRADING OFF'}
                </span>
            </div>
            <p className='digit-analyzer__auto-account'>
                Selected account: <strong>{account.verified
                    ? `${account.id} · ${account.simulated ? 'SIMULATED ' : ''}${account.mode.toUpperCase()} · ${account.currency}`
                    : account.reason}</strong>
                {' '}{account.simulated ? 'Switch simulated Real/Demo in Admin Test Kit. All orders, results and balances are simulated.' : 'Switch genuine Real/Demo Options accounts using the header account switcher.'}
            </p>
            <div className='digit-analyzer__auto-form'>
                <label>Stake per order <input aria-label='Auto-trade stake' type='number' min='0.01' max='1000' step='0.01'
                    value={stake} disabled={running || arming} onChange={event => setStake(event.target.value)} /></label>
                <label>Maximum trades <input aria-label='Maximum auto trades' type='number' min='1' max='50' step='1'
                    value={maxTrades} disabled={running || arming} onChange={event => setMaxTrades(event.target.value)} /></label>
                <label>Stop when net loss reaches <input aria-label='Auto-trade loss stop' type='number' min='0.01' step='0.01'
                    value={stopLoss} disabled={running || arming} onChange={event => setStopLoss(event.target.value)} /></label>
            </div>
            <div className='digit-analyzer__auto-actions'>
                <button type='button' onClick={() => void start()} aria-label='Run Auto Trader'>
                    {arming ? 'Verifying Deriv…' : 'Run Auto Trader'}
                </button>
                <button type='button' className='digit-analyzer__auto-stop' onClick={stop} disabled={!running}>Stop</button>
                <button type='button' className='digit-analyzer__auto-show-reports'
                    onClick={() => setReportsOpen(previous => !previous)}>
                    {reportsOpen ? 'Hide reports' : 'Show Summary / Transactions / Journal'}
                </button>
            </div>
            <div className='digit-analyzer__auto-click-feedback' aria-live='polite'>
                {reportsOpen ? 'REPORTS OPEN · Select Summary, Transactions or Journal below.' : 'Run opens your trade reports immediately, even before a Deriv signal arrives.'}
            </div>
            <div ref={reportsRef} className='digit-analyzer__auto-reports'>
                <BulkReports
                    records={records}
                    journal={journal}
                    accountId={account.id}
                    currency={account.currency || 'USD'}
                    balance={account.simulated && account.verified ? getAdminTestBalances()[account.id] : null}
                    isRunning={running || arming}
                    onReset={resetReports}
                    reportsOpen={reportsOpen}
                    onReportsToggle={setReportsOpen}
                    inline={true}
                    reportTitle='Next Digit Auto Trader Reports'
                    emptyMessage={status}
                    resetMessage={"Clear this auto trader account's local report? Deriv contracts and statements will not be changed."}
                />
            </div>
            <p aria-live='polite' className='digit-analyzer__auto-status'>{status}</p>
            {blocked && <div className='digit-analyzer__auto-warning'>
                <strong>Trading locked: unconfirmed purchase.</strong><p>{blocked}</p>
                <button type='button' onClick={acknowledge}>I checked my Deriv statement — clear block</button>
            </div>}
            <p className='digit-analyzer__auto-disclaimer'>
                {account.simulated
                    ? 'ADMIN TEST KIT: real public Deriv ticks are used for analysis, but every purchase, balance, and win/loss is fictional. The Admin Test Kit probability slider controls settlements; they do NOT measure prediction accuracy. No genuine Deriv trade is submitted.'
                    : 'LIVE DERIV: purchases, balances and settlements are broker-backed, not simulated. Past digit transitions do not establish a profitable predictive edge.'}
                {' '}One purchase at a time; no automatic purchase retries. Stops after 3 consecutive losses,
                your chosen loss threshold, or maximum trades. Trading stops if you leave this screen.
            </p>
            <div className='digit-analyzer__auto-summary'>
                <strong>Confirmed settlements: {summary.count}</strong>
                <strong>Net P/L: {summary.profit.toFixed(2)} {account.currency}</strong>
            </div>
            {history.length > 0 && !reportsOpen && <div className='digit-analyzer__auto-history'>
                <h4>Recent Deriv-confirmed trades · {account.id}</h4>
                <ul>{history.slice(0, 8).map(row =>
                    <li key={row.contractId}>
                        <span>{row.symbol} · Matches {row.digit} · #{row.contractId}</span>
                        <strong>{row.status.toUpperCase()} · {row.profit >= 0 ? '+' : ''}{row.profit.toFixed(2)} {account.currency}</strong>
                    </li>
                )}</ul>
            </div>}

        </section>
    );
};

export default NextDigitTrader;

import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { isAdminTestActive, isAdminTestRequested } from '@/services/admin-test-kit';
import { acquireBulkRun, releaseBulkRun } from '@/pages/bulk-trader/bulk-request-safety';
import { placeNextDigitMatch, preflightNextDigitAccount } from '../services/next-digit-order';
import type { NextDigitPrediction } from '../services/next-digit-transition';
import type { AnalyzerTick } from '../types/digit-analyzer.types';

type AccountMode = 'real' | 'demo' | 'unavailable';
type Account = { id: string; mode: AccountMode; currency: string; verified: boolean; reason: string };
type TradeRecord = { contractId: string; digit: number; symbol: string; price: number; profit: number; status: string; at: number };
type RunState = {
    id: string;
    mode: Exclude<AccountMode, 'unavailable'>;
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
const emptyAccount: Account = { id: '', mode: 'unavailable', currency: '', verified: false, reason: 'Log in with Deriv to enable trading.' };
const historyKey = (id: string) => `next-digit:history:${id}`;
const blockedKey = (id: string) => `next-digit:unconfirmed:${id}`;
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

/** Never infer the real/demo mode from a login prefix or a simulated account. */
const readAccount = (): Account => {
    if (typeof window === 'undefined') return emptyAccount;
    if (isAdminTestRequested() || isAdminTestActive() ||
        (api_base.api as (typeof api_base.api & { isAdminSimulation?: boolean }) | null)?.isAdminSimulation) {
        return { ...emptyAccount, reason: 'Admin Test Kit simulation is disabled for this live trader. Sign in with Deriv OAuth.' };
    }
    const id = localStorage.getItem('active_loginid') || '';
    const connected = Boolean(id && api_base.is_authorized &&
        api_base.account_id === id &&
        (api_base.account_info as { loginid?: string }).loginid === id &&
        api_base.api?.connection?.readyState === 1);
    const account = DerivWSAccountsService.getStoredAccounts()?.find(item => item.account_id === id);
    const mode = account?.account_type === 'real' || account?.account_type === 'demo'
        ? account.account_type : 'unavailable';
    const verified = connected && mode !== 'unavailable' && !!account?.currency;
    return {
        id, mode, currency: account?.currency || '', verified,
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
    const [status, setStatus] = useState('Analysis only. Automatic trading is OFF.');
    const [running, setRunning] = useState(false);
    const [arming, setArming] = useState(false);
    const [summary, setSummary] = useState({ count: 0, profit: 0 });
    const [history, setHistory] = useState<TradeRecord[]>(() => readHistory(readAccount().id));
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
    const safeSocket = (id: string, currency: string, api: NonNullable<typeof api_base.api>) => {
        const current = readAccount();
        return current.verified && current.id === id && current.currency === currency &&
            api_base.api === api && api_base.account_id === id &&
            api.connection?.readyState === 1 && !api_base.is_running;
    };

    // The selected account can change without navigation (header switcher).
    useEffect(() => {
        const refresh = () => {
            const next = readAccount();
            setAccount(previous =>
                previous.id === next.id && previous.mode === next.mode &&
                previous.currency === next.currency && previous.verified === next.verified &&
                previous.reason === next.reason ? previous : next
            );
        };
        refresh();
        const timer = setInterval(refresh, 1000);
        window.addEventListener('storage', refresh);
        return () => { clearInterval(timer); window.removeEventListener('storage', refresh); };
    }, []);

    useEffect(() => {
        const current = runRef.current;
        if (current && (current.id !== account.id || current.symbol !== symbol || !account.verified)) {
            finish(current, 'Account, market or authentication changed. No new purchases will be sent.');
        }
        setHistory(readHistory(account.id));
        setBlocked(account.id ? sessionStorage.getItem(blockedKey(account.id)) || '' : '');
        setSummary({ count: 0, profit: 0 });
        // Account/market changes invalidate running instructions even between ticks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account.id, account.verified, symbol]);

    useEffect(() => () => {
        mountedRef.current = false;
        const current = runRef.current;
        if (current) finish(current, 'Analysis closed. No further purchases.');
    }, []);

    const stop = () => {
        const current = runRef.current;
        if (current) finish(current, 'Stopped. Any submitted order may still settle on Deriv; check its statement.');
    };

    const start = async () => {
        if (armingRef.current || runRef.current?.busy || runRef.current?.running) return;
        const amount = Number(stake);
        const limit = Number(maxTrades);
        const maxLoss = Number(stopLoss);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000 ||
            !Number.isInteger(limit) || limit < 1 || limit > 50 ||
            !Number.isFinite(maxLoss) || maxLoss <= 0 || maxLoss > 50000 ||
            maxLoss < amount) {
            setStatus('Enter a stake (0–1000), 1–50 trades and a loss stop at least equal to one stake.');
            return;
        }
        if (!symbol || prediction?.status !== 'ready' || tickStatus !== 'streaming' ||
            !latestTick || !latestTick.id.startsWith(`${symbol}:`) ||
            Date.now() - latestTick.epoch * 1000 > 5000) {
            setStatus('Wait for a fresh, live Deriv tick and a next-digit result.');
            return;
        }
        const current = readAccount();
        if (!current.verified || current.mode === 'unavailable') {
            setStatus(current.reason);
            return;
        }
        if (sessionStorage.getItem(blockedKey(current.id))) {
            setStatus('An unconfirmed purchase requires statement reconciliation first.');
            setBlocked(sessionStorage.getItem(blockedKey(current.id)) || '');
            return;
        }
        const api = api_base.api;
        if (!api || !safeSocket(current.id, current.currency, api)) {
            setStatus('Selected Deriv account is not connected, or another bot is running.');
            return;
        }
        armingRef.current = true;
        setArming(true);
        setStatus('Verifying Deriv account, contract availability and available balance…');
        try {
            const token = OAuthTokenExchangeService.getAccessToken();
            if (!token) throw new Error('Deriv OAuth session is missing. Please sign in again.');
            // Check directly with Deriv REST; browser display data is insufficient
            // to authorize real-money purchases.
            const fresh = await DerivWSAccountsService.fetchAccountsList(token);
            const verified = fresh.find(item => item.account_id === current.id);
            if (!verified || verified.account_type !== current.mode || verified.currency !== current.currency) {
                throw new Error('Selected account type/currency could not be verified with Deriv.');
            }
            await preflightNextDigitAccount({
                api, symbol, accountId: current.id, currency: current.currency,
                stake: amount, maxTrades: limit,
                canSend: () => safeSocket(current.id, current.currency, api) &&
                    symbolRef.current === symbol,
            });
            if (!safeSocket(current.id, current.currency, api) || symbolRef.current !== symbol) {
                throw new Error('Account or market changed during verification. No trading started.');
            }
            const accepted = window.confirm(
                `ENABLE AUTOMATIC REAL DERIV API PURCHASES\n\n` +
                `Account: ${current.id} (${current.mode.toUpperCase()})\n` +
                `Market: ${marketName} (${symbol})\n` +
                `Contract: 1-tick DIGIT MATCHES from live next-digit transition analysis\n` +
                `Stake: ${amount.toFixed(2)} ${current.currency} per purchase\n` +
                `Maximum trades: ${limit} (max gross stake ${(amount * limit).toFixed(2)} ${current.currency})\n` +
                `Loss stop: ${maxLoss.toFixed(2)} ${current.currency}\n\n` +
                `No win rate is guaranteed. This places ACTUAL Deriv orders on the selected ${current.mode} account. Continue?`
            );
            if (!accepted) { setStatus('Not armed. No purchases sent.'); return; }
            if (!safeSocket(current.id, current.currency, api) || symbolRef.current !== symbol) {
                throw new Error('Account or market changed. Trading was not started.');
            }
            if (!acquireBulkRun(current.id)) {
                throw new Error('Bulk Trader or another trader is already active on this account.');
            }
            const run: RunState = {
                id: current.id, mode: current.mode, currency: current.currency,
                symbol, running: true, busy: false, locked: true,
                lastTickId: latestRef.current?.id || '',
                count: 0, profit: 0, losses: 0,
                stake: amount, limit, stopLoss: maxLoss,
            };
            runRef.current = run;
            setRunning(true);
            setSummary({ count: 0, profit: 0 });
            setStatus(`Armed on ${current.mode.toUpperCase()} ${current.id}. Waiting for NEW live tick signals.`);
        } catch (error) {
            setStatus(messageOf(error));
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
            symbol !== run.symbol || !account.verified || account.id !== run.id) return;

        const api = api_base.api;
        if (!api || !safeSocket(run.id, run.currency, api)) {
            finish(run, 'Deriv account/socket changed. Trading halted.');
            return;
        }
        const candidate = prediction.nextDigit;
        const signalId = latestTick.id;
        run.busy = true;
        setStatus(`Live ${latestTick.digit} → ${candidate}. Requesting a one-tick Matches proposal…`);
        const canObserve = () => safeSocket(run.id, run.currency, api);
        const canBuy = () => run.running && canObserve() && symbolRef.current === run.symbol &&
            latestRef.current?.id === signalId &&
            Date.now() - latestTick.epoch * 1000 <= 5000;
        void (async () => {
            try {
                const result = await placeNextDigitMatch({
                    api, symbol: run.symbol, accountId: run.id,
                    currency: run.currency, digit: candidate, stake: run.stake,
                    canBuy, canObserve,
                });
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
                const uncertain = error !== null && typeof error === 'object' &&
                    'unconfirmed' in error && error.unconfirmed === true;
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
        sessionStorage.removeItem(blockedKey(account.id));
        setBlocked('');
        setStatus('Statement reconciliation acknowledged. Trading remains OFF until you press Start.');
    };

    return (
        <section className='digit-analyzer__next-trader' aria-label='Automated next-digit trading'>
            <div className='digit-analyzer__next-trader-header'>
                <div>
                    <h3>Auto trade · Next digit</h3>
                    <p>Uses only the actual Deriv tick stream above and the currently authenticated Deriv Options account.</p>
                </div>
                <span className={running ? 'digit-analyzer__auto-badge digit-analyzer__auto-badge--on' : 'digit-analyzer__auto-badge'}>
                    {running ? 'LIVE AUTO TRADING' : 'AUTO TRADING OFF'}
                </span>
            </div>
            <p className='digit-analyzer__auto-account' role='status'>
                Selected account: <strong>{account.verified
                    ? `${account.id} · ${account.mode.toUpperCase()} · ${account.currency}`
                    : account.reason}</strong>
                {' '}Switch between your real and demo Options accounts using the header account switcher.
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
                <button type='button' onClick={() => void start()} disabled={running || arming || Boolean(blocked) ||
                    !account.verified || prediction?.status !== 'ready' || tickStatus !== 'streaming'}>
                    {arming ? 'Verifying Deriv…' : 'Start automatic trading'}
                </button>
                <button type='button' className='digit-analyzer__auto-stop' onClick={stop} disabled={!running}>Stop</button>
            </div>
            <p role='alert' className='digit-analyzer__auto-status'>{status}</p>
            {blocked && <div className='digit-analyzer__auto-warning'>
                <strong>Trading locked: unconfirmed purchase.</strong><p>{blocked}</p>
                <button type='button' onClick={acknowledge}>I checked my Deriv statement — clear block</button>
            </div>}
            <p className='digit-analyzer__auto-disclaimer'>
                Real and demo here mean actual Deriv Options accounts, never simulated Admin Test accounts.
                One purchase at a time; no automatic purchase retries. Stops after 3 consecutive losses,
                your chosen loss threshold, or maximum trades. Trading stops if you leave this screen.
                Past digit transitions do not establish a profitable predictive edge.
            </p>
            <div className='digit-analyzer__auto-summary'>
                <strong>Confirmed settlements: {summary.count}</strong>
                <strong>Net P/L: {summary.profit.toFixed(2)} {account.currency}</strong>
            </div>
            {history.length > 0 && <div className='digit-analyzer__auto-history'>
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

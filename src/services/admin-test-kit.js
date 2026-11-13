/**
 * LOCAL-ONLY simulated Deriv transport. Does not open any broker WebSocket,
 * use an OAuth token, or submit a real purchase. All amounts are fictional.
 * Used by BOTH Blockly Bot Builder and Bulk Trader through api_base.api.
 */
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { createAdminTestMarketFeed } from './admin-test-market-feed';

export const ADMIN_TEST_KEY = 'yolo:local-admin-test';
export const ADMIN_TEST_MANAGE_EVENT = 'yolo:admin-test-manage';
export const ADMIN_TEST_BACKUP = 'yolo:local-admin-backup';
export const TEST_DEMO_ID = 'VRTC_ADMIN_TEST';
export const TEST_REAL_ID = 'CR_ADMIN_TEST';
const STATE_KEY = 'yolo:local-admin-balances';
const WIN_PROBABILITY_KEY = 'yolo:local-admin-win-probability';
const CONTRACT_LEDGER_KEY = 'yolo:local-admin-contracts';
const CONTRACT_SERIAL_KEY = 'yolo:local-admin-contract-serial';
const REPORT_CLEAR_KEY = 'yolo:local-admin-report-clear';
const DEFAULT_WIN_PROBABILITY = 50;

export const isAdminTestAvailable = () =>
    typeof window !== 'undefined' &&
    /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/i.test(window.location.hostname);
export const isAdminTestActive = () =>
    isAdminTestAvailable() && sessionStorage.getItem(ADMIN_TEST_KEY) === 'active';

// The local-only flag alone must not authorize trading through a genuine broker.
export const isAdminTestTransportReady = apiBase => {
    if (!isAdminTestActive()) return false;
    const selected = localStorage.getItem('active_loginid');
    return (selected === TEST_DEMO_ID || selected === TEST_REAL_ID) &&
        apiBase?.api?.isAdminSimulation === true &&
        apiBase.api.simulatedAccountId === selected &&
        apiBase.api.connection?.readyState === 1;
};
export const isAdminTestSessionReady = apiBase =>
    isAdminTestTransportReady(apiBase) &&
    apiBase.is_authorized === true &&
    apiBase.account_id === localStorage.getItem('active_loginid') &&
    apiBase.account_info?.loginid === apiBase.account_id;

/** Percentage chance that any given SIMULATED contract settles as a win.
 * Both Bot Builder and Bulk Trader share this setting through the same transport.
 * Read on settlement so changes take effect without a reload.
 */
export const getAdminTestWinProbability = () => {
    if (!isAdminTestActive()) return DEFAULT_WIN_PROBABILITY;
    const stored = sessionStorage.getItem(WIN_PROBABILITY_KEY);
    if (stored === null) return DEFAULT_WIN_PROBABILITY;
    const value = Number(stored);
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : DEFAULT_WIN_PROBABILITY;
};

export const setAdminTestWinProbability = value => {
    if (!isAdminTestActive() || !Number.isInteger(value) || value < 0 || value > 100) return false;
    sessionStorage.setItem(WIN_PROBABILITY_KEY, String(value));
    return true;
};

const DEFAULT_BALANCES = { [TEST_DEMO_ID]: 10000, [TEST_REAL_ID]: 500 };
const readContractLedger = accountId => {
    try {
        const value = JSON.parse(sessionStorage.getItem(`${CONTRACT_LEDGER_KEY}:${accountId}`) || '[]');
        return Array.isArray(value) ? value.filter(c =>
            Number.isInteger(c?.contract_id) && c.contract_id > 0 &&
            (c.underlying_symbol || '') !== '' && c.transaction_ids?.buy
        ) : [];
    } catch { return []; }
};
/** Read only local paper contracts. Source tagging keeps Bot Builder's report
 * independent of Bulk Trader while both still share the account balance.
 * The sinceReportReset flag applies to Bot Builder's clear-statistics action,
 * not the broker-style statement or the underlying paper ledger.
 */
export const getAdminTestContracts = (accountId, { source = null, sinceReportReset = false } = {}) => {
    if (!isAdminTestActive() || !(accountId in DEFAULT_BALANCES)) return [];
    const clearThrough = sinceReportReset ?
        (Number(sessionStorage.getItem(`${REPORT_CLEAR_KEY}:${accountId}`)) || 0) : 0;
    return readContractLedger(accountId)
        .filter(contract =>
            (source === null || contract.source === source) &&
            Number(contract.contract_id) > clearThrough
        )
        .map(contract => ({
            ...contract,
            transaction_ids: { ...contract.transaction_ids },
        }));
};

export const markAdminTestBotReportCleared = accountId => {
    if (!isAdminTestActive() || !(accountId in DEFAULT_BALANCES)) return false;
    const maximum = getAdminTestContracts(accountId, { source: 'bot_builder' })
        .reduce((max, contract) => Math.max(max, Number(contract.contract_id)), 0);
    const previous = Number(sessionStorage.getItem(`${REPORT_CLEAR_KEY}:${accountId}`)) || 0;
    sessionStorage.setItem(`${REPORT_CLEAR_KEY}:${accountId}`, String(Math.max(maximum, previous)));
    return true;
};

const simulatedStatementRows = accountId => getAdminTestContracts(accountId).flatMap(contract => {
    const buy = {
        action_type: 'buy',
        amount: -Number(contract.buy_price),
        balance_after: contract.balance_after_buy,
        contract_id: contract.contract_id,
        currency: contract.currency || 'USD',
        longcode: 'LOCAL simulated contract only',
        payout: Number(contract.payout),
        purchase_price: Number(contract.buy_price),
        symbol: contract.underlying_symbol,
        transaction_id: contract.transaction_ids.buy,
        transaction_time: contract.purchase_time,
    };
    if (!contract.is_sold) return [buy];
    return [buy, {
        action_type: 'sell',
        amount: Number(contract.sell_price || 0),
        balance_after: contract.balance_after_sell,
        contract_id: contract.contract_id,
        currency: contract.currency || 'USD',
        payout: Number(contract.sell_price || 0),
        profit: Number(contract.profit),
        symbol: contract.underlying_symbol,
        transaction_id: contract.transaction_ids.sell,
        transaction_time: contract.sell_time,
    }];
}).sort((left, right) =>
    Number(right.transaction_time) - Number(left.transaction_time) ||
    Number(right.transaction_id) - Number(left.transaction_id)
);

const saveContractLedger = (accountId, contracts) => {
    // Open contracts must never be evicted. Bound completed history to avoid
    // overflowing session storage during long repeated-trading tests.
    const history = [...contracts.values()];
    const open = history.filter(c => !c.is_sold);
    const completed = history.filter(c => c.is_sold).slice(-300);
    sessionStorage.setItem(`${CONTRACT_LEDGER_KEY}:${accountId}`, JSON.stringify([...completed, ...open]));
};
const nextContractSerial = () => {
    const next = (Number(sessionStorage.getItem(CONTRACT_SERIAL_KEY)) || 0) + 1;
    sessionStorage.setItem(CONTRACT_SERIAL_KEY, String(next));
    return next;
};
const ACCOUNTS = [
    { account_id: TEST_DEMO_ID, account_type: 'demo', currency: 'USD', status: 'active' },
    { account_id: TEST_REAL_ID, account_type: 'real', currency: 'USD', status: 'active' },
];
const readBalances = () => {
    try {
        const stored = JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}');
        return Object.fromEntries(Object.entries(DEFAULT_BALANCES).map(([id, amount]) =>
            [id, Number.isFinite(Number(stored[id])) && Number(stored[id]) >= 0 ? Number(stored[id]) : amount]
        ));
    } catch { return { ...DEFAULT_BALANCES }; }
};
export const getAdminTestAccounts = () => {
    const balances = readBalances();
    return ACCOUNTS.map(account => ({ ...account, balance: balances[account.account_id].toFixed(2), group: 'test' }));
};
export const getAdminTestBalances = () => readBalances();
const saveBalance = (id, next) => {
    const balances = readBalances();
    balances[id] = Math.max(0, Math.round(next * 100) / 100);
    sessionStorage.setItem(STATE_KEY, JSON.stringify(balances));
    // Keep both accounts' displayed balances in sync with the paper ledger.
    sessionStorage.setItem('deriv_accounts', JSON.stringify(
        ACCOUNTS.map(account => ({
            ...account, balance: balances[account.account_id].toFixed(2), group: 'test',
        }))
    ));
};
export const setAdminTestBalance = (id, value) => {
    if (!isAdminTestActive() || !(id in DEFAULT_BALANCES)) return false;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return false;
    saveBalance(id, amount);
    return true;
};
const backup = (store, key) => store.getItem(key);
const restore = (store, key, value) => value === null ? store.removeItem(key) : store.setItem(key, value);

export const enterAdminTest = () => {
    if (!isAdminTestAvailable() || isAdminTestActive()) return false;
    const original = {
        accountId: backup(localStorage, 'active_loginid'),
        accountType: backup(localStorage, 'account_type'),
        derivAccounts: backup(sessionStorage, 'deriv_accounts'),
        authInfo: backup(sessionStorage, 'auth_info'),
    };
    sessionStorage.setItem(ADMIN_TEST_BACKUP, JSON.stringify(original));
    sessionStorage.setItem(STATE_KEY, JSON.stringify(DEFAULT_BALANCES));
    sessionStorage.setItem(WIN_PROBABILITY_KEY, String(DEFAULT_WIN_PROBABILITY));
    sessionStorage.removeItem(CONTRACT_SERIAL_KEY);
    for (const accountId of Object.keys(DEFAULT_BALANCES)) {
        sessionStorage.removeItem(`${CONTRACT_LEDGER_KEY}:${accountId}`);
        sessionStorage.removeItem(`${REPORT_CLEAR_KEY}:${accountId}`);
    }
    sessionStorage.setItem(ADMIN_TEST_KEY, 'active');
    sessionStorage.removeItem('auth_info');
    sessionStorage.setItem('deriv_accounts', JSON.stringify(getAdminTestAccounts()));
    localStorage.setItem('active_loginid', TEST_DEMO_ID);
    localStorage.setItem('account_type', 'demo');
    return true;
};
export const exitAdminTest = () => {
    if (!isAdminTestAvailable() || !isAdminTestActive()) return false;
    let previous = null;
    try { previous = JSON.parse(sessionStorage.getItem(ADMIN_TEST_BACKUP) || 'null'); } catch {}
    sessionStorage.removeItem(ADMIN_TEST_KEY);
    sessionStorage.removeItem(ADMIN_TEST_BACKUP);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(WIN_PROBABILITY_KEY);
    sessionStorage.removeItem(CONTRACT_SERIAL_KEY);
    for (const accountId of Object.keys(DEFAULT_BALANCES)) {
        sessionStorage.removeItem(`${CONTRACT_LEDGER_KEY}:${accountId}`);
        sessionStorage.removeItem(`${REPORT_CLEAR_KEY}:${accountId}`);
    }
    restore(localStorage, 'active_loginid', previous?.accountId ?? null);
    restore(localStorage, 'account_type', previous?.accountType ?? null);
    restore(sessionStorage, 'deriv_accounts', previous?.derivAccounts ?? null);
    restore(sessionStorage, 'auth_info', previous?.authInfo ?? null);
    return true;
};
export const switchAdminTestAccount = id => {
    if (!isAdminTestActive() || !(id in DEFAULT_BALANCES)) return false;
    localStorage.setItem('active_loginid', id);
    localStorage.setItem('account_type', id === TEST_DEMO_ID ? 'demo' : 'real');
    return true;
};

const CONTRACT_TYPES = ['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'CALL', 'PUT'];
const SYMBOLS = [
    ['R_100', 'Volatility 100 Index'],
    ['R_75', 'Volatility 75 Index'],
    ['R_50', 'Volatility 50 Index'],
    ['R_25', 'Volatility 25 Index'],
    ['R_10', 'Volatility 10 Index'],
    ['1HZ100V', 'Volatility 100 (1s) Index'],
    ['1HZ75V', 'Volatility 75 (1s) Index'],
    ['1HZ50V', 'Volatility 50 (1s) Index'],
    ['1HZ25V', 'Volatility 25 (1s) Index'],
    ['1HZ10V', 'Volatility 10 (1s) Index'],
].map(([symbol, display_name]) => ({
    symbol, underlying_symbol: symbol, display_name,
    market: 'synthetic_index', market_display_name: 'Derived',
    submarket: 'random_index', submarket_display_name: 'Continuous Indices',
    exchange_is_open: true, is_trading_suspended: false,
    // Both pip and pip_size represent the minimum price increment here.
    // Bot Builder converts 0.01 to 2 decimal places before evaluating digits.
    pip: 0.01, pip_size: 0.01,
}));

/**
 * Pick a simulated exit quote consistent with the chosen result so the
 * contract's displayed last digit / direction agrees with its win or loss.
 * Only applied inside the offline simulator; real Deriv quotes are untouched.
 */
const simulatedExitQuote = (contract, quote, shouldWin) => {
    const type = contract.contract_type;
    if (type === 'CALL' || type === 'PUT') {
        const direction = type === 'CALL' ? 1 : -1;
        return Number((contract.entry_tick + direction * (shouldWin ? 0.11 : -0.11)).toFixed(2));
    }

    const barrier = Number(contract.barrier ?? 5);
    const digitWins = digit => {
        if (type === 'DIGITMATCH') return digit === barrier;
        if (type === 'DIGITDIFF') return digit !== barrier;
        if (type === 'DIGITOVER') return digit > barrier;
        if (type === 'DIGITUNDER') return digit < barrier;
        if (type === 'DIGITEVEN') return digit % 2 === 0;
        if (type === 'DIGITODD') return digit % 2 !== 0;
        return null;
    };
    if (!type.startsWith('DIGIT')) return quote;
    const validDigits = Array.from({ length: 10 }, (_, digit) => digit)
        .filter(digit => digitWins(digit) === shouldWin);
    if (!validDigits.length) return quote; // Invalid/impossible barrier, never seen in a valid Deriv proposal.
    const digit = validDigits[Math.floor(Math.random() * validDigits.length)];
    return Number((Math.floor(quote * 10) / 10 + digit / 100).toFixed(2));
};

export const createAdminTestApi = () => {
    if (!isAdminTestActive()) throw new Error('Simulated API only exists in local admin test mode.');
    const accountId = localStorage.getItem('active_loginid');
    if (!(accountId in DEFAULT_BALANCES)) throw new Error('Choose a simulated account first.');
    const listeners = new Set();
    const socketListeners = { open: new Set(), close: new Set(), error: new Set() };
    const subscriptions = new Map();
    const proposals = new Map();
    const contracts = new Map(readContractLedger(accountId).map(c => [String(c.contract_id), c]));
    const activeTimers = new Set();
    let serial = 0;
    let closed = false;
    // Single clock per symbol. A subscription is a view of the shared feed,
    // not a separate source of randomly generated prices.
    const market = createAdminTestMarketFeed({
        emit: payload => emit(payload),
        subscriptions,
        onTick: tick => onMarketTick(tick),
    });
    const connection = {
        readyState: 0,
        addEventListener(event, callback) { socketListeners[event]?.add(callback); },
        removeEventListener(event, callback) { socketListeners[event]?.delete(callback); },
        send(raw) { return api.send(JSON.parse(raw)); },
        close() {
            if (closed) return;
            closed = true;
            connection.readyState = 3;
            for (const timer of activeTimers) clearTimeout(timer);
            activeTimers.clear();
            market.close();
            subscriptions.clear();
            for (const callback of [...socketListeners.close]) callback({ type: 'close' });
            listeners.clear();
        },
    };
    const openTimer = setTimeout(() => {
        if (closed) return;
        connection.readyState = 1;
        // Recover open simulated contracts after a mock WebSocket recreation.
        // Contract state and its reserved stake survived in sessionStorage.
        for (const contract of contracts.values()) {
            if (!contract.is_sold) market.retainSymbol(contract.underlying_symbol);
        }
        for (const callback of [...socketListeners.open]) callback({ type: 'open' });
    }, 35);
    activeTimers.add(openTimer);

    const emit = payload => {
        // A previous account's socket must never deliver its contracts,
        // ticks, or balance into the newly selected account's UI.
        if (closed || !isAdminTestActive() || localStorage.getItem('active_loginid') !== accountId) return;
        for (const callback of [...listeners]) callback({ data: payload });
    };
    const sendResponse = (request, response, msg_type) => {
        const message = { msg_type, req_id: request.req_id, echo_req: request, ...response };
        queueMicrotask(() => emit(message));
        return message;
    };
    const subscription = (kind, symbol = null, granularity = null) => {
        const id = `adm-sub-${++serial}`;
        subscriptions.set(id, { kind, symbol, granularity });
        if (kind === 'ticks' || kind === 'candles') market.subscriptionChanged(symbol);
        return { id };
    };
    const forgetSubscription = id => {
        const key = String(id);
        const sub = subscriptions.get(key);
        subscriptions.delete(key);
        if (sub?.kind === 'ticks' || sub?.kind === 'candles') market.subscriptionChanged(sub.symbol);
    };
    const currentBalance = () => ({
        loginid: accountId, account_id: accountId, currency: 'USD',
        balance: readBalances()[accountId],
    });
    const broadcastBalance = () => {
        const client = globalObserver.getState('client.store');
        if (client?.loginid === accountId) {
            client.setBalance(String(readBalances()[accountId]));
            client.setAccountList(getAdminTestAccounts().map(account => ({
                loginid: account.account_id,
                is_virtual: account.account_type === 'demo' ? 1 : 0,
                currency: account.currency,
                balance: Number(account.balance),
            })));
        }
        emit({ msg_type: 'balance', balance: currentBalance() });
    };
    const contractSnapshot = contract => ({
        ...contract,
        transaction_ids: { ...contract.transaction_ids },
    });
    const broadcastContract = contract => {
        emit({ msg_type: 'proposal_open_contract', proposal_open_contract: contractSnapshot(contract) });
    };
    const settle = (contract, last, early = false) => {
        if (closed || contract.is_sold) return;
        const won = Math.random() * 100 < getAdminTestWinProbability();
        const simulatedSettlementQuote = simulatedExitQuote(contract, last.quote, won);
        contract.status = won ? 'won' : 'lost';
        contract.is_sold = 1;
        contract.is_expired = early ? 0 : 1;
        contract.is_valid_to_sell = 0;
        contract.sell_price = won ? contract.payout : 0;
        contract.profit = Number((contract.sell_price - contract.buy_price).toFixed(2));
        // A forced win percentage is a CONTRACT-LEVEL testing override.
        // Simultaneous contradictory contracts cannot all match one shared
        // public market quote; the displayed contract exit is synthetic.
        contract.exit_tick = simulatedSettlementQuote;
        contract.exit_spot = simulatedSettlementQuote;
        contract.exit_tick_time = last.epoch;
        contract.sell_time = last.epoch;
        contract.date_expiry = last.epoch;
        contract.transaction_ids.sell = 500000 + nextContractSerial();
        saveBalance(accountId, readBalances()[accountId] + contract.sell_price);
        contract.balance_after_sell = readBalances()[accountId];
        saveContractLedger(accountId, contracts);
        market.releaseSymbol(contract.underlying_symbol);
        broadcastContract(contract);
        broadcastBalance();
        emit({ msg_type: 'transaction', transaction: {
            action: 'sell', contract_id: contract.contract_id, amount: contract.sell_price,
            balance: readBalances()[accountId], currency: 'USD',
            transaction_id: contract.transaction_ids.sell,
            transaction_time: contract.sell_time,
        } });
    };
    const onMarketTick = tick => {
        for (const contract of contracts.values()) {
            if (contract.is_sold || contract.underlying_symbol !== tick.symbol) continue;
            contract.current_spot = tick.quote;
            contract.current_spot_time = tick.epoch;
            contract.tick_count = (Number(contract.tick_count) || 0) + 1;
            contract.remaining_ticks = Math.max(0,
                (Number(contract.remaining_ticks) || 1) - 1);
            if (contract.remaining_ticks === 0) {
                settle(contract, tick);
            } else {
                saveContractLedger(accountId, contracts);
                broadcastContract(contract);
            }
        }
    };
    const api = {
        isAdminSimulation: true,
        simulatedAccountId: accountId,
        connection,
        onMessage: () => ({
            subscribe(callback) {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
        disconnect: () => connection.close(),
        balance: () => api.send({ balance: 1 }),
        forget: id => api.send({ forget: id }),
        // Bot Builder's TicksService uses forgetAll(), while Bulk Trader
        // uses send({ forget_all }). Both must be supported locally.
        forgetAll: type => api.send({ forget_all: type }),
        authorize: () => Promise.resolve({ authorize: { loginid: accountId } }),
        async send(rawRequest) {
            const request = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
            if (closed || connection.readyState !== 1) throw new Error('Simulated connection is not open.');
            // The socket is bound to the account selected when it was made.
            // Reject stale Bot Builder/Bulk Trader requests during a switch;
            // APIBase can then recreate and authorize the correct local socket.
            if (!isAdminTestActive() || localStorage.getItem('active_loginid') !== accountId) {
                throw new Error('Simulated account changed; reconnect before sending requests.');
            }
            const kind = Object.keys(request).find(key => [
                'balance', 'time', 'active_symbols', 'contracts_for', 'trading_times',
                'ticks_history', 'ticks', 'proposal', 'buy', 'proposal_open_contract',
                'transaction', 'forget', 'forget_all', 'sell', 'portfolio', 'statement',
                'website_status', 'authorize', 'ping', 'exchange_rates',
            ].includes(key));
            const message = (payload, name = kind) => sendResponse(request, payload, name);
            if (kind === 'balance') {
                return message({ balance: currentBalance(),
                    ...(request.subscribe ? { subscription: subscription('balance') } : {}) });
            }
            if (kind === 'time' || kind === 'ping') return message({ [kind]: Math.floor(Date.now() / 1000) });
            if (kind === 'active_symbols') return message({ active_symbols: SYMBOLS });
            if (kind === 'website_status') return message({ website_status: { site_status: 'up' } });
            if (kind === 'authorize') return message({ authorize: { loginid: accountId, currency: 'USD', is_virtual: accountId === TEST_DEMO_ID ? 1 : 0 } });
            if (kind === 'exchange_rates') return message({ exchange_rates: { base_currency: 'USD', rates: { USD: 1 } } });
            if (kind === 'trading_times') return message({ trading_times: { markets: [] } });
            if (kind === 'contracts_for') return message({ contracts_for: { available: CONTRACT_TYPES.map(type => ({
                contract_type: type,
                contract_category: type.startsWith('DIGIT') ? 'digits' : 'callput',
                expiry_type: 'tick', min_contract_duration: '1t', max_contract_duration: '10t',
                barriers: ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(type) ? 1 : 0,
            })) } });
            if (kind === 'ticks_history') {
                const count = Math.max(1, Math.min(5000, Number(request.count) || 100));
                const symbol = request.ticks_history;
                const isCandles = request.style === 'candles';
                const granularity = Math.max(60, Math.floor(Number(request.granularity) || 60));
                if (!SYMBOLS.some(item => item.symbol === symbol)) {
                    return message({ error: { code: 'InvalidSymbol', message: 'Unknown simulated market symbol.' } },
                        isCandles ? 'candles' : 'history');
                }
                const res = isCandles
                    ? { candles: market.candlesFor(symbol, count, granularity) }
                    : { history: market.historyFor(symbol, count), pip_size: 2 };
                if (request.subscribe) {
                    res.subscription = subscription(isCandles ? 'candles' : 'ticks', symbol, granularity);
                }
                // The initial history snapshot and subsequent streamed updates
                // refer to exactly the same underlying per-symbol market state.
                return message(res, isCandles ? 'candles' : 'history');
            }
            if (kind === 'ticks') {
                const symbol = request.ticks;
                if (!SYMBOLS.some(item => item.symbol === symbol)) {
                    return message({ error: { code: 'InvalidSymbol', message: 'Unknown simulated market symbol.' } }, 'tick');
                }
                const tick = market.recentTick(symbol);
                const sub = request.subscribe ? subscription('ticks', symbol) : null;
                return message({ tick: { ...tick, ...(sub ? { id: sub.id } : {}) },
                    ...(sub ? { subscription: sub } : {}) }, 'tick');
            }
            if (kind === 'proposal') {
                const amount = Number(request.amount);
                const type = request.contract_type;
                const symbol = request.underlying_symbol || 'R_100';
                const duration = Number(request.duration ?? 1);
                const durationUnit = request.duration_unit || 't';
                if (!CONTRACT_TYPES.includes(type) || !SYMBOLS.some(s => s.symbol === symbol) ||
                    !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(duration) ||
                    duration < 1 || duration > 10 || durationUnit !== 't') {
                    const err = { code: 'InvalidContractProposal', message: 'Unsupported simulated contract, symbol, amount, or duration.' };
                    return message({ error: err }, 'proposal');
                }
                const id = `adm-proposal-${++serial}`;
                const multiplier = type === 'DIGITMATCH' ? 8.4 : 1.8;
                const basisPayout = request.basis === 'payout';
                const stake = Number((basisPayout ? amount / multiplier : amount).toFixed(2));
                const payout = Number((basisPayout ? amount : stake * multiplier).toFixed(2));
                proposals.set(id, { ...request, underlying_symbol: symbol, duration, duration_unit: durationUnit,
                    stake, payout, barrier: request.barrier ?? request.selected_tick ?? request.prediction });
                const sub = request.subscribe ? subscription('proposal') : null;
                return message({ proposal: { id, ask_price: stake, payout,
                    contract_type: type, display_value: String(stake), longcode: 'SIMULATED contract only' },
                    passthrough: request.passthrough,
                    ...(sub ? { subscription: sub } : {}) });
            }
            if (kind === 'buy') {
                const direct = request.parameters;
                const directAmount = Number(direct?.amount);
                const directMultiplier = direct?.contract_type === 'DIGITMATCH' ? 8.4 : 1.8;
                const directStake = Number((direct?.basis === 'payout'
                    ? directAmount / directMultiplier : directAmount).toFixed(2));
                const proposal = proposals.get(request.buy) ||
                    (direct && { ...direct,
                        underlying_symbol: direct.underlying_symbol || 'R_100',
                        stake: directStake,
                        payout: Number((direct?.basis === 'payout' ? directAmount :
                            directStake * directMultiplier).toFixed(2)),
                        barrier: direct.barrier ?? direct.selected_tick ?? direct.prediction,
                    });
                const amount = Number(proposal?.stake ?? proposal?.amount);
                const duration = Number(proposal?.duration ?? 1);
                const symbol = proposal?.underlying_symbol || 'R_100';
                const offeredPrice = Number(request.price);
                if (!proposal || !CONTRACT_TYPES.includes(proposal.contract_type) ||
                    !SYMBOLS.some(s => s.symbol === symbol) ||
                    !Number.isFinite(amount) || amount <= 0 ||
                    !Number.isInteger(duration) || duration < 1 || duration > 10 ||
                    (proposal.duration_unit || 't') !== 't' ||
                    !Number.isFinite(offeredPrice) || offeredPrice + 1e-6 < amount) {
                    return message({ error: {
                        code: 'InvalidContractProposal', message: 'Simulated contract, duration or purchase price is invalid.',
                    } }, 'buy');
                }
                if (readBalances()[accountId] < amount) {
                    return message({ error: {
                        code: 'InsufficientBalance', message: 'Insufficient funds in the simulated account.',
                    } }, 'buy');
                }
                if (typeof request.buy === 'string') proposals.delete(request.buy);
                const contract_id = 9000000 + nextContractSerial();
                const transaction_id = 3000000 + nextContractSerial();
                const entry = market.recentTick(symbol);
                const now = entry.epoch;
                const contract = {
                    contract_id, contract_type: proposal.contract_type,
                    underlying_symbol: symbol,
                    // The Transactions UI's getContractTypeName() reads the
                    // penultimate shortcode segment for CALL/PUT to distinguish
                    // Rise/Fall from Higher/Lower. Real Deriv contracts include
                    // this field; omitting it crashed the entire report drawer.
                    shortcode: [
                        proposal.contract_type, symbol, amount, now,
                        now + duration, 'S0P', '0',
                    ].join('_'),
                    currency: 'USD', buy_price: amount, payout: proposal.payout,
                    barrier: proposal.barrier ?? proposal.selected_tick ?? proposal.prediction,
                    entry_tick: entry.quote, entry_spot: entry.quote,
                    entry_tick_time: now, purchase_time: now, date_start: now,
                    date_expiry: now + duration,
                    current_spot: entry.quote, current_spot_time: now,
                    // Bot Builder uses a direct buy or a proposal carrying
                    // the trading engine's purchase_reference passthrough.
                    // Bulk Trader quotes have no such passthrough.
                    source: request.parameters || proposal.passthrough?.purchase_reference
                        ? 'bot_builder' : 'bulk_trader',
                    tick_count: 0, remaining_ticks: duration,
                    bid_price: 0, sell_price: 0, profit: -amount,
                    is_sold: 0, is_expired: 0, is_valid_to_sell: 1, status: 'open',
                    transaction_ids: { buy: transaction_id },
                };
                contracts.set(String(contract_id), contract);
                saveBalance(accountId, readBalances()[accountId] - amount);
                contract.balance_after_buy = readBalances()[accountId];
                saveContractLedger(accountId, contracts);
                // Keep the underlying market clock running even if the user
                // navigates away and has zero active UI tick subscriptions.
                market.retainSymbol(symbol);
                const result = message({ buy: { contract_id, transaction_id,
                    buy_price: amount, payout: proposal.payout,
                    balance_after: readBalances()[accountId] } });
                queueMicrotask(() => {
                    broadcastBalance();
                    broadcastContract(contract);
                    emit({ msg_type: 'transaction', transaction: {
                        action: 'buy', contract_id, amount: -amount,
                        balance: readBalances()[accountId], currency: 'USD',
                        transaction_id, transaction_time: now,
                    } });
                });
                return result;
            }
            if (kind === 'proposal_open_contract') {
                const sub = request.subscribe ? subscription('proposal_open_contract') : null;
                const contract = contracts.get(String(request.contract_id || ''));
                return message({
                    proposal_open_contract: contract
                        ? contractSnapshot(contract)
                        : { contract_id: Number(request.contract_id) || 0, status: 'open' },
                    ...(sub ? { subscription: sub } : {}),
                });
            }
            if (kind === 'transaction') return message({
                transaction: { balance: readBalances()[accountId], currency: 'USD' },
                ...(request.subscribe ? { subscription: subscription('transaction') } : {}),
            });
            if (kind === 'forget') {
                const sub = subscriptions.get(String(request.forget));
                if (sub) forgetSubscription(request.forget);
                return message({ forget: 1 });
            }
            if (kind === 'forget_all') {
                // Deriv forget_all only removes subscriptions of the requested
                // category. Bot Builder stops tick/candle subscriptions while
                // the header, contract monitor and Bulk Trader still depend
                // on their own subscriptions.
                const target = request.forget_all;
                const forgotten = [];
                for (const [id, sub] of subscriptions) {
                    if (sub.kind !== target) continue;
                    forgetSubscription(id);
                    forgotten.push(id);
                }
                return message({ forget_all: forgotten });
            }
            if (kind === 'sell') {
                const contract = contracts.get(String(request.sell));
                if (!contract || contract.is_sold) return message({ error: { code: 'InvalidSell', message: 'Contract unavailable.' } });
                settle(contract, market.recentTick(contract.underlying_symbol), true);
                return message({ sell: { contract_id: contract.contract_id, sold_for: contract.sell_price, transaction_id: contract.transaction_ids.sell } });
            }
            if (kind === 'portfolio') return message({ portfolio: { contracts: [...contracts.values()].filter(c => !c.is_sold) } });
            if (kind === 'statement') {
                const all = simulatedStatementRows(accountId);
                const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
                const limit = Math.min(5000, Math.max(1, Math.floor(Number(request.limit) || 100)));
                return message({ statement: {
                    count: all.length,
                    transactions: all.slice(offset, offset + limit),
                } });
            }
            return message({ error: {
                code: 'AdminSimulationUnsupported',
                message: 'This broker feature is not yet simulated in local Admin Test Kit.',
            } }, kind || 'error');
        },
    };
    return api;
};

/**
 * LOCAL-ONLY simulated Deriv transport. Does not open any broker WebSocket,
 * use an OAuth token, or submit a real purchase. All amounts are fictional.
 * Used by BOTH Blockly Bot Builder and Bulk Trader through api_base.api.
 */
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

export const ADMIN_TEST_KEY = 'yolo:local-admin-test';
export const ADMIN_TEST_MANAGE_EVENT = 'yolo:admin-test-manage';
export const ADMIN_TEST_BACKUP = 'yolo:local-admin-backup';
export const TEST_DEMO_ID = 'VRTC_ADMIN_TEST';
export const TEST_REAL_ID = 'CR_ADMIN_TEST';
const STATE_KEY = 'yolo:local-admin-balances';

export const isAdminTestAvailable = () =>
    typeof window !== 'undefined' &&
    /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/i.test(window.location.hostname);
export const isAdminTestActive = () =>
    isAdminTestAvailable() && sessionStorage.getItem(ADMIN_TEST_KEY) === 'active';

const DEFAULT_BALANCES = { [TEST_DEMO_ID]: 10000, [TEST_REAL_ID]: 500 };
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
    pip: 0.01, pip_size: 2,
}));

export const createAdminTestApi = () => {
    if (!isAdminTestActive()) throw new Error('Simulated API only exists in local admin test mode.');
    const accountId = localStorage.getItem('active_loginid');
    if (!(accountId in DEFAULT_BALANCES)) throw new Error('Choose a simulated account first.');
    const listeners = new Set();
    const socketListeners = { open: new Set(), close: new Set(), error: new Set() };
    const subscriptions = new Map();
    const proposals = new Map();
    const contracts = new Map();
    const activeTimers = new Set();
    let serial = 0;
    let priceIndex = 0;
    let closed = false;
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
            for (const sub of subscriptions.values()) if (sub.timer) clearInterval(sub.timer);
            subscriptions.clear();
            for (const callback of [...socketListeners.close]) callback({ type: 'close' });
            listeners.clear();
        },
    };
    const openTimer = setTimeout(() => {
        if (closed) return;
        connection.readyState = 1;
        for (const callback of [...socketListeners.open]) callback({ type: 'open' });
    }, 35);
    activeTimers.add(openTimer);

    const emit = payload => {
        if (closed) return;
        for (const callback of [...listeners]) callback({ data: payload });
    };
    const sendResponse = (request, response, msg_type) => {
        const message = { msg_type, req_id: request.req_id, echo_req: request, ...response };
        queueMicrotask(() => emit(message));
        return message;
    };
    const subscription = (kind, symbol = null) => {
        const id = `adm-sub-${++serial}`;
        subscriptions.set(id, { kind, symbol });
        return { id };
    };
    const simulatePrice = (symbol = 'R_100') => {
        priceIndex++;
        const base = symbol.includes('75') ? 1750 : symbol.includes('50') ? 1250 : 2000;
        return Number((base + Math.sin(priceIndex * 0.72) * 12 +
            Math.sin(priceIndex * 1.73) * 2 + (Math.random() - 0.5) * 8).toFixed(2));
    };
    const makeTick = symbol => ({
        quote: simulatePrice(symbol), epoch: Math.floor(Date.now() / 1000), symbol,
    });
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
    const broadcastContract = contract => {
        emit({ msg_type: 'proposal_open_contract', proposal_open_contract: { ...contract } });
    };
    const settle = contract => {
        if (closed || contract.is_sold) return;
        const last = makeTick(contract.underlying_symbol);
        const digit = Number(last.quote.toFixed(2).slice(-1));
        const initialDigit = Number(contract.entry_tick.toFixed(2).slice(-1));
        const barrier = Number(contract.barrier ?? 5);
        const wins = {
            DIGITMATCH: digit === barrier,
            DIGITDIFF: digit !== barrier,
            DIGITOVER: digit > barrier,
            DIGITUNDER: digit < barrier,
            DIGITEVEN: digit % 2 === 0,
            DIGITODD: digit % 2 !== 0,
            CALL: last.quote > contract.entry_tick,
            PUT: last.quote < contract.entry_tick,
        };
        const won = Boolean(wins[contract.contract_type]);
        contract.status = won ? 'won' : 'lost';
        contract.is_sold = 1;
        contract.is_expired = 1;
        contract.sell_price = won ? contract.payout : 0;
        contract.profit = Number((contract.sell_price - contract.buy_price).toFixed(2));
        contract.exit_tick = last.quote;
        contract.exit_tick_time = last.epoch;
        contract.sell_time = last.epoch;
        contract.transaction_ids.sell = ++serial + 500000;
        saveBalance(accountId, readBalances()[accountId] + contract.sell_price);
        broadcastContract(contract);
        broadcastBalance();
        emit({ msg_type: 'transaction', transaction: {
            action: 'sell', contract_id: contract.contract_id, amount: contract.sell_price,
            balance: readBalances()[accountId], currency: 'USD',
        } });
    };
    const api = {
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
        authorize: () => Promise.resolve({ authorize: { loginid: accountId } }),
        async send(rawRequest) {
            const request = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
            if (closed || connection.readyState !== 1) throw new Error('Simulated connection is not open.');
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
                const count = Math.max(10, Math.min(5000, Number(request.count) || 100));
                const symbol = request.ticks_history;
                const isCandles = request.style === 'candles';
                const granularity = Math.max(60, Number(request.granularity) || 60);
                const ticks = Array.from({ length: count }, () => makeTick(symbol));
                const prices = ticks.map(t => t.quote);
                const times = ticks.map((t, i) => t.epoch - count + i + 1);
                const candleFor = (price, epoch) => ({
                    epoch, open: price, close: price + 0.03,
                    high: price + 0.25, low: price - 0.25,
                });
                const res = isCandles ? {
                    candles: prices.map((price, i) => candleFor(price, times[i])),
                } : { history: { prices, times } };
                if (request.subscribe) {
                    const sub = subscription(isCandles ? 'candles' : 'ticks', symbol);
                    res.subscription = sub;
                    const entry = subscriptions.get(sub.id);
                    entry.timer = setInterval(() => {
                        if (closed) return;
                        const tick = makeTick(symbol);
                        if (isCandles) {
                            emit({
                                msg_type: 'ohlc',
                                ohlc: {
                                    ...candleFor(tick.quote, tick.epoch), symbol,
                                    granularity, id: sub.id, open_time: tick.epoch,
                                },
                                subscription: { id: sub.id },
                            });
                        } else {
                            emit({
                                msg_type: 'tick',
                                tick: { ...tick, id: sub.id },
                                subscription: { id: sub.id },
                            });
                        }
                    }, 750);
                }
                return message(res);
            }
            if (kind === 'ticks') {
                const symbol = request.ticks;
                const sub = request.subscribe ? subscription('ticks', symbol) : null;
                if (sub) {
                    const entry = subscriptions.get(sub.id);
                    entry.timer = setInterval(() => {
                        if (!closed) emit({ msg_type: 'tick',
                            tick: { ...makeTick(symbol), id: sub.id }, subscription: sub });
                    }, 750);
                }
                return message({ tick: makeTick(symbol), ...(sub ? { subscription: sub } : {}) }, 'tick');
            }
            if (kind === 'proposal') {
                const amount = Number(request.amount);
                const type = request.contract_type;
                if (!CONTRACT_TYPES.includes(type) || !Number.isFinite(amount) || amount <= 0) {
                    const err = { code: 'InvalidContractProposal', message: 'Unsupported simulation contract or amount.' };
                    return message({ error: err }, 'proposal');
                }
                const id = `adm-proposal-${++serial}`;
                const payout = Number((amount * (type === 'DIGITMATCH' ? 8.4 : 1.8)).toFixed(2));
                proposals.set(id, { ...request, payout });
                const sub = request.subscribe ? subscription('proposal') : null;
                return message({ proposal: { id, ask_price: amount, payout,
                    contract_type: type, display_value: String(amount), longcode: 'SIMULATED contract only' },
                    passthrough: request.passthrough,
                    ...(sub ? { subscription: sub } : {}) });
            }
            if (kind === 'buy') {
                const proposal = proposals.get(request.buy) ||
                    (request.parameters && { ...request.parameters, payout: Number(request.price || request.parameters.amount) * 1.8 });
                const amount = Number(proposal?.amount);
                if (!proposal || !Number.isFinite(amount) || amount <= 0 ||
                    Number(request.price) + 1e-6 < amount || readBalances()[accountId] < amount) {
                    return message({ error: {
                        code: 'InsufficientBalance', message: 'Simulated balance is insufficient or proposal is invalid.',
                    } }, 'buy');
                }
                if (typeof request.buy === 'string') proposals.delete(request.buy);
                const contract_id = ++serial + 9000000;
                const transaction_id = ++serial + 3000000;
                const now = Math.floor(Date.now() / 1000);
                const contract = {
                    contract_id, contract_type: proposal.contract_type,
                    underlying_symbol: proposal.underlying_symbol || 'R_100',
                    currency: 'USD', buy_price: amount, payout: proposal.payout,
                    barrier: proposal.barrier || proposal.prediction,
                    entry_tick: simulatePrice(proposal.underlying_symbol),
                    entry_tick_time: now, purchase_time: now, date_start: now,
                    date_expiry: now + Math.max(1, Number(proposal.duration) || 1),
                    bid_price: 0, sell_price: 0, profit: -amount,
                    is_sold: 0, is_expired: 0, is_valid_to_sell: 1, status: 'open',
                    transaction_ids: { buy: transaction_id },
                };
                contracts.set(String(contract_id), contract);
                saveBalance(accountId, readBalances()[accountId] - amount);
                const result = message({ buy: { contract_id, transaction_id,
                    buy_price: amount, payout: proposal.payout,
                    balance_after: readBalances()[accountId] } });
                queueMicrotask(() => {
                    broadcastBalance();
                    broadcastContract(contract);
                    emit({ msg_type: 'transaction', transaction: {
                        action: 'buy', contract_id, amount: -amount,
                        balance: readBalances()[accountId], currency: 'USD',
                    } });
                });
                const timer = setTimeout(() => {
                    activeTimers.delete(timer);
                    settle(contract);
                }, Math.min(10, Math.max(1, Number(proposal.duration) || 1)) * 800);
                activeTimers.add(timer);
                return result;
            }
            if (kind === 'proposal_open_contract') {
                const sub = request.subscribe ? subscription('proposal_open_contract') : null;
                const contract = contracts.get(String(request.contract_id || ''));
                return message({
                    proposal_open_contract: contract || { contract_id: Number(request.contract_id) || 0, status: 'open' },
                    ...(sub ? { subscription: sub } : {}),
                });
            }
            if (kind === 'transaction') return message({
                transaction: { balance: readBalances()[accountId], currency: 'USD' },
                ...(request.subscribe ? { subscription: subscription('transaction') } : {}),
            });
            if (kind === 'forget') {
                const sub = subscriptions.get(String(request.forget));
                if (sub?.timer) clearInterval(sub.timer);
                subscriptions.delete(String(request.forget));
                return message({ forget: 1 });
            }
            if (kind === 'forget_all') {
                for (const sub of subscriptions.values()) if (sub.timer) clearInterval(sub.timer);
                subscriptions.clear();
                return message({ forget_all: [] });
            }
            if (kind === 'sell') {
                const contract = contracts.get(String(request.sell));
                if (!contract || contract.is_sold) return message({ error: { code: 'InvalidSell', message: 'Contract unavailable.' } });
                settle(contract);
                return message({ sell: { contract_id: contract.contract_id, sold_for: contract.sell_price, transaction_id: contract.transaction_ids.sell } });
            }
            if (kind === 'portfolio') return message({ portfolio: { contracts: [...contracts.values()].filter(c => !c.is_sold) } });
            if (kind === 'statement') return message({ statement: { count: 0, transactions: [] } });
            return message({ error: {
                code: 'AdminSimulationUnsupported',
                message: 'This broker feature is not yet simulated in local Admin Test Kit.',
            } }, kind || 'error');
        },
    };
    return api;
};

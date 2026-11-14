/**
 * CLIENT PRESENTATION ONLY. This module never calls the real Deriv API.
 * The selected Blockly contract and market decide what the report displays;
 * the LOCAL Admin Test API owns all purchases, results and balances.
 * It deliberately does not claim to execute indicator/conditional Blockly
 * logic: that is covered by the separate "Engine test" mode.
 */
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { observer } from '@/external/bot-skeleton/utils/observer';
import { LogTypes } from '@/external/bot-skeleton/constants/messages';
import {
    contract as broadcastContract,
    contractStatus,
    info,
    log,
} from '@/external/bot-skeleton/services/tradeEngine/utils/broadcast';
import { isAdminTestActive, isAdminTestTransportReady } from './admin-test-kit';

const SUPPORTED_SYMBOLS = new Set([
    'R_100', 'R_75', 'R_50', 'R_25', 'R_10',
    '1HZ100V', '1HZ75V', '1HZ50V', '1HZ25V', '1HZ10V',
]);
const SUPPORTED_CONTRACTS = new Set([
    'CALL', 'PUT', 'DIGITDIFF', 'DIGITMATCH', 'DIGITOVER',
    'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'ACCU',
]);

const numeric = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const money = value => Math.round(Number(value) * 100) / 100;
const activeBlock = (blocks, name) => blocks.find(block =>
    block.type === name && (!block.isEnabled || block.isEnabled())
);
const field = (block, key) => block?.getFieldValue?.(key);
const numberInput = (block, name) => {
    const target = block?.getInputTargetBlock?.(name);
    return target?.getFieldValue?.('NUM');
};
const strategyName = name => String(name || '').toUpperCase();
const getXmlStrategyValue = (workspace, name) => {
    try {
        const dom = window.Blockly.Xml.workspaceToDom(workspace);
        const element = dom.querySelector('value[strategy_value="' + name + '"]');
        const number = element?.querySelector('field[name="NUM"]');
        const bool = element?.querySelector('field[name="BOOL"]');
        if (number) return number.textContent;
        if (bool) return bool.textContent === 'TRUE';
    } catch { /* Already converted Blockly workspaces may not expose XML. */ }
    return undefined;
};

/** Snapshot the ACTUAL selected Blockly market and contract at Run time. */
export const readAdminDemoConfig = (workspace, { formData = {}, strategy = '' } = {}) => {
    const blocks = workspace?.getAllBlocks?.(true) || [];
    const marketBlock = activeBlock(blocks, 'trade_definition_market');
    const purchaseBlock = activeBlock(blocks, 'purchase');
    const optionsBlock = activeBlock(blocks, 'trade_definition_tradeoptions') ||
        activeBlock(blocks, 'trade_definition_accumulator');
    const typeBlock = activeBlock(blocks, 'trade_definition_tradetype');
    const value = key => {
        const fromWorkspace = getXmlStrategyValue(workspace, key);
        return fromWorkspace !== undefined ? fromWorkspace : formData[key];
    };
    const symbol = field(marketBlock, 'SYMBOL_LIST') || formData.symbol;
    const selectedTradeType = field(typeBlock, 'TRADETYPE_LIST');
    // Do not silently substitute CALL: a wrong fallback mislabels a client's
    // transactions. If a custom block is not supported, say so plainly.
    const contractType = selectedTradeType === 'accumulator'
        ? 'ACCU'
        : (field(purchaseBlock, 'PURCHASE_LIST') || formData.type);
    const rawAmount = numberInput(optionsBlock, 'AMOUNT');
    const stake = numeric(value('stake') ?? rawAmount, NaN);
    const duration = numeric(value('duration') ??
        numberInput(optionsBlock, 'DURATION'), selectedTradeType === 'accumulator' ? 5 : 1);
    const durationUnit = field(optionsBlock, 'DURATIONTYPE_LIST') || formData.durationtype || 't';
    const prediction = numeric(value('last_digit_prediction') ??
        numberInput(optionsBlock, 'PREDICTION'), 5);

    if (!SUPPORTED_SYMBOLS.has(symbol)) {
        throw new Error('This market is not supported by the local presentation simulator: ' + symbol);
    }
    if (!SUPPORTED_CONTRACTS.has(contractType)) {
        throw new Error('This contract is not supported by the local presentation simulator: ' + contractType);
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > 1000000) {
        throw new Error('Set a valid simulated stake before running.');
    }
    if (durationUnit !== 't' && contractType !== 'ACCU') {
        throw new Error('The presentation simulator currently supports tick-duration contracts only.');
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 10) {
        throw new Error('Select a simulated duration from 1 to 10 ticks.');
    }
    if (contractType.startsWith('DIGIT') && !Number.isInteger(prediction)) {
        throw new Error('Digit prediction must be a whole digit.');
    }

    return {
        symbol, contractType, duration: contractType === 'ACCU' ? 5 : duration,
        prediction, initialStake: money(stake), stake: money(stake),
        strategy: strategyName(strategy),
        size: Math.max(1, numeric(value('size'), 2)),
        unit: Math.max(0.01, numeric(value('unit'), 1)),
        profitLimit: numeric(value('profit'), Infinity),
        lossLimit: numeric(value('loss'), Infinity),
        maxStake: value('boolean_max_stake') === true
            ? numeric(value('max_stake'), Infinity) : Infinity,
        growthRate: numeric(value('growth_rate'), 0.03),
    };
};

/** Presentation staking profiles. These are NOT compiled Blockly decisions. */
export const nextAdminDemoStake = (config, state, won) => {
    const initial = config.initialStake;
    const previous = state.stake;
    const name = strategyName(config.strategy);
    let next = initial;
    if (name.includes('1_3_2_6')) {
        const sequence = [1, 3, 2, 6];
        state.sequenceIndex = won ? (state.sequenceIndex + 1) % sequence.length : 0;
        next = initial * sequence[state.sequenceIndex];
    } else if (name.includes('REVERSE_MARTINGALE')) {
        next = won ? previous * config.size : initial;
    } else if (name.includes('MARTINGALE')) {
        next = won ? initial : previous * config.size;
    } else if (name.includes('REVERSE_D_ALEMBERT') || name.includes('REVERSE_DALEMBERT')) {
        next = won ? previous + config.unit : Math.max(initial, previous - config.unit);
    } else if (name.includes('D_ALEMBERT') || name.includes('DALEMBERT')) {
        next = won ? Math.max(initial, previous - config.unit) : previous + config.unit;
    } else if (name.includes('OSCARS_GRIND') || name.includes('OSCAR')) {
        next = won ? previous + config.unit : previous;
        // Simplified Oscar's Grind: reset once this series recovers.
        if (state.seriesProfit >= 0) next = initial;
    }
    return money(Math.min(next, config.maxStake));
};

/**
 * One local runner per Bot Builder run. All monetary state is changed ONLY
 * by the shared fake transport, also used by Bulk Trader. Reports subscribe
 * to its confirmed contract snapshots; no parallel fake balance exists.
 */
export const createAdminTestDemoRunner = ({ workspace, formData, strategy, onFinished = () => {} }) => {
    if (!isAdminTestTransportReady(api_base)) {
        throw new Error('The local simulated account is not connected.');
    }
    const config = readAdminDemoConfig(workspace, { formData, strategy });
    const api = api_base.api;
    const accountId = api.simulatedAccountId;
    const state = {
        stake: config.initialStake, sequenceIndex: 0, seriesProfit: 0,
        totalProfit: 0, totalRuns: 0, wins: 0, losses: 0,
    };
    let stopped = false;
    let finished = false;
    let pendingContract = false;
    const sessionReady = () => isAdminTestActive() && !finished &&
        api_base.api === api && api.simulatedAccountId === accountId &&
        isAdminTestTransportReady(api_base);

    const finish = () => {
        if (finished) return;
        finished = true;
        stopped = true;
        api_base.setIsRunning(false);
        observer.emit('bot.stop');
        onFinished();
    };

    const stop = () => {
        stopped = true;
        if (!pendingContract) finish();
    };

    const buyAndSettle = async () => {
        if (!sessionReady() || stopped) return null;
        const stake = state.stake;
        const type = config.contractType;
        let settled = false;
        let expectedId = null;
        let listener;
        let timeoutId;
        let resolveSettlement;
        let rejectSettlement;
        const settlement = new Promise((resolve, reject) => {
            resolveSettlement = resolve;
            rejectSettlement = reject;
        });
        const teardown = () => {
            clearTimeout(timeoutId);
            listener?.unsubscribe?.();
        };
        listener = api.onMessage().subscribe(({ data }) => {
            if (data.msg_type !== 'proposal_open_contract' ||
                String(data.proposal_open_contract?.contract_id) !== String(expectedId) ||
                !sessionReady()) return;
            const current = data.proposal_open_contract;
            broadcastContract({ accountID: accountId, ...current });
            if (!current.is_sold || settled) return;
            settled = true;
            contractStatus({ id: 'contract.sold', data: current.transaction_ids?.sell, contract: current });
            const profit = numeric(current.profit, 0);
            log(profit > 0 ? LogTypes.PROFIT : LogTypes.LOST, { currency: 'USD', profit });
            state.totalRuns += 1;
            state.totalProfit = money(state.totalProfit + profit);
            state.seriesProfit = money(state.seriesProfit + profit);
            if (profit > 0) state.wins += 1;
            else state.losses += 1;
            info({
                accountID: accountId, contract: current, profit,
                totalRuns: state.totalRuns, totalProfit: state.totalProfit,
                totalWins: state.wins, totalLosses: state.losses,
                totalStake: state.totalRuns ? state.totalRuns * config.initialStake : 0,
            });
            resolveSettlement(current);
        });
        timeoutId = setTimeout(() => rejectSettlement(
            new Error('The simulated contract did not settle; stop and restart the demo.')
        ), Math.max(15000, config.duration * 3000 + 8000));
        pendingContract = true;
        try {
            contractStatus({ id: 'contract.purchase_sent', data: stake });
            const params = {
                amount: stake, basis: 'stake', contract_type: type, currency: 'USD',
                underlying_symbol: config.symbol, duration: config.duration, duration_unit: 't',
                ...(type.startsWith('DIGIT') ? { prediction: config.prediction, barrier: config.prediction } : {}),
                ...(type === 'ACCU' ? { growth_rate: config.growthRate } : {}),
            };
            const result = await api.send({ buy: '1', price: stake, parameters: params });
            if (result?.error) throw new Error(result.error.message);
            if (!result?.buy?.contract_id) throw new Error('Simulated purchase was not confirmed.');
            expectedId = result.buy.contract_id;
            contractStatus({ id: 'contract.purchase_received', data: result.buy.transaction_id, buy: result.buy });
            log(LogTypes.PURCHASE, { transaction_id: result.buy.transaction_id });
            info({
                accountID: accountId, totalRuns: state.totalRuns + 1,
                transaction_ids: { buy: result.buy.transaction_id },
                contract_type: type, buy_price: result.buy.buy_price,
            });
            // Fetch the canonical initial snapshot so Summary and Transactions
            // immediately show the correct market and trade type.
            const open = await api.send({ proposal_open_contract: 1, contract_id: expectedId });
            if (open?.proposal_open_contract && sessionReady()) {
                broadcastContract({ accountID: accountId, ...open.proposal_open_contract });
            }
            return await settlement;
        } finally {
            pendingContract = false;
            teardown();
        }
    };

    const start = async () => {
        if (!sessionReady()) throw new Error('The simulated transport changed before Run.');
        api_base.setIsRunning(true);
        observer.emit('bot.running');
        try {
            // Bounded safety cap prevents an unattended presentation from
            // silently placing thousands of fake contracts in sessionStorage.
            while (!stopped && sessionReady() && state.totalRuns < 200) {
                const result = await buyAndSettle();
                if (!result) break;
                if (stopped) break;
                if (state.totalProfit >= config.profitLimit ||
                    state.totalProfit <= -config.lossLimit) break;
                state.stake = nextAdminDemoStake(config, state, result.profit > 0);
                if (!Number.isFinite(state.stake) || state.stake <= 0) break;
                // Yield between contracts and let Stop/account changes win.
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        } catch (error) {
            observer.emit('ui.log.error', error?.message || 'Simulated presentation trade failed.');
        } finally {
            finish();
        }
    };

    return { start, stop, config };
};

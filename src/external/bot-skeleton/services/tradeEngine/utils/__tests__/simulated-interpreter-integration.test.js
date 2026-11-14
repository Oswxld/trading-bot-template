import Interpreter from '../interpreter';
import { api_base } from '../../../api/api-base';
import * as helperModule from '../helpers';
import { getAdminTestContracts, getAdminTestBalances, createAdminTestApi, enterAdminTest,
    exitAdminTest, switchAdminTestAccount, setAdminTestWinProbability,
    TEST_DEMO_ID, TEST_REAL_ID } from '@/services/admin-test-kit';

jest.mock('../../../api/api-base', () => ({
    api_base: {
        api: null, pip_sizes: { R_100: 2 },
        token: '', account_info: {}, is_running: true, is_stopping: false,
        pushSubscription: jest.fn(), toggleRunButton: jest.fn(), setIsRunning: jest.fn(),
        clearSubscriptions: jest.fn(),
    },
}));
jest.mock('../helpers', () => {
    const real = jest.requireActual('../helpers');
    return {
        ...real,
        checkBlocksForProposalRequest: jest.fn(() => ({
            has_payout_block: false, is_basis_payout: false,
        })),
    };
});

const connected = api => new Promise(resolve => {
    if (api.connection.readyState === 1) return resolve();
    api.connection.addEventListener('open', resolve);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withDeadline = (promise, milliseconds = 9000) =>
    Promise.race([promise, new Promise((_, reject) => {
        setTimeout(() => reject(new Error('The real JS interpreter stalled while waiting for a bot trade signal')), milliseconds);
    })]);

// Execute the same JSInterpreter, Bot Interface and watch(before/during)
// callbacks used by DBot.generateCode; substitute compiled Blockly JavaScript.
// Actual Quick Strategy XML code generation requires separate verification.
const generatedBot = (account, { repeat = 2, contractType = 'DIGITDIFF', rule = 'true' } = {}) => [
    'var BinaryBotPrivateHasCalledTradeOptions = false;',
    'var completed = 0;',
    'var BinaryBotPrivateInit = function () { Bot.init(' + JSON.stringify(account) + ', {',
    'symbol: "R_100", contractTypes: ["DIGITDIFF","DIGITMATCH"],',
    'shouldRestartOnError: false, timeMachineEnabled: false }); };',
    'var BinaryBotPrivateStart = function () { Bot.start({',
    'amount: 1, basis: "stake", currency: "USD",',
    'contractTypes: ["DIGITDIFF","DIGITMATCH"],',
    'duration: 1, duration_unit: "t", prediction: 5, limit_order: {} });',
    'BinaryBotPrivateHasCalledTradeOptions = true; };',
    'var BinaryBotPrivateBeforePurchase = function () { if (' + rule + ') Bot.purchase(' +
        JSON.stringify(contractType) + '); };',
    'var BinaryBotPrivateAfterPurchase = function () { completed++; return completed < ' + repeat + '; };',
    'function BinaryBotPrivateRun(f, arg) { if (f) return f(arg); return false; }',
    'BinaryBotPrivateRun(BinaryBotPrivateInit);',
    'while (true) {',
    ' BinaryBotPrivateRun(BinaryBotPrivateStart);',
    ' if (!BinaryBotPrivateHasCalledTradeOptions) { sleep(1); continue; }',
    ' while (watch("before")) { BinaryBotPrivateRun(BinaryBotPrivateBeforePurchase); }',
    ' while (watch("during")) { }',
    ' if (!BinaryBotPrivateRun(BinaryBotPrivateAfterPurchase)) break;',
    '}',
    'completed;',
].join('\n');

describe('Actual JSInterpreter → TradeEngine → Admin Test Kit → settlement', () => {
    let collected, api, cleanupSubscriptions;
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        enterAdminTest();
        setAdminTestWinProbability(0);
        collected = [];
        cleanupSubscriptions = [];
        api_base.api = null;
        api_base.token = '';
        api_base.account_info = {};
        api_base.pip_sizes = { R_100: 2 };
        api_base.is_running = true;
        api_base.is_stopping = false;
        api_base.pushSubscription.mockImplementation(s => cleanupSubscriptions.push(s));
        api_base.clearSubscriptions.mockImplementation(() => {
            cleanupSubscriptions.forEach(s => s.unsubscribe?.());
            cleanupSubscriptions = [];
        });
        helperModule.checkBlocksForProposalRequest.mockReturnValue({
            has_payout_block: false, is_basis_payout: false,
        });
    });
    afterEach(() => {
        cleanupSubscriptions.forEach(s => s.unsubscribe?.());
        api?.disconnect();
        api = null;
        api_base.api = null;
        api_base.clearSubscriptions.mockReset();
        api_base.pushSubscription.mockReset();
        exitAdminTest();
        localStorage.clear();
        sessionStorage.clear();
    });
    const prepare = async account => {
        if (account === TEST_REAL_ID) switchAdminTestAccount(TEST_REAL_ID);
        api = createAdminTestApi();
        await connected(api);
        api_base.api = api;
        api_base.account_info = { loginid: account, currency: 'USD' };
        api_base.token = account;
        api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal_open_contract' &&
                data.proposal_open_contract?.is_sold) collected.push(data.proposal_open_contract);
        });
    };

    for (const [label, account, start] of [
        ['Demo', TEST_DEMO_ID, 10000],
        ['Real-labelled', TEST_REAL_ID, 500],
    ]) {
        it('executes two purchases and two settlements from interpreter on simulated ' + label, async () => {
            await prepare(account);
            const interpreter = Interpreter();
            try {
                await withDeadline(interpreter.run(generatedBot(account)), 8500);
                const rows = getAdminTestContracts(account, { source: 'bot_builder' });
                expect(rows).toHaveLength(2);
                expect(rows.every(contract => contract.is_sold === 1)).toBe(true);
                expect(collected.map(c => c.contract_id)).toEqual(rows.map(c => c.contract_id));
                expect(getAdminTestBalances()[account]).toBe(start - 2);
                expect(interpreter.bot.tradeEngine.store.getState().scope).toBe('STOP');
            } finally { await interpreter.terminateSession(); }
        }, 12000);
    }

    it('executes subscribed-proposal mode for payout-reading Blockly strategies', async () => {
        await prepare(TEST_DEMO_ID);
        helperModule.checkBlocksForProposalRequest.mockReturnValue({
            has_payout_block: true, is_basis_payout: false,
        });
        const interpreter = Interpreter();
        try {
            await withDeadline(interpreter.run(generatedBot(TEST_DEMO_ID, {
                repeat: 2, contractType: 'DIGITMATCH',
            })), 9000);
            const rows = getAdminTestContracts(TEST_DEMO_ID, { source: 'bot_builder' });
            expect(rows).toHaveLength(2);
            expect(rows.every(c => c.contract_type === 'DIGITMATCH' && c.is_sold)).toBe(true);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9998);
        } finally { await interpreter.terminateSession(); }
    }, 13000);

    it('waits for a genuine tick-based condition before submitting purchase', async () => {
        await prepare(TEST_DEMO_ID);
        const interpreter = Interpreter();
        try {
            await withDeadline(interpreter.run(generatedBot(TEST_DEMO_ID, {
                repeat: 1,
                rule: 'parseInt(Bot.getLastDigit(), 10) % 2 === 0',
            })), 9000);
            expect(getAdminTestContracts(TEST_DEMO_ID, { source: 'bot_builder' })).toHaveLength(1);
        } finally { await interpreter.terminateSession(); }
    }, 13000);

    it('stopping with an open position prevents further buys; existing position still settles', async () => {
        await prepare(TEST_DEMO_ID);
        const interpreter = Interpreter();
        const running = interpreter.run(generatedBot(TEST_DEMO_ID, { repeat: 8 }));
        try {
            const started = Date.now();
            while (!getAdminTestContracts(TEST_DEMO_ID).length && Date.now() - started < 5000) {
                await sleep(25);
            }
            expect(getAdminTestContracts(TEST_DEMO_ID)).toHaveLength(1);
            await interpreter.stop();
            await sleep(1500);
            const rows = getAdminTestContracts(TEST_DEMO_ID);
            expect(rows).toHaveLength(1);
            expect(rows[0].is_sold).toBe(1);
            expect(getAdminTestBalances()[TEST_DEMO_ID]).toBe(9999);
            // A stopped script's original run promise may remain unresolved.
            void running;
        } finally { await interpreter.terminateSession(); }
    }, 10000);
});

/**
 * End-to-end integration at the application module boundary using a synthetic
 * Deriv WebSocket. No network calls or real trades take place in these tests.
 * Exercises actual budget, req_id matching, bounded scheduler, settlement
 * buffering, error classification, and request cancellation together.
 */
let runBoundedBulkOperations;
let requestBulkApi;
let createEarlySettlementBuffer;
let mergeContractSettlement;
let classifyBulkFailure;
let trackTradingSocket;
let tradingBudgetSnapshot;

const makeBroker = ({ quoteDelay = 20, buyDelay = 50, settlementDelay = 10,
    earlySettlementFor = () => false, disconnectOnBuy = () => false } = {}) => {
    const listeners = new Set();
    const closeListeners = new Set();
    const messages = [];
    const contracts = new Map();
    const starts = [];
    let nextContractId = 500000;

    const emit = message => {
        for (const fn of [...listeners]) fn({ data: message });
    };
    const socket = {
        readyState: 1,
        send(frame) {
            const payload = JSON.parse(frame);
            messages.push(payload);
            if (payload.proposal) {
                starts.push(Date.now());
                setTimeout(() => emit({
                    req_id: payload.req_id,
                    msg_type: 'proposal',
                    proposal: {
                        id: `proposal_${payload.req_id}`,
                        ask_price: '0.50',
                    },
                    subscription: { id: `stream_${payload.req_id}` },
                }), quoteDelay);
            } else if (payload.buy) {
                const index = messages.filter(item => Boolean(item.buy)).length - 1;
                if (disconnectOnBuy(index)) {
                    setTimeout(() => socket.close(), 1);
                    return;
                }
                const contractId = ++nextContractId;
                const profit = index % 2 === 0 ? 0.45 : -0.50;
                const settlement = {
                    contract_id: contractId,
                    status: profit >= 0 ? 'won' : 'lost',
                    profit: profit.toFixed(2),
                    payout: '1.85', // Deliberately a potential win value, even on loss.
                    is_sold: 1,
                };
                contracts.set(contractId, settlement);
                const broadcast = () => emit({
                    msg_type: 'proposal_open_contract',
                    proposal_open_contract: settlement,
                });
                if (earlySettlementFor(index)) {
                    setTimeout(broadcast, 1);
                }
                setTimeout(() => {
                    emit({
                        req_id: payload.req_id,
                        msg_type: 'buy',
                        buy: { contract_id: contractId, buy_price: '0.50' },
                    });
                }, buyDelay);
                if (!earlySettlementFor(index)) {
                    setTimeout(broadcast, buyDelay + settlementDelay);
                }
            } else if (payload.proposal_open_contract) {
                const contract = contracts.get(Number(payload.contract_id));
                if (contract) {
                    setTimeout(() => emit({
                        req_id: payload.req_id,
                        msg_type: 'proposal_open_contract',
                        proposal_open_contract: contract,
                    }), 1);
                }
            }
        },
        addEventListener(type, fn) {
            if (type === 'close') closeListeners.add(fn);
        },
        removeEventListener(type, fn) {
            if (type === 'close') closeListeners.delete(fn);
        },
        close() {
            this.readyState = 3;
            for (const fn of [...closeListeners]) fn();
        },
    };
    const api = {
        connection: socket,
        onMessage: () => ({
            subscribe: fn => {
                listeners.add(fn);
                return { unsubscribe: () => listeners.delete(fn) };
            },
        }),
        send: payload => {
            socket.send(JSON.stringify(payload));
            // A successful send is NOT a confirmed purchase. The request
            // adapter must await the matching req_id response separately.
            return Promise.resolve();
        },
    };
    trackTradingSocket(socket);
    return { api, messages, starts, contracts, emit, listeners, socket };
};

const runBatch = ({
    broker,
    quantity,
    spacingMs = 500,
    maxConcurrent = 5,
    stopOnBuy = null,
} = {}) => {
    const records = [];
    const buffer = createEarlySettlementBuffer();
    let stopped = false;
    let nextReqId = 1000;
    let confirmed = 0;
    let uncertain = 0;
    let skipped = 0;
    const onUpdate = contract => {
        const index = records.findIndex(record =>
            String(record.contractId) === String(contract?.contract_id)
        );
        if (index === -1) {
            buffer.remember(contract);
            return;
        }
        records[index] = mergeContractSettlement(records[index], contract);
    };
    const listener = broker.api.onMessage().subscribe(event => {
        if (event.data.msg_type === 'proposal_open_contract') {
            onUpdate(event.data.proposal_open_contract);
        }
    });
    const shouldContinue = () => !stopped && broker.socket.readyState === 1;
    const execute = async index => {
        let phase = 'proposal';
        try {
            const quote = await requestBulkApi({
                api: broker.api,
                payload: {
                    proposal: 1, amount: 0.5, basis: 'stake', currency: 'USD',
                    duration: 1, duration_unit: 't', contract_type: 'DIGITDIFF',
                    underlying_symbol: 'R_100', barrier: '5', subscribe: 1,
                },
                reqId: ++nextReqId,
                timeout: 300,
                canSend: shouldContinue,
            });
            if (!shouldContinue()) {
                skipped++;
                return;
            }
            phase = 'buy';
            const purchase = await requestBulkApi({
                api: broker.api,
                payload: { buy: quote.proposal.id, price: Number(quote.proposal.ask_price) },
                reqId: ++nextReqId,
                timeout: 300,
                canSend: shouldContinue,
            });
            const id = purchase.buy.contract_id;
            confirmed++;
            const record = {
                contractId: String(id), status: 'open', price: 0.5,
                payout: null, profit: null,
            };
            records.push(record);
            const early = buffer.take(id);
            if (early) onUpdate(early);
            if (typeof stopOnBuy === 'function' && stopOnBuy(index)) stopped = true;
        } catch (error) {
            const outcome = classifyBulkFailure(error, phase);
            if (outcome.status === 'unconfirmed') {
                uncertain++;
                stopped = true;
            } else if (outcome.status === 'skipped') {
                skipped++;
            } else if (outcome.stop) stopped = true;
        }
    };
    const batch = runBoundedBulkOperations({
        quantity, maxConcurrent, spacingMs, shouldContinue, execute,
    });
    return {
        batch, records, buffer,
        get counts() { return { confirmed, uncertain, skipped }; },
        stop: () => { stopped = true; },
        finish: async () => {
            const stats = await batch;
            listener.unsubscribe();
            return stats;
        },
    };
};

describe('Bulk Trader: simulated end-to-end execution and settlement', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
        ({ runBoundedBulkOperations } = require('../bulk-execution'));
        ({ requestBulkApi } = require('../bulk-api-request'));
        ({ createEarlySettlementBuffer, mergeContractSettlement } =
            require('../bulk-contract-monitor'));
        ({ classifyBulkFailure } = require('../bulk-request-safety'));
        ({ trackTradingSocket, tradingBudgetSnapshot } =
            require('@/services/trading-request-budget'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('buys seven demo-like contracts at 500ms starts, respects five slots and reports settled P/L accurately', async () => {
        const broker = makeBroker({
            buyDelay: 140,
            earlySettlementFor: i => i % 2 === 0,
        });
        const run = runBatch({ broker, quantity: 7, spacingMs: 500 });
        const first = Date.now();

        await jest.advanceTimersByTimeAsync(5_000);
        const stats = await run.finish();
        const elapsed = broker.starts.map(t => t - first);

        expect(elapsed).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
        expect(stats.workerCount).toBe(5);
        expect(stats.peakInFlight).toBeLessThanOrEqual(5);
        expect(stats.started).toBe(7);
        expect(stats.completed).toBe(7);
        expect(run.counts.confirmed).toBe(7);
        expect(run.counts.uncertain).toBe(0);
        expect(run.records).toHaveLength(7);
        expect(run.records.every(r => r.status === 'won' || r.status === 'lost')).toBe(true);
        expect(run.records.filter(r => r.status === 'lost').every(r => r.payout === 0)).toBe(true);
        expect(run.records.filter(r => r.status === 'won').every(r => r.payout === 0.95)).toBe(true);
        expect(broker.messages.filter(m => m.proposal)).toHaveLength(7);
        expect(broker.messages.filter(m => m.buy)).toHaveLength(7);
        expect(tradingBudgetSnapshot().minuteUsed).toBe(14);
    });

    it('never purchases more than the selected quantity, including a 50-operation batch', async () => {
        const broker = makeBroker({ quoteDelay: 2, buyDelay: 3, settlementDelay: 1 });
        const run = runBatch({ broker, quantity: 50, spacingMs: 0 });

        await jest.advanceTimersByTimeAsync(800);
        const stats = await run.finish();

        expect(stats.workerCount).toBe(5);
        expect(stats.peakInFlight).toBeLessThanOrEqual(5);
        expect(stats.started).toBe(50);
        expect(stats.completed).toBe(50);
        expect(run.counts.confirmed).toBe(50);
        expect(broker.messages.filter(m => m.proposal)).toHaveLength(50);
        expect(broker.messages.filter(m => m.buy)).toHaveLength(50);
    });

    it('stops future purchases when a dispatched buy loses its acknowledgement', async () => {
        const broker = makeBroker({ disconnectOnBuy: index => index === 0 });
        const run = runBatch({ broker, quantity: 10, spacingMs: 500 });

        await jest.advanceTimersByTimeAsync(3_000);
        const stats = await run.finish();

        expect(run.counts.uncertain).toBe(1);
        expect(stats.started).toBe(1);
        expect(broker.messages.filter(m => m.buy)).toHaveLength(1);
        expect(broker.messages.filter(m => m.proposal)).toHaveLength(1);
    });

    it('prevents new orders after Stop but records already-confirmed buys', async () => {
        const broker = makeBroker({ quoteDelay: 30, buyDelay: 120 });
        const run = runBatch({ broker, quantity: 10, spacingMs: 500 });

        await jest.advanceTimersByTimeAsync(600);
        run.stop();
        await jest.advanceTimersByTimeAsync(3_000);
        const stats = await run.finish();

        expect(stats.started).toBeLessThan(10);
        expect(stats.started).toBeLessThanOrEqual(2);
        expect(broker.messages.filter(m => m.buy).length).toBeLessThanOrEqual(2);
        expect(run.records).toHaveLength(run.counts.confirmed);
    });

    it('measures expected 500ms versus 850ms start pacing with identical synthetic broker delays', async () => {
        const samples = [];
        for (const interval of [500, 850]) {
            const broker = makeBroker({ quoteDelay: 20, buyDelay: 50 });
            const run = runBatch({ broker, quantity: 7, spacingMs: interval });
            const first = Date.now();
            await jest.advanceTimersByTimeAsync(7_000);
            await run.finish();
            samples.push(broker.starts[6] - first);
        }
        expect(samples).toEqual([3000, 5100]);
        // Synthetic start-window improvement: (5100 - 3000) / 5100 = 41.2%.
        // This is NOT real Deriv broker throughput or a profitability claim.
    });
});

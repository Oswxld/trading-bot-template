import { requestBulkApi } from '../bulk-api-request';
import { classifyBulkFailure } from '../bulk-request-safety';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeMockApi = () => {
    const listeners = new Set();
    const closeListeners = new Set();
    const sent = [];
    const pending = [];

    const connection = {
        readyState: 1,
        send: jest.fn(frame => { sent.push(JSON.parse(frame)); }),
        addEventListener: jest.fn((type, callback) => {
            if (type === 'close') closeListeners.add(callback);
        }),
        removeEventListener: jest.fn((type, callback) => {
            if (type === 'close') closeListeners.delete(callback);
        }),
        close() {
            connection.readyState = 3;
            for (const callback of Array.from(closeListeners)) callback();
        },
    };

    const api = {
        connection,
        onMessage: () => ({
            subscribe: callback => {
                listeners.add(callback);
                return { unsubscribe: () => listeners.delete(callback) };
            },
        }),
        send: jest.fn(payload => {
            connection.send(JSON.stringify(payload));
            return new Promise((resolve, reject) => {
                pending.push({ payload, resolve, reject });
            });
        }),
    };

    const reply = (reqId, response) => {
        const data = { req_id: reqId, ...response };
        for (const callback of Array.from(listeners)) callback({ data });
    };
    return { api, connection, sent, pending, listeners, closeListeners, reply };
};

describe('Bulk Trader correlated Deriv request safety', () => {
    it('dispatches two buys without waiting for either confirmation and matches out-of-order replies', async () => {
        const ws = makeMockApi();
        const one = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal_1', price: 0.5 },
            reqId: 1001, timeout: 1000,
        });
        const two = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal_2', price: 0.5 },
            reqId: 1002, timeout: 1000,
        });

        await flush();
        expect(ws.sent.map(x => x.req_id)).toEqual([1001, 1002]);

        ws.reply(1002, { buy: { contract_id: 2002 } });
        ws.reply(1001, { buy: { contract_id: 2001 } });
        const [r1, r2] = await Promise.all([one, two]);

        expect(r1.buy.contract_id).toBe(2001);
        expect(r2.buy.contract_id).toBe(2002);
        expect(ws.listeners.size).toBe(0);
        expect(ws.closeListeners.size).toBe(0);
    });

    it('does not submit a queued buy after Stop', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1003, timeout: 1000, canSend: () => false,
        });

        await expect(pending).rejects.toMatchObject({
            bulkRequest: { kind: 'cancelled', dispatched: false },
        });
        expect(ws.sent).toHaveLength(0);
        expect(ws.listeners.size).toBe(0);
        expect(ws.closeListeners.size).toBe(0);
    });

    it('classifies an explicit Deriv buy error as failed rather than unconfirmed', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1004, timeout: 1000,
        });
        await flush();
        ws.reply(1004, { error: { code: 'InvalidContractProposal', message: 'Proposal expired' } });

        const error = await pending.then(() => null, e => e);
        expect(error.bulkRequest.kind).toBe('api_rejected');
        expect(classifyBulkFailure(error, 'buy').status).toBe('failed');
    });

    it('marks a dispatched buy UNCONFIRMED if the socket closes before acknowledgement', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1005, timeout: 1000,
        });
        await flush();
        ws.connection.close();

        const error = await pending.then(() => null, e => e);
        expect(error.bulkRequest).toMatchObject({
            kind: 'connection_lost', dispatched: true, requestType: 'buy',
        });
        expect(classifyBulkFailure(error, 'buy').status).toBe('unconfirmed');
        expect(ws.listeners.size).toBe(0);
    });

    it('never treats an unacknowledged timed-out buy as definitely failed', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1006, timeout: 20,
        });
        const error = await pending.then(() => null, e => e);
        expect(error.bulkRequest.kind).toBe('timeout');
        expect(classifyBulkFailure(error, 'buy')).toMatchObject({
            status: 'unconfirmed', stop: true, requiresStatementCheck: true,
        });
    });

    it('keeps the option to process a confirmation even after Stop when the buy was already sent', async () => {
        const ws = makeMockApi();
        let continueSending = true;
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1007, timeout: 1000,
            canSend: () => continueSending,
        });
        await flush();
        continueSending = false;
        ws.reply(1007, { buy: { contract_id: 7007 } });
        const result = await pending;
        expect(result.buy.contract_id).toBe(7007);
        expect(ws.sent).toHaveLength(1);
    });

    it('treats a rejected send promise without a req_id reply as an uncertain buy', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { buy: 'proposal', price: 0.5 },
            reqId: 1008, timeout: 1000,
        });
        await flush();
        ws.pending[0].reject(new Error('Network interruption'));
        const error = await pending.then(() => null, e => e);
        expect(error.bulkRequest.kind).toBe('send_rejected');
        expect(classifyBulkFailure(error, 'buy').status).toBe('unconfirmed');
    });

    it('rejects an unconfirmed proposal without claiming a purchase was made', async () => {
        const ws = makeMockApi();
        const pending = requestBulkApi({
            api: ws.api, payload: { proposal: 1, amount: 0.5 },
            reqId: 1009, timeout: 20,
        });
        const error = await pending.then(() => null, e => e);
        expect(classifyBulkFailure(error, 'proposal')).toMatchObject({
            status: 'failed', stop: true, requiresStatementCheck: false,
        });
    });
});

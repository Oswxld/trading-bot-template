/* eslint-disable @typescript-eslint/no-var-requires */
const createSocket = () => {
    const sent = [];
    const socket = {
        send: jest.fn(frame => { sent.push(frame); }),
    };
    return { socket, sent };
};

const sendTrade = (socket, payload = { proposal: 1 }) => {
    socket.send(JSON.stringify(payload));
};

describe('Deriv shared trading WebSocket request budget', () => {
    let limiter;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
        limiter = require('../trading-request-budget');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('counts proposal, buy, sell and contract-status frames sent by any shared WebSocket caller', () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        limiter.trackTradingSocket(socket); // Idempotent: never double-count.

        sendTrade(socket, { proposal: 1 });
        sendTrade(socket, { buy: 'test', price: 1 });
        sendTrade(socket, { sell: 123, price: 0 });
        sendTrade(socket, { proposal_open_contract: 1 });
        sendTrade(socket, { balance: 1 });
        sendTrade(socket, { ping: 1 });

        expect(limiter.tradingBudgetSnapshot()).toEqual(expect.objectContaining({
            minuteUsed: 4,
            hourUsed: 4,
            minuteLimit: limiter.TRADING_SOFT_LIMITS.minute,
            hourLimit: limiter.TRADING_SOFT_LIMITS.hour,
        }));
    });

    it('counts unexpected WebSocket frames conservatively', () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        socket.send('malformed frame');
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(1);
    });

    it('fails closed when another library overwrites the socket meter', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        socket.send = jest.fn();
        expect(() => limiter.trackTradingSocket(socket)).toThrow(/replaced/i);
        await expect(
            limiter.sendTradingRequestWithinBudget({ connection: socket }, () => sendTrade(socket), () => true)
        ).rejects.toThrow(/replaced/i);
        expect(socket.send).not.toHaveBeenCalled();
    });

    it('delays Bulk Trader at the 240/min soft cap and resumes when the window clears', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        for (let i = 0; i < limiter.TRADING_SOFT_LIMITS.minute; i++) sendTrade(socket);
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(240);

        const send = jest.fn(() => sendTrade(socket, { buy: 'proposal_id', price: 1 }));
        const pending = limiter.sendTradingRequestWithinBudget({ connection: socket }, send, () => true);
        await Promise.resolve();
        expect(send).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(59_000);
        expect(send).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2_000);
        await pending;
        expect(send).toHaveBeenCalledTimes(1);
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(1);
    });

    it('respects the 12,000/hour soft cap even after the minute window clears', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        for (let i = 0; i < limiter.TRADING_SOFT_LIMITS.hour; i++) sendTrade(socket);

        jest.setSystemTime(new Date('2026-11-11T00:01:01.000Z'));
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(0);
        expect(limiter.tradingBudgetSnapshot().hourUsed).toBe(12_000);

        const send = jest.fn(() => sendTrade(socket));
        const pending = limiter.sendTradingRequestWithinBudget({ connection: socket }, send, () => true);
        await Promise.resolve();
        expect(send).not.toHaveBeenCalled();

        // Jump wall clock forward instead of simulating 1,800 short polling cycles.
        jest.setSystemTime(new Date('2026-11-11T01:00:01.000Z'));
        await jest.advanceTimersByTimeAsync(2_000);
        await pending;
        expect(send).toHaveBeenCalledTimes(1);
        expect(limiter.tradingBudgetSnapshot().hourUsed).toBe(1);
    });

    it('never sends a queued purchase after Stop', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        for (let i = 0; i < limiter.TRADING_SOFT_LIMITS.minute; i++) sendTrade(socket);

        let running = true;
        const send = jest.fn(() => sendTrade(socket, { buy: 'proposal_id', price: 1 }));
        const pending = limiter.sendTradingRequestWithinBudget({ connection: socket }, send, () => running);
        await Promise.resolve();
        running = false;
        const rejected = expect(pending).rejects.toThrow(/stopped/i);
        await jest.advanceTimersByTimeAsync(2_000);
        await rejected;
        expect(send).not.toHaveBeenCalled();
    });

    it('serializes quota checks but dispatches five requests without waiting for their responses', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        await Promise.all(Array.from({ length: 5 }, (_, i) =>
            limiter.sendTradingRequestWithinBudget(
                { connection: socket },
                () => sendTrade(socket, { proposal: 1, req_id: i }),
                () => true
            )
        ));
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(5);
    });

    it('serializes simultaneous quota checks at the 240/min boundary', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        for (let i = 0; i < 239; i++) sendTrade(socket);

        const send = jest.fn(() => sendTrade(socket, { buy: 'proposal_id', price: 1 }));
        const pending = Array.from({ length: 5 }, () =>
            limiter.sendTradingRequestWithinBudget({ connection: socket }, send, () => true)
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(send).toHaveBeenCalledTimes(1);
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(240);

        await jest.advanceTimersByTimeAsync(61_000);
        await Promise.all(pending);
        expect(send).toHaveBeenCalledTimes(5);
    });

    it('observes but does not delay raw Bot Builder frames when Bulk Trader reaches its cap', () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);
        for (let i = 0; i < 240; i++) sendTrade(socket);
        // The existing app is NOT modified to await Bulk Trader's limiter.
        sendTrade(socket, { buy: 'other_component_purchase', price: 1 });
        expect(socket.send).toHaveBeenCalledTimes(241);
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(241);
    });

    it('does not hold the dispatch mutex while a previous buy waits for Deriv confirmation', async () => {
        const { socket } = createSocket();
        limiter.trackTradingSocket(socket);

        let confirmFirstBuy;
        const firstConfirmation = new Promise(resolve => { confirmFirstBuy = resolve; });
        const firstSend = jest.fn(() => {
            sendTrade(socket, { buy: 'first_proposal', price: 0.5 });
            return firstConfirmation;
        });
        const secondSend = jest.fn(() => {
            sendTrade(socket, { buy: 'second_proposal', price: 0.5 });
            return Promise.resolve({ buy: { contract_id: 222 } });
        });

        // Both WebSocket sends must happen BEFORE the first confirmation.
        const firstPermit = limiter.sendTradingRequestWithinBudget(
            { connection: socket }, firstSend, () => true
        );
        const secondPermit = limiter.sendTradingRequestWithinBudget(
            { connection: socket }, secondSend, () => true
        );

        await Promise.all([firstPermit, secondPermit]);
        expect(firstSend).toHaveBeenCalledTimes(1);
        expect(secondSend).toHaveBeenCalledTimes(1);
        expect(limiter.tradingBudgetSnapshot().minuteUsed).toBe(2);
        confirmFirstBuy({ buy: { contract_id: 111 } });
    });

    it('backs off on rate-limit rejection, caps backoff, and resets escalation after a quiet minute', () => {
        const { socket } = createSocket();
        const api = { connection: socket };
        expect(limiter.isTradingRateLimitError({ code: 'RateLimit' })).toBe(true);
        expect(limiter.isTradingRateLimitError({ message: 'Too many requests' })).toBe(true);
        expect(limiter.isTradingRateLimitError({ message: 'Invalid amount' })).toBe(false);

        limiter.noteTradingRateLimit(api);
        expect(limiter.tradingBudgetSnapshot().backoffRemainingMs).toBe(1_000);
        limiter.noteTradingRateLimit(api);
        expect(limiter.tradingBudgetSnapshot().backoffRemainingMs).toBe(2_000);
        for (let i = 0; i < 10; i++) limiter.noteTradingRateLimit(api);
        expect(limiter.tradingBudgetSnapshot().backoffRemainingMs).toBe(30_000);

        jest.setSystemTime(new Date('2026-11-11T00:01:01.000Z'));
        limiter.noteTradingRateLimit(api);
        expect(limiter.tradingBudgetSnapshot().backoffRemainingMs).toBe(1_000);
    });
});

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

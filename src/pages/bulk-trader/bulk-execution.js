/**
 * Bounded, paced scheduler for one-account bulk purchase operations.
 *
 * This module only schedules work. The Deriv proposal, buy, account guard,
 * request budget and settlement logic remain in BulkTrader.
 *
 * "In flight" means a trade operation has started but its async execute()
 * has not finished; it includes proposal and buy confirmation time. The
 * starting gap is a minimum spacing between *operation starts*, not between
 * completed purchases, and cannot override the API request-budget gate.
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const runBoundedBulkOperations = async ({
    quantity,
    maxConcurrent = 5,
    spacingMs = 500,
    shouldContinue,
    execute,
    onProgress = () => {},
    now = Date.now,
    wait = sleep,
}) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50 ||
        !Number.isInteger(maxConcurrent) || maxConcurrent < 1 ||
        !Number.isFinite(spacingMs) || spacingMs < 0 ||
        typeof shouldContinue !== 'function' || typeof execute !== 'function') {
        throw new Error('Invalid bulk execution configuration.');
    }

    const workerCount = Math.min(maxConcurrent, quantity);
    let reserved = 0;
    let started = 0;
    let completed = 0;
    let active = 0;
    let peakInFlight = 0;
    let nextStartAt = now();
    const startedAt = nextStartAt;

    const progress = () => onProgress({
        total: quantity,
        reserved,
        started,
        completed,
        active,
        peakInFlight,
    });

    // Synchronous reservations prevent two workers claiming the same index
    // and prevent extra attempts when the user's requested quantity is small.
    const reserve = async () => {
        if (!shouldContinue() || reserved >= quantity) return null;
        const index = reserved++;
        const scheduledAt = Math.max(now(), nextStartAt);
        nextStartAt = scheduledAt + spacingMs;

        // Small sleeps allow Stop and account-switch cancellation while waiting
        // for the next pacing slot, without starting a new proposal.
        while (shouldContinue() && now() < scheduledAt) {
            await wait(Math.min(100, scheduledAt - now()));
        }
        return shouldContinue() ? index : null;
    };

    const worker = async () => {
        while (shouldContinue()) {
            const index = await reserve();
            if (index === null) return;

            started++;
            active++;
            peakInFlight = Math.max(peakInFlight, active);
            progress();
            try {
                await execute(index);
            } finally {
                active--;
                completed++;
                progress();
            }
        }
    };

    // Always await all active workers, even if one unexpectedly throws;
    // do not pretend the entire batch is finished while other buys remain.
    const results = await Promise.allSettled(
        Array.from({ length: workerCount }, () => worker())
    );
    const error = results.find(result => result.status === 'rejected');
    const stats = {
        total: quantity,
        reserved,
        started,
        completed,
        peakInFlight,
        elapsedMs: now() - startedAt,
        workerCount,
    };
    if (error) throw error.reason;
    return stats;
};

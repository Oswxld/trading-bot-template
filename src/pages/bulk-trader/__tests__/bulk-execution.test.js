import { runBoundedBulkOperations } from '../bulk-execution';

describe('Bulk Trader bounded purchase scheduler', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each([1, 2, 3, 5, 7, 10, 50])(
        'attempts exactly %i selected operations without duplicates or extra orders',
        async quantity => {
            const attempted = [];
            const snapshots = [];
            const stats = await runBoundedBulkOperations({
                quantity,
                maxConcurrent: 5,
                spacingMs: 0,
                shouldContinue: () => true,
                execute: async index => { attempted.push(index); },
                onProgress: snapshot => snapshots.push(snapshot),
            });

            expect(attempted.slice().sort((a, b) => a - b)).toEqual(
                Array.from({ length: quantity }, (_, i) => i)
            );
            expect(stats).toEqual(expect.objectContaining({
                total: quantity,
                reserved: quantity,
                started: quantity,
                completed: quantity,
                workerCount: Math.min(5, quantity),
            }));
            expect(stats.peakInFlight).toBeLessThanOrEqual(Math.min(5, quantity));
            expect(snapshots.at(-1)).toEqual(expect.objectContaining({
                completed: quantity,
                active: 0,
            }));
        }
    );

    it('spaces operation starts by 500 ms when confirmations arrive immediately', async () => {
        const startTimes = [];
        const first = Date.now();
        const pending = runBoundedBulkOperations({
            quantity: 5,
            maxConcurrent: 5,
            spacingMs: 500,
            shouldContinue: () => true,
            execute: async () => { startTimes.push(Date.now() - first); },
        });

        await jest.advanceTimersByTimeAsync(2_500);
        await pending;
        expect(startTimes).toEqual([0, 500, 1000, 1500, 2000]);
    });

    it('keeps no more than five confirmations pending while starting the remaining trades', async () => {
        const started = [];
        let active = 0;
        let peak = 0;

        const pending = runBoundedBulkOperations({
            quantity: 10,
            maxConcurrent: 5,
            spacingMs: 0,
            shouldContinue: () => true,
            execute: async index => {
                started.push(index);
                active++;
                peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 100));
                active--;
            },
        });

        await jest.advanceTimersByTimeAsync(500);
        const stats = await pending;
        expect(started.slice().sort((a, b) => a - b)).toEqual(
            Array.from({ length: 10 }, (_, i) => i)
        );
        expect(peak).toBe(5);
        expect(stats.peakInFlight).toBe(5);
        expect(stats.completed).toBe(10);
    });

    it('never starts queued operations after Stop, even if they reserved pacing slots', async () => {
        let running = true;
        const started = [];
        const pending = runBoundedBulkOperations({
            quantity: 10,
            maxConcurrent: 5,
            spacingMs: 500,
            shouldContinue: () => running,
            execute: async index => {
                started.push(index);
                running = false;
            },
        });

        await jest.advanceTimersByTimeAsync(1_000);
        const stats = await pending;
        expect(started).toEqual([0]);
        expect(stats.completed).toBe(1);
        expect(stats.started).toBe(1);
        expect(stats.reserved).toBeLessThanOrEqual(5);
    });

    it('waits for already-started operations on unexpected errors before returning failure', async () => {
        let inFlight = 0;
        const promise = runBoundedBulkOperations({
            quantity: 10,
            maxConcurrent: 5,
            spacingMs: 0,
            shouldContinue: () => true,
            execute: async index => {
                inFlight++;
                try {
                    if (index === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                        throw new Error('Unexpected worker error');
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                } finally {
                    inFlight--;
                }
            },
        });

        const rejection = expect(promise).rejects.toThrow('Unexpected worker error');
        await jest.advanceTimersByTimeAsync(500);
        await rejection;
        expect(inFlight).toBe(0);
    });

    it('rejects invalid quantities instead of silently scheduling excess work', async () => {
        await expect(runBoundedBulkOperations({
            quantity: 51,
            shouldContinue: () => true,
            execute: async () => {},
        })).rejects.toThrow('Invalid bulk execution configuration.');
    });
});

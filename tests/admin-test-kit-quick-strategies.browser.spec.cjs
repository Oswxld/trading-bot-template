const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const ledger = page => page.evaluate(() => {
    const account = localStorage.getItem('active_loginid');
    return JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:' + account) || '[]')
        .filter(contract => contract.source === 'bot_builder')
        .sort((a, b) => a.contract_id - b.contract_id);
});

async function dismissTour(page) {
    const dialog = page.locator('.tour-dialog').first();
    if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /Skip/i }).click({ timeout: 10000 });
        await expect(dialog).toBeHidden({ timeout: 10000 });
    }
}

async function enterLocalMode(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dot = page.getByRole('button', { name: /Press and hold for 3 seconds to open local Admin Test Kit/i });
    await expect(dot).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(1500);
    await dismissTour(page);
    await dot.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3300);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 10000 });
    await dot.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    await dismissTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('yolo:local-admin-test')),
        { timeout: 20000 }).toBe('active');
}

async function launchQuickStrategy(page, matcher, winProbability = 0, settingsOverrides = {}) {
    await enterLocalMode(page);
    await page.evaluate(({ winProbability, settingsOverrides }) => {
        localStorage.setItem('qs-fields', JSON.stringify({
            symbol: 'R_100', tradetype: 'callput', type: 'CALL',
            durationtype: 't', duration: '1', stake: '1',
            // Do not let the first losing trade hit the strategies' built-in
            // stop threshold; the test controls when trading stops.
            profit: '1000', loss: '1000', size: '2', unit: '1',
            action: 'RUN', max_stake: 200, boolean_max_stake: false,
            last_digit_prediction: 5,
            ...settingsOverrides,
        }));
        // Force losses so stake recovery is deterministic and loss-threshold
        // behavior cannot be mistaken for a healthy Stop-button flow.
        sessionStorage.setItem('yolo:local-admin-win-probability', String(winProbability));
    }, { winProbability, settingsOverrides });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#quick-strategy')).toBeVisible({ timeout: 35000 });
    await dismissTour(page);
    await page.locator('#quick-strategy').click({ timeout: 12000 });
    await expect(page.locator('.strategy-template-picker__panel')).toBeVisible({ timeout: 15000 });
    const tour = page.locator('.tour-dialog').first();
    if (await tour.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true, () => false)) {
        await dismissTour(page);
    }
    const options = page.locator('.strategy-template-picker__strategy')
        .filter({ has: page.locator('.strategy-template-picker__title').getByText('Options', { exact: true }) });
    const select = options.locator('.strategy-template-picker__links')
        .filter({ hasText: matcher }).first();
    await expect(select).toBeVisible({ timeout: 15000 });
    await select.click({ timeout: 15000 });
    const run = page.getByTestId('qs-run-button');
    await expect(run).toBeEnabled({ timeout: 20000 });
    await run.click({ timeout: 15000 });
}

for (const { name, matcher } of [
    { name: 'Martingale', matcher: /^Martingale$/ },
    { name: "D'Alembert", matcher: /Alembert/i },
    { name: "Oscar's Grind", matcher: /Oscar.*Grind/i },
]) {
    test('6B: ' + name + ' repeats three settled trades, advances stake and stops without another buy',
        async ({ page }) => {
            page.on('dialog', async dialog => {
                if (dialog.type() === 'confirm') await dialog.accept();
                else await dialog.dismiss();
            });
            await launchQuickStrategy(page, matcher);
            // Repeating is not the same as an API accepting one purchase.
            await expect.poll(async () => (await ledger(page)).filter(c => c.is_sold).length,
                { timeout: 45000, intervals: [500, 800, 1000] }).toBeGreaterThanOrEqual(3);

            const executed = await ledger(page);
            const firstThree = executed.filter(c => c.is_sold).slice(0, 3);
            expect(new Set(firstThree.map(c => c.contract_id)).size).toBe(3);
            expect(new Set(firstThree.map(c => c.transaction_ids.buy)).size).toBe(3);
            for (let i = 0; i < 3; i++) {
                const contract = firstThree[i];
                expect(contract.status).toBe('lost');
                expect(contract.is_expired).toBe(1);
                expect(contract.tick_count).toBe(1);
                expect(contract.profit).toBeCloseTo(-contract.buy_price, 2);
                expect(contract.balance_after_sell).toEqual(expect.any(Number));
                expect(contract.transaction_ids.sell).toEqual(expect.any(Number));
                if (i > 0) {
                    // Trading loops in sequence; a new buy may share the
                    // settlement's whole-second timestamp, but not precede it.
                    expect(contract.purchase_time).toBeGreaterThanOrEqual(firstThree[i - 1].sell_time);
                }
            }
            const stakes = firstThree.map(c => c.buy_price);
            if (name === 'Martingale' || name === "D'Alembert") {
                expect(stakes[1]).toBeGreaterThan(stakes[0]);
                expect(stakes[2]).toBeGreaterThan(stakes[1]);
            } else {
                // Oscar's Grind increases after wins, not on a loss streak.
                expect(stakes[1]).toBe(stakes[0]);
                expect(stakes[2]).toBe(stakes[0]);
            }

            const stop = page.locator('#db-animation__stop-button');
            await expect(stop).toBeVisible({ timeout: 12000 });
            await stop.click({ timeout: 10000 });
            // Stopping should prevent new buys, but let an already open
            // contract settle. We assert both with the same ledger.
            const purchasedAtStop = (await ledger(page)).length;
            await expect.poll(async () => (await ledger(page)).every(c => c.is_sold),
                { timeout: 12000 }).toBe(true);
            await page.waitForTimeout(3000);
            const afterStop = await ledger(page);
            expect(afterStop).toHaveLength(purchasedAtStop);
            await expect(page.locator('#db-animation__run-button'))
                .toBeVisible({ timeout: 10000 });
            expect(afterStop.reduce((sum, contract) => sum + contract.buy_price, 0))
                .toBeGreaterThan(0);
            console.log('Step 6B ' + name + ': ' + JSON.stringify({
                settled: afterStop.length,
                stakes: afterStop.map(c => c.buy_price),
                stoppedWithoutNewBuys: true,
            }));
        }
    );
}

for (const { name, matcher } of [
    { name: 'Martingale', matcher: /^Martingale$/ },
    { name: "D'Alembert", matcher: /Alembert/i },
    { name: "Oscar's Grind", matcher: /Oscar.*Grind/i },
]) {
    test('6B: ' + name + ' continues after wins, credits payouts and stops cleanly',
        async ({ page }) => {
            page.on('dialog', async dialog => {
                if (dialog.type() === 'confirm') await dialog.accept();
                else await dialog.dismiss();
            });
            await launchQuickStrategy(page, matcher, 100);
            await expect.poll(async () => (await ledger(page)).filter(c => c.is_sold).length,
                { timeout: 45000, intervals: [500, 800, 1000] }).toBeGreaterThanOrEqual(3);

            const firstThree = (await ledger(page)).filter(c => c.is_sold).slice(0, 3);
            expect(new Set(firstThree.map(c => c.contract_id)).size).toBe(3);
            for (const contract of firstThree) {
                expect(contract.status).toBe('won');
                expect(contract.is_sold).toBe(1);
                expect(contract.sell_price).toBeGreaterThan(contract.buy_price);
                expect(contract.profit).toBeGreaterThan(0);
                expect(contract.balance_after_sell).toEqual(expect.any(Number));
                expect(contract.transaction_ids.sell).toEqual(expect.any(Number));
            }

            const stop = page.locator('#db-animation__stop-button');
            await expect(stop).toBeVisible({ timeout: 12000 });
            await stop.click({ timeout: 10000 });
            const countWhenStopped = (await ledger(page)).length;
            await expect.poll(async () => (await ledger(page)).every(c => c.is_sold),
                { timeout: 12000 }).toBe(true);
            await page.waitForTimeout(2500);
            expect(await ledger(page)).toHaveLength(countWhenStopped);
            await expect(page.locator('#db-animation__run-button'))
                .toBeVisible({ timeout: 10000 });

            console.log('Step 6B winning ' + name + ': ' + JSON.stringify({
                tradeCount: countWhenStopped,
                firstStakes: firstThree.map(c => c.buy_price),
                profits: firstThree.map(c => c.profit),
                stoppedWithoutNewBuys: true,
            }));
        }
    );
}


test('6B regression: Martingale with ordinary fresh form values buys on 50% local simulation', async ({ page }) => {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });
    // Unlike other 6B tests, this leaves qs-fields UNSEEDED and uses the
    // actual form defaults and user-entered P/L thresholds.
    await enterLocalMode(page);
    await expect(page.locator('#quick-strategy')).toBeVisible({ timeout: 35000 });
    await dismissTour(page);
    await page.locator('#quick-strategy').click({ timeout: 12000 });
    await expect(page.locator('.strategy-template-picker__panel')).toBeVisible({ timeout: 15000 });
    const botTour = page.locator('.tour-dialog').first();
    if (await botTour.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
        await dismissTour(page);
    }
    const options = page.locator('.strategy-template-picker__strategy')
        .filter({ has: page.locator('.strategy-template-picker__title').getByText('Options', { exact: true }) });
    await options.locator('.strategy-template-picker__links').filter({ hasText: /^Martingale$/ }).first().click();
    const settings = await page.evaluate(() => ({
        active: localStorage.getItem('active_loginid'),
        qs: localStorage.getItem('qs-fields'),
        simulator: sessionStorage.getItem('yolo:local-admin-test'),
    }));
    expect(settings.simulator).toBe('active');
    expect(settings.qs).toBeNull();

    await page.locator('input[name="profit"]').fill('100');
    await page.locator('input[name="loss"]').fill('100');
    const run = page.getByTestId('qs-run-button');
    await expect(run).toBeEnabled({ timeout: 20000 });
    await run.click();
    await expect.poll(async () => (await ledger(page)).length,
        { timeout: 30000, intervals: [500, 1000] }).toBeGreaterThan(0);
    // A completed first contract is not sufficient: Martingale must
    // re-enter Before Purchase and purchase new simulated contracts.
    await expect.poll(async () => (await ledger(page)).filter(c => c.is_sold).length,
        { timeout: 45000, intervals: [500, 1000] }).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#db-animation__stop-button')).toBeVisible();
    await page.locator('#db-animation__stop-button').click();
    console.log('Fresh Martingale form purchases:', JSON.stringify({
        settings, trades: (await ledger(page)).length,
    }));
});

test('6B regression: Martingale ends naturally after a one-trade profit limit and resets Run UI', async ({ page }) => {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });
    // A $2 stake settles with $1.60 profit at 100% wins. The configured
    // $1 threshold intentionally ends the generated XML after one trade.
    // This used to leave the UI stuck on "Bot running" forever because the
    // interpreter resolved normally without emitting bot.stop.
    await launchQuickStrategy(page, /^Martingale$/, 100, {
        stake: '2', profit: '1', loss: '1000',
    });
    await expect.poll(async () => (await ledger(page)).filter(c => c.is_sold).length,
        { timeout: 25000, intervals: [500, 1000] }).toBe(1);
    await expect(page.locator('#db-animation__run-button'))
        .toBeVisible({ timeout: 12000 });
    await expect(page.locator('.animation__text'))
        .toHaveText(/Bot is not running/, { timeout: 12000 });
    await page.waitForTimeout(2500);
    const settled = await ledger(page);
    expect(settled).toHaveLength(1);
    expect(settled[0].profit).toBeCloseTo(1.6, 2);
    console.log('Martingale natural completion resets UI:', JSON.stringify({
        contracts: settled.length, profit: settled[0].profit, running: false,
    }));
});

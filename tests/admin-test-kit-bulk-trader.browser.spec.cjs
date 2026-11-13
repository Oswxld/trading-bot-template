const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const accountId = 'VRTC_ADMIN_TEST';
const readPaper = page => page.evaluate(account =>
    JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:' + account) || '[]')
        .filter(contract => contract.source === 'bulk_trader'), accountId);
const readReports = page => page.evaluate(account =>
    JSON.parse(sessionStorage.getItem('bulk-trader:records:' + account) || '[]'), accountId);
const readBalance = page => page.evaluate(account =>
    JSON.parse(sessionStorage.getItem('yolo:local-admin-balances') || '{}')[account], accountId);

async function dismissWelcomeTour(page) {
    const tour = page.locator('.tour-dialog').first();
    if (await tour.isVisible().catch(() => false)) {
        await tour.getByRole('button', { name: /Skip/i }).click({ timeout: 10000 });
        await expect(tour).toBeHidden({ timeout: 10000 });
    }
}

async function enterAdminBulk(page, probability) {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dot = page.getByRole('button', {
        name: /Press and hold for 3 seconds to open local Admin Test Kit/i,
    });
    await expect(dot).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(1500);
    await dismissWelcomeTour(page);
    await dot.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3300);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' }))
        .toBeVisible({ timeout: 10000 });
    await dot.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    await dismissWelcomeTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('yolo:local-admin-test')),
        { timeout: 20000 }).toBe('active');
    await page.evaluate(value => {
        sessionStorage.setItem('yolo:local-admin-win-probability', String(value));
    }, probability);
    await page.goto('/#bulk_trader', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.bulk-trader__buttons')).toBeVisible({ timeout: 35000 });
    await dismissWelcomeTour(page);
    await expect(page.getByRole('region', { name: 'Bulk Trader' })).toBeVisible();
    await expect(page.locator('.bulk-trader__buy-a')).toBeEnabled({ timeout: 20000 });
}

async function enterBatchParameters(page, { quantity, duration = 1, stake = 0.5 } = {}) {
    const labels = page.locator('.bulk-trader__trade-grid label');
    await labels.filter({ hasText: 'NO OF TRADES' }).locator('input').fill(String(quantity));
    await labels.filter({ hasText: 'TICKS' }).locator('input').fill(String(duration));
    await labels.filter({ hasText: 'STAKE' }).locator('input').fill(String(stake));
    await expect(page.locator('.bulk-trader__total strong'))
        .toContainText((quantity * stake).toFixed(2));
}

async function beginBatch(page) {
    const button = page.locator('.bulk-trader__buy-a').first();
    await expect(button).toBeEnabled({ timeout: 25000 });
    await button.click();
}

async function waitForClosedBatch(page, count, { timeout = 30000 } = {}) {
    await expect.poll(async () => (await readPaper(page)).length,
        { timeout, intervals: [250, 500, 1000] }).toBe(count);
    await expect.poll(async () => (await readPaper(page)).filter(c => c.is_sold).length,
        { timeout, intervals: [250, 500, 1000] }).toBe(count);
    await expect.poll(async () => (await readReports(page)).filter(r => ['won', 'lost'].includes(r.status)).length,
        { timeout, intervals: [250, 500, 1000] }).toBe(count);
}

function assertNoDuplicateContracts(contracts, records) {
    expect(new Set(contracts.map(c => c.contract_id)).size).toBe(contracts.length);
    expect(new Set(contracts.map(c => c.transaction_ids.buy)).size).toBe(contracts.length);
    expect(new Set(contracts.map(c => c.transaction_ids.sell)).size).toBe(contracts.length);
    expect(new Set(records.map(r => r.localId)).size).toBe(records.length);
    expect(new Set(records.map(r => r.contractId)).size).toBe(records.length);
    expect(records.map(r => Number(r.contractId)).sort())
        .toEqual(contracts.map(c => c.contract_id).sort());
}

test('6D: five simultaneous simulated wins reconcile ledger, reports, journal and balance', async ({ page }) => {
    await enterAdminBulk(page, 100);
    await enterBatchParameters(page, { quantity: 5, stake: 0.5 });
    await beginBatch(page);
    await waitForClosedBatch(page, 5);

    const contracts = await readPaper(page);
    const reports = await readReports(page);
    assertNoDuplicateContracts(contracts, reports);
    expect(contracts.every(c => c.status === 'won' && c.profit === 0.4)).toBe(true);
    expect(reports.every(r => r.status === 'won' && r.profit === 0.4 && r.payout === 0.9)).toBe(true);
    expect(contracts.map(c => c.contract_id).length).toBe(5);

    const report = page.getByRole('complementary', { name: 'Bulk Trader reports' });
    await expect(report).toBeVisible();
    await expect(report.locator('.run-panel__tile').filter({ hasText: 'No. of runs' }))
        .toContainText('5');
    await expect(report.locator('.run-panel__tile').filter({ hasText: 'Total profit/loss' }))
        .toContainText('2.00');
    await report.getByRole('button', { name: 'Transactions' }).click();
    await expect(report.locator('.bulk-reports__transactions tbody tr')).toHaveCount(5);
    await expect(report.locator('.bulk-reports__transactions tbody'))
        .not.toContainText('No bulk trade transactions yet.');

    await report.getByRole('button', { name: 'Journal' }).click();
    await expect(report.locator('.bulk-reports__journal .bulk-reports__log'))
        .toHaveCount(11, { timeout: 18000 });
    await expect(report.locator('.bulk-reports__journal'))
        .toContainText(/settled WON/i);

    // Switching report tabs must retain the same five verified, settled rows.
    await report.getByRole('button', { name: 'Transactions' }).click();
    await expect(report.locator('.bulk-reports__transactions tbody tr')).toHaveCount(5);
    expect(await readBalance(page)).toBeCloseTo(10002.0, 2);
    console.log('6D winning batch:', JSON.stringify({ contracts: contracts.length, result: 'won', profit: 2 }));
});

test('6D: simultaneous simulated losses contribute zero realized payout and exact debits', async ({ page }) => {
    await enterAdminBulk(page, 0);
    await enterBatchParameters(page, { quantity: 4, stake: 1 });
    await beginBatch(page);
    await waitForClosedBatch(page, 4);
    const contracts = await readPaper(page);
    const reports = await readReports(page);
    assertNoDuplicateContracts(contracts, reports);
    expect(contracts.every(c => c.status === 'lost' && c.profit === -1 && c.sell_price === 0)).toBe(true);
    expect(reports.every(r => r.status === 'lost' && r.profit === -1 && r.payout === 0)).toBe(true);

    const report = page.getByRole('complementary', { name: 'Bulk Trader reports' });
    await expect(report.locator('.run-panel__tile').filter({ hasText: 'Total payout' }))
        .toContainText('0.00');
    await expect(report.locator('.run-panel__tile').filter({ hasText: 'Total profit/loss' }))
        .toContainText('-4.00');
    await report.getByRole('button', { name: 'Transactions' }).click();
    await expect(report.locator('.bulk-reports__transactions tbody tr')).toHaveCount(4);
    await report.getByRole('button', { name: 'Journal' }).click();
    await expect(report.locator('.bulk-reports__journal')).toContainText(/settled LOST/i);
    expect(await readBalance(page)).toBeCloseTo(9996, 2);
    console.log('6D losing batch:', JSON.stringify({ contracts: contracts.length, result: 'lost', profit: -4 }));
});

test('6D: Stop prevents new orders but already-open ten-tick contracts still settle', async ({ page }) => {
    await enterAdminBulk(page, 0);
    await enterBatchParameters(page, { quantity: 14, duration: 10, stake: 0.5 });
    await beginBatch(page);
    await expect.poll(async () => (await readPaper(page)).length,
        { timeout: 20000 }).toBeGreaterThanOrEqual(2);
    const stop = page.locator('.bulk-trader__stop');
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.locator('.bulk-trader__feedback'))
        .toContainText(/Stopped|Stopping/i, { timeout: 15000 });

    await expect.poll(async () => (await readPaper(page)).every(c => c.is_sold),
        { timeout: 20000, intervals: [500, 1000] }).toBe(true);
    const purchased = await readPaper(page);
    expect(purchased.length).toBeGreaterThanOrEqual(2);
    expect(purchased.length).toBeLessThan(14);
    expect(purchased.every(c => c.status === 'lost' && c.tick_count === 10)).toBe(true);

    await page.waitForTimeout(3500);
    expect(await readPaper(page)).toHaveLength(purchased.length);
    const reports = await readReports(page);
    expect(reports.filter(r => ['won', 'lost'].includes(r.status))).toHaveLength(purchased.length);
    expect(reports.filter(r => r.status === 'unconfirmed')).toHaveLength(0);
    expect(await readBalance(page)).toBeCloseTo(10000 - purchased.length * 0.5, 2);

    // A new controlled batch is permitted after Stop drains the scheduled
    // work. It must not inherit stale 'running' or 'unconfirmed' state.
    await expect(page.locator('.bulk-trader__buy-a')).toBeEnabled({ timeout: 10000 });
    console.log('6D stopped batch:', JSON.stringify({
        requested: 14, purchased: purchased.length, settled: purchased.length,
    }));
});

test('6D: report survives Bulk Trader navigation and explicit Reset does not change account balance', async ({ page }) => {
    await enterAdminBulk(page, 100);
    await enterBatchParameters(page, { quantity: 3 });
    await beginBatch(page);
    await waitForClosedBatch(page, 3);
    const settledContracts = await readPaper(page);
    const settledBalance = await readBalance(page);
    await page.goto('/#bot_builder', { waitUntil: 'domcontentloaded' });
    await page.goto('/#bulk_trader', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.bulk-trader__buttons')).toBeVisible({ timeout: 20000 });
    const report = page.getByRole('complementary', { name: 'Bulk Trader reports' });
    await report.getByRole('button', { name: 'Transactions' }).click();
    await expect(report.locator('.bulk-reports__transactions tbody tr')).toHaveCount(3);

    // Reset is a local report action, NOT a simulated broker account reset.
    await report.getByRole('button', { name: 'Reset' }).click();
    await expect(report.locator('.bulk-reports__transactions'))
        .toContainText('No bulk trade transactions yet.');
    expect(await readReports(page)).toEqual([]);
    expect(await readBalance(page)).toBe(settledBalance);
    expect(await readPaper(page)).toEqual(settledContracts);
    console.log('6D navigation and reset:', JSON.stringify({
        settled: settledContracts.length, reportReset: true, balancesPreserved: true,
    }));
});

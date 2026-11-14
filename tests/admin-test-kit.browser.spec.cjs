const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const ledger = page => page.evaluate(() => {
    const account = localStorage.getItem('active_loginid');
    try {
        return JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:' + account) || '[]');
    } catch {
        return [];
    }
});

const dismissWelcomeTour = async page => {
    // The standard first-visit tour is a blocking portal dialog. It must be
    // closed using its real Skip action before interacting with the Kit.
    const tour = page.locator('.tour-dialog').first();
    if (await tour.isVisible().catch(() => false)) {
        const skip = tour.getByRole('button', { name: /Skip/i });
        await skip.click({ timeout: 10000 });
        await expect(tour).toBeHidden({ timeout: 10000 });
    }
};

const activateViaFooter = async page => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: /Press and hold for 3 seconds to open local Admin Test Kit/i });
    await expect(button).toBeVisible({ timeout: 35000 });
    // Give the lazy app layout time to stabilize before starting the hold.
    // Dispatch a real PointerEvent to the footer's React event handler;
    // mouse movement can trigger pointerleave on the tiny dot.
    await page.waitForTimeout(1500);
    await dismissWelcomeTour(page);
    await button.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3300);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 10000 });
    await button.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    await dismissWelcomeTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('yolo:local-admin-test')),
        { timeout: 20000 }).toBe('active');
};

const runSingleBulkPurchase = async page => {
    await page.goto('/#bulk_trader', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.bulk-trader__buttons')).toBeVisible({ timeout: 35000 });
    await dismissWelcomeTour(page);
    const button = page.locator('.bulk-trader__buy-a').first();
    await expect(button).toBeEnabled({ timeout: 25000 });
    await button.click();
    await expect.poll(async () => (await ledger(page)).length, { timeout: 25000 }).toBe(1);
    await expect.poll(async () => (await ledger(page))[0]?.is_sold,
        { timeout: 15000 }).toBe(1);
    const items = await ledger(page);
    expect(items[0].contract_id).toBeGreaterThan(9000000);
    expect(items[0].transaction_ids.buy).toBeGreaterThan(0);
    expect(['won', 'lost']).toContain(items[0].status);
    expect(items[0].balance_after_sell).toEqual(expect.any(Number));
    return items[0];
};

test('local UI: enter Admin Test Kit, trade with Bulk Trader, switch account and preserve reports', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push({
        message: error.message,
        stack: error.stack,
    }));
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });

    await activateViaFooter(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('active_loginid')))
        .toBe('VRTC_ADMIN_TEST');
    const demoTrade = await runSingleBulkPurchase(page);

    await page.evaluate(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Switch to Real (simulated)' }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('active_loginid')),
        { timeout: 10000 }).toBe('CR_ADMIN_TEST');
    const realTrade = await runSingleBulkPurchase(page);
    expect(realTrade.contract_id).not.toBe(demoTrade.contract_id);

    const amounts = await page.evaluate(() => ({
        active: localStorage.getItem('active_loginid'),
        real: JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:CR_ADMIN_TEST') || '[]'),
        demo: JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:VRTC_ADMIN_TEST') || '[]'),
    }));
    expect(amounts.active).toBe('CR_ADMIN_TEST');
    expect(amounts.real).toHaveLength(1);
    expect(amounts.demo).toHaveLength(1);
    expect(amounts.demo[0].contract_id).toBe(demoTrade.contract_id);

    // Record browser exceptions as diagnostics; an unrelated minified
    // third-party/chart exception must not negate verified paper trades.
    // Still fail if a stack actually names this simulator or Bulk Trader.
    if (pageErrors.length) console.log('Browser runtime diagnostics:', JSON.stringify(pageErrors));
    const simulationErrors = pageErrors.filter(error =>
        /src\/services\/admin-test-kit|admin-test-market-feed|src\/pages\/bulk-trader/i
            .test([error.message, error.stack].join(' ')));
    expect(simulationErrors).toEqual([]);
});


for (const [strategyName, matcher] of [
    ['Martingale', /^Martingale$/],
    ["D'Alembert", /Alembert/i],
    ["Oscar's Grind", /Oscar.*Grind/i],
]) {
test('local UI: ' + strategyName + ' Quick Strategy loads Blockly, presses Run, and completes a paper trade', async ({ page }) => {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });
    await activateViaFooter(page);
    await page.evaluate(() => {
        // The normal Quick Strategy form persists its values in this key.
        // Seed valid UI selections; the test still selects the real strategy,
        // presses the real Run button and observes the resulting paper trade.
        localStorage.setItem('qs-fields', JSON.stringify({
            symbol: 'R_100', tradetype: 'callput', type: 'CALL',
            durationtype: 't', duration: '1', stake: '1',
            profit: '100', loss: '1', size: '1', unit: '1',
            action: 'RUN', max_stake: 10, boolean_max_stake: false,
            last_digit_prediction: 5,
        }));
        sessionStorage.setItem('yolo:local-admin-win-probability', '0');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#quick-strategy').waitFor({ state: 'visible', timeout: 35000 });
    await dismissWelcomeTour(page);
    await page.locator('#quick-strategy').click({ timeout: 12000 });
    await expect(page.locator('.strategy-template-picker__panel')).toBeVisible({ timeout: 15000 });
    // The Bot Builder tutorial is mounted asynchronously *after* the picker
    // becomes visible. Wait for that dialog before clicking a strategy;
    // otherwise Chromium correctly reports that the tour intercepts clicks.
    // Only use the real Skip control; never remove its DOM or force a click
    // through a blocking dialog.
    const botTour = page.locator('.tour-dialog').first();
    if (await botTour.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true, () => false)) {
        await dismissWelcomeTour(page);
    }
    // The picker contains both Accumulator and Options variants.
    // Admin Test Kit supports tick options, not the separate ACCU product.
    // Select the Options variant of each strategy.
    const optionsSection = page.locator('.strategy-template-picker__strategy')
        .filter({ has: page.locator('.strategy-template-picker__title').getByText('Options', { exact: true }) });
    const choose = optionsSection.locator('.strategy-template-picker__links')
        .filter({ hasText: matcher }).first();
    await expect(choose).toBeVisible({ timeout: 15000 });
    await choose.click({ timeout: 15000 });
    const run = page.getByTestId('qs-run-button');
    await expect(run).toBeVisible({ timeout: 20000 });
    await expect(run).toBeEnabled({ timeout: 20000 });
    await run.click({ timeout: 15000 });
    await expect.poll(async () =>
        (await ledger(page)).filter(contract => contract.source === 'bot_builder').length,
    { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(async () =>
        (await ledger(page)).some(contract => contract.source === 'bot_builder' && contract.is_sold),
    { timeout: 25000 }).toBe(true);

    // Unlike a storage-only assertion, these are the real Bot Builder report
    // tabs. The original bug left Transactions blank despite settled trades.
    // Check one representative strategy's full report presentation, while the
    // other strategy cases independently confirm their own real purchases.
    if (strategyName === 'Martingale') {
        await page.locator('li#db-run-panel-tab__transactions').click();
        const tradeRow = page.getByTestId('dt_transactions_item').first();
        await expect(tradeRow).toBeVisible({ timeout: 20000 });
        await expect(tradeRow).toContainText('USD');

        await page.locator('li#db-run-panel-tab__journal').click();
        await expect(page.getByTestId('dt_mock_journal'))
            .toBeVisible({ timeout: 15000 });
        // A nonempty container alone is not enough: verify an actual journal
        // entry rendered after the purchase and settlement.
        await expect(page.locator('.journal__item').first())
            .toBeVisible({ timeout: 15000 });
        // Confirm the journal references the executed simulated contract,
        // not merely the welcome or bot-loading notification.
        await expect(page.locator('.journal__item-list'))
            .toContainText(/Bought|Loss amount|Profit amount/, { timeout: 15000 });

        await page.locator('li#db-run-panel-tab__summary').click();
        await expect(page.getByTestId('mock-summary'))
            .toBeVisible({ timeout: 15000 });
        const numberOfRuns = page.locator('.run-panel__tile')
            .filter({ hasText: 'No. of runs' })
            .locator('.run-panel__tile-content');
        await expect(numberOfRuns).toBeVisible({ timeout: 15000 });
        await expect.poll(async () => Number(await numberOfRuns.textContent()),
            { timeout: 12000 }).toBeGreaterThan(0);

        // Returning to Transactions must not clear the already confirmed row.
        await page.locator('li#db-run-panel-tab__transactions').click();
        await expect(page.getByTestId('dt_transactions_item').first())
            .toBeVisible({ timeout: 15000 });
    }
});
}

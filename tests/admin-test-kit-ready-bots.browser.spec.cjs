const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const readyBots = [
    { name: 'RSI Direction', id: 'rsi-direction', contract: 'CALL' },
    { name: 'Moving Average', id: 'moving-average', contract: 'CALL' },
    { name: 'Bollinger Bands', id: 'bollinger-bands', contract: 'PUT' },
    { name: 'MACD Momentum', id: 'macd-momentum', contract: 'CALL' },
    { name: 'Digit Differs', id: 'digit-differs', contract: 'DIGITDIFF' },
    { name: 'Digit Over/Under', id: 'digit-over-under', contract: 'DIGITOVER' },
];

async function dismissTour(page) {
    const modal = page.locator('.tour-dialog').first();
    if (await modal.isVisible().catch(() => false)) {
        await modal.getByRole('button', { name: /Skip/i }).click({ timeout: 10000 });
        await expect(modal).toBeHidden({ timeout: 10000 });
    }
}

async function dismissDelayedBotTour(page) {
    // Importing a ready-made bot switches to the Bot Builder tab, whose
    // onboarding tour mounts asynchronously and intercepts clicks.
    // Dismiss it through the actual Skip button, never force clicks.
    const modal = page.locator('.tour-dialog').first();
    if (await modal.waitFor({ state: 'visible', timeout: 5500 }).then(() => true, () => false)) {
        await dismissTour(page);
    }
}

async function enterLocalMode(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dot = page.getByRole('button', { name: /Press and hold for 3 seconds to open local Admin Test Kit/i });
    await expect(dot).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(1200);
    await dismissTour(page);
    await dot.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3200);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 12000 });
    await dot.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    // The welcome tour may mount *after* the Admin Test Kit overlay appears.
    // Close its actual Skip action so it cannot intercept the Enter button.
    await dismissDelayedBotTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 12000 });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('yolo:local-admin-test')),
        { timeout: 20000 }).toBe('active');
    await expect(page.locator('#id-trading-bots')).toBeVisible({ timeout: 25000 });
    await dismissTour(page);
}

test('ready bots: Trading Bots tab is next to Bulk Trader and loads all six templates into Bot Builder', async ({ page }) => {
    test.setTimeout(145000);
    page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await enterLocalMode(page);
    const names = await page.locator('.dc-tabs__list--main__tabs li[id]')
        .evaluateAll(items => items.map(node => node.id));
    const bulkIndex = names.indexOf('id-bulk-trader');
    expect(bulkIndex).toBeGreaterThan(-1);
    expect(names[bulkIndex + 1]).toBe('id-trading-bots');

    await page.locator('#id-trading-bots').click();
    await expect(page.getByRole('region', { name: 'Trading bots' })).toBeVisible({ timeout: 12000 });
    await expect(page.locator('.trading-bots__card')).toHaveCount(6);

    for (const bot of readyBots) {
        const card = page.locator('.trading-bots__card')
            .filter({ has: page.getByRole('heading', { name: bot.name, exact: true }) });
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: /LOAD BOT INTO BUILDER/i }).click();
        await expect(page.locator('#id-bot-builder')).toHaveClass(/active/i, { timeout: 12000 });
        await expect.poll(async () => page.evaluate(() =>
            window.Blockly?.derivWorkspace?.getAllBlocks(true)
                ?.some(block => block.type === 'purchase' && block.getFieldValue('PURCHASE_LIST'))
        ), { timeout: 12000 }).toBe(true);
        const selected = await page.evaluate(() => {
            const blocks = window.Blockly.derivWorkspace.getAllBlocks(true);
            return {
                contracts: blocks.filter(b => b.type === 'purchase').map(b => b.getFieldValue('PURCHASE_LIST')),
                market: blocks.find(b => b.type === 'trade_definition_market')?.getFieldValue('SYMBOL_LIST'),
            };
        });
        expect(selected.market).toBe('R_100');
        expect(selected.contracts.length).toBeGreaterThan(0);
        console.log('Ready bot imported:', JSON.stringify({ name: bot.name, ...selected }));
        await dismissDelayedBotTour(page);
        await page.locator('#id-trading-bots').click({ timeout: 12000 });
        await expect(page.locator('.trading-bots__card')).toHaveCount(6);
    }
});

test('ready bots: importing Digit Differs allows simulated presentation to settle transactions', async ({ page }) => {
    test.setTimeout(95000);
    page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await enterLocalMode(page);
    await page.locator('#id-trading-bots').click();
    const card = page.locator('.trading-bots__card')
        .filter({ has: page.getByRole('heading', { name: 'Digit Differs', exact: true }) });
    await card.getByRole('button', { name: /LOAD BOT INTO BUILDER/i }).click();
    await expect(page.locator('#id-bot-builder')).toHaveClass(/active/i, { timeout: 12000 });
    await dismissDelayedBotTour(page);
    await page.evaluate(() => {
        sessionStorage.setItem('yolo:local-admin-win-probability', '100');
        sessionStorage.setItem('yolo:local-admin-execution', 'presentation');
    });
    await page.locator('#db-animation__run-button').click();
    const ledger = () => page.evaluate(() => {
        const id = localStorage.getItem('active_loginid');
        return JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:' + id) || '[]')
            .filter(c => c.source === 'bot_builder');
    });
    await expect.poll(async () => (await ledger()).filter(c => c.is_sold).length,
        { timeout: 32000, intervals: [400, 800, 1000] }).toBeGreaterThanOrEqual(2);
    await page.locator('#db-animation__stop-button').click();
    await expect(page.locator('#db-animation__run-button')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await ledger()).every(c => c.is_sold),
        { timeout: 16000 }).toBe(true);
    const records = await ledger();
    expect(records.every(c => c.contract_type === 'DIGITDIFF' && c.status === 'won')).toBe(true);
    await page.locator('li#db-run-panel-tab__transactions').click();
    await expect(page.getByTestId('dt_transactions_item').first()).toBeVisible({ timeout: 12000 });
    await page.locator('li#db-run-panel-tab__journal').click();
    await expect(page.locator('.journal__item-list')).toContainText(/Bought|Profit amount/, { timeout: 12000 });
});

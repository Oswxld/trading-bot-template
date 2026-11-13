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
    page.on('pageerror', error => pageErrors.push(error.message));
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

    // No unhandled app-level runtime exception is acceptable; avoid
    // attributing unrelated remote CDN requests to the simulator.
    expect(pageErrors).toEqual([]);
});

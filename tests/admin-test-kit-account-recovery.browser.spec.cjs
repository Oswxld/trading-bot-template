const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const DEMO = 'VRTC_ADMIN_TEST';
const REAL = 'CR_ADMIN_TEST';

const state = page => page.evaluate(([demo, real]) => {
    const json = (key, fallback) => {
        try { return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback)); }
        catch { return fallback; }
    };
    return {
        active: localStorage.getItem('active_loginid'),
        simulation: sessionStorage.getItem('yolo:local-admin-test'),
        balances: json('yolo:local-admin-balances', {}),
        demoContracts: json('yolo:local-admin-contracts:' + demo, []),
        realContracts: json('yolo:local-admin-contracts:' + real, []),
        demoRecords: json('bulk-trader:records:' + demo, []),
        realRecords: json('bulk-trader:records:' + real, []),
    };
}, [DEMO, REAL]);

async function dismissTour(page) {
    const modal = page.locator('.tour-dialog').first();
    if (await modal.isVisible().catch(() => false)) {
        await modal.getByRole('button', { name: /Skip/i }).click({ timeout: 10000 });
        await expect(modal).toBeHidden({ timeout: 10000 });
    }
}

async function enterAdminMode(page, winProbability = 100) {
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
    await dismissTour(page);
    await dot.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3300);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 10000 });
    await dot.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    await dismissTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 15000 });
    await expect.poll(async () => (await state(page)).simulation, { timeout: 20000 }).toBe('active');
    await page.evaluate(probability => {
        sessionStorage.setItem('yolo:local-admin-win-probability', String(probability));
    }, winProbability);
}

async function openBulk(page) {
    await page.goto('/#bulk_trader', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.bulk-trader__buttons')).toBeVisible({ timeout: 35000 });
    await dismissTour(page);
    await expect(page.locator('.bulk-trader__buy-a')).toBeEnabled({ timeout: 25000 });
}

async function purchaseOne(page, { duration = 1, stake = 0.5 } = {}) {
    const labels = page.locator('.bulk-trader__trade-grid label');
    await labels.filter({ hasText: 'NO OF TRADES' }).locator('input').fill('1');
    await labels.filter({ hasText: 'TICKS' }).locator('input').fill(String(duration));
    await labels.filter({ hasText: 'STAKE' }).locator('input').fill(String(stake));
    await page.locator('.bulk-trader__buy-a').first().click();
}

async function switchInTestKit(page, account) {
    await page.evaluate(() => window.dispatchEvent(new Event('yolo:admin-test-manage')));
    const dialog = page.getByRole('dialog', { name: 'Local Admin Test Kit' });
    await expect(dialog).toBeVisible({ timeout: 12000 });
    await dialog.getByRole('button', {
        name: account === REAL ? 'Switch to Real (simulated)' : 'Switch to Demo',
    }).click();
    await expect.poll(async () => (await state(page)).active, { timeout: 15000 }).toBe(account);
    // Verify the account is rebound to a fresh local transport, not merely a
    // modified localStorage ID on the previous account's socket.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await state(page)).active, { timeout: 15000 }).toBe(account);
}

test('6E: switching accounts while a contract is open preserves both ledgers and separate balances', async ({ page }) => {
    await enterAdminMode(page);
    await openBulk(page);
    await purchaseOne(page, { duration: 10 });
    await expect.poll(async () => (await state(page)).demoContracts.length, { timeout: 20000 }).toBe(1);
    const original = (await state(page)).demoContracts[0];
    expect(original.transaction_ids.buy).toEqual(expect.any(Number));
    expect(original.balance_after_buy).toBeCloseTo(9999.5, 2);

    await switchInTestKit(page, REAL);
    let snapshot = await state(page);
    expect(snapshot.demoContracts).toHaveLength(1);
    expect(snapshot.realContracts).toHaveLength(0);
    expect(snapshot.balances[REAL]).toBe(500);

    await openBulk(page);
    await purchaseOne(page);
    await expect.poll(async () => (await state(page)).realContracts.filter(c => c.is_sold).length,
        { timeout: 25000 }).toBe(1);
    const settledReal = await state(page);
    expect(settledReal.realContracts[0].contract_id).not.toBe(original.contract_id);
    expect(settledReal.realContracts[0].source).toBe('bulk_trader');
    expect(settledReal.balances[REAL]).toBeCloseTo(500.4, 2);

    await switchInTestKit(page, DEMO);
    await openBulk(page);
    await expect.poll(async () => (await state(page)).demoContracts.filter(c => c.is_sold).length,
        { timeout: 30000, intervals: [500, 1000] }).toBe(1);
    await expect.poll(async () => (await state(page)).demoRecords.filter(r => r.status === 'won').length,
        { timeout: 25000, intervals: [500, 1000] }).toBe(1);

    snapshot = await state(page);
    expect(snapshot.balances[DEMO]).toBeCloseTo(10000.4, 2);
    expect(snapshot.balances[REAL]).toBeCloseTo(500.4, 2);
    expect(snapshot.demoContracts[0].contract_id).toBe(original.contract_id);
    expect(snapshot.demoRecords.map(r => String(r.contractId))).toEqual([String(original.contract_id)]);
    expect(snapshot.realRecords).toHaveLength(1);

    // A hard refresh must not replay the confirmed purchase or settlement.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.bulk-trader__buttons')).toBeVisible({ timeout: 35000 });
    const refreshed = await state(page);
    expect(refreshed.demoContracts).toHaveLength(1);
    expect(refreshed.realContracts).toHaveLength(1);
    expect(refreshed.balances).toEqual(snapshot.balances);
    expect(refreshed.demoRecords.filter(r => r.status === 'won')).toHaveLength(1);
    console.log('6E account and refresh isolation:', JSON.stringify({
        demo: refreshed.balances[DEMO], real: refreshed.balances[REAL],
        demoContracts: refreshed.demoContracts.length, realContracts: refreshed.realContracts.length,
    }));
});

test('6E: navigation and hard reload recover one pending bulk contract without duplicate settlement', async ({ page }) => {
    await enterAdminMode(page, 0);
    await openBulk(page);
    await purchaseOne(page, { duration: 10, stake: 1 });
    await expect.poll(async () => (await state(page)).demoContracts.length, { timeout: 20000 }).toBe(1);
    const contractId = (await state(page)).demoContracts[0].contract_id;

    // Leaving the view must not cancel a purchased paper contract.
    // Its remaining ticks are persisted and restored with the simulator.
    await page.goto('/#bot_builder', { waitUntil: 'domcontentloaded' });
    await dismissTour(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openBulk(page);
    await expect.poll(async () => (await state(page)).demoContracts.filter(c =>
        c.contract_id === contractId && c.is_sold).length,
    { timeout: 30000, intervals: [500, 1000] }).toBe(1);
    await expect.poll(async () => (await state(page)).demoRecords.filter(r =>
        String(r.contractId) === String(contractId) && r.status === 'lost').length,
    { timeout: 25000, intervals: [500, 1000] }).toBe(1);

    const done = await state(page);
    expect(done.demoContracts).toHaveLength(1);
    expect(done.demoContracts[0].transaction_ids.sell).toEqual(expect.any(Number));
    expect(done.balances[DEMO]).toBeCloseTo(9999, 2);
    expect(done.balances[REAL]).toBe(500);
    await page.waitForTimeout(1500);
    const stable = await state(page);
    expect(stable.demoContracts).toEqual(done.demoContracts);
    expect(stable.balances).toEqual(done.balances);
    console.log('6E navigation/reload recovery:', JSON.stringify({
        id: contractId, status: stable.demoContracts[0].status, recovered: true,
    }));
});

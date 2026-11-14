const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4173' });

const paperTrades = page => page.evaluate(() => {
    const id = localStorage.getItem('active_loginid');
    return JSON.parse(sessionStorage.getItem('yolo:local-admin-contracts:' + id) || '[]')
        .filter(c => c.source === 'bot_builder')
        .sort((a, b) => a.contract_id - b.contract_id);
});

async function dismissTour(page) {
    const modal = page.locator('.tour-dialog').first();
    if (await modal.isVisible().catch(() => false)) {
        await modal.getByRole('button', { name: /Skip/i }).click({ timeout: 12000 });
        await expect(modal).toBeHidden({ timeout: 12000 });
    }
}

async function dismissDelayedBotTour(page) {
    // Bot Builder's tour is mounted asynchronously after navigation. A
    // one-off isVisible() check can miss it; wait for the portal dialog,
    // then click its real Skip button (never force-click through the overlay).
    const modal = page.locator('.tour-dialog').first();
    if (await modal.waitFor({ state: 'visible', timeout: 5500 })
        .then(() => true, () => false)) {
        await dismissTour(page);
    }
}

async function enterTestMode(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dot = page.getByRole('button', { name: /Press and hold for 3 seconds to open local Admin Test Kit/i });
    await expect(dot).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(1500);
    await dismissTour(page);
    await dot.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
    await page.waitForTimeout(3300);
    await expect(page.getByRole('dialog', { name: 'Local Admin Test Kit' })).toBeVisible({ timeout: 12000 });
    await dot.dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    await dismissTour(page);
    await page.getByRole('button', { name: 'Enter simulated admin mode' }).click({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('yolo:local-admin-test')),
        { timeout: 20000 }).toBe('active');
    // This suite specifically verifies actual Blockly buy/entry conditions.
    // Presentation mode intentionally does not execute those rules.
    await page.evaluate(() => sessionStorage.setItem('yolo:local-admin-execution', 'engine'));
    await page.goto('/#bot_builder', { waitUntil: 'domcontentloaded' });
    await dismissDelayedBotTour(page);
    await expect.poll(() => page.evaluate(() => Boolean(window.Blockly?.derivWorkspace?.cached_xml?.main)),
        { timeout: 20000 }).toBe(true);
}

/**
 * Construct a *normal, user-editable* Blockly workspace, without a Quick
 * Strategy form or its procedural functions. Start with the app's real
 * scratch/xml/main.xml root blocks, then replace purchase conditions using
 * native Blockly XML. The real Blockly generators, Run button, JS interpreter,
 * market subscriptions and simulated broker execute everything thereafter.
 */
async function createNormalBlocklyBot(page, {
    contract = 'CALL', condition = 'always', duration = 1,
} = {}) {
    const built = await page.evaluate(async params => {
        const B = window.Blockly;
        const workspace = B.derivWorkspace;
        if (!workspace?.cached_xml?.main) throw new Error('Blockly main workspace unavailable');
        const xml = B.utils.xml.textToDom(workspace.cached_xml.main);
        const setField = (name, value) => {
            const node = xml.querySelector('field[name="' + name + '"]');
            if (!node) throw new Error('Missing required Blockly field ' + name);
            node.textContent = String(value);
        };

        const isDigit = params.contract.startsWith('DIGIT');
        setField('MARKET_LIST', 'synthetic_index');
        setField('SUBMARKET_LIST', 'random_index');
        setField('SYMBOL_LIST', 'R_100');
        setField('TRADETYPECAT_LIST', isDigit ? 'digits' : 'callput');
        const needsPrediction = ['DIGITMATCH', 'DIGITDIFF'].includes(params.contract);
        setField('TRADETYPE_LIST', needsPrediction ? 'matchesdiffers' : isDigit ? 'evenodd' : 'callput');
        setField('TYPE_LIST', 'both');
        setField('DURATIONTYPE_LIST', 't');
        setField('NUM', params.duration);
        setField('PURCHASE_LIST', params.contract);
        setField('RESTARTONERROR', 'FALSE');

        if (needsPrediction) {
            const option = xml.querySelector('block[type="trade_definition_tradeoptions"]');
            const mutation = option?.querySelector('mutation');
            if (!option || !mutation) throw new Error('Trade options mutation unavailable');
            mutation.setAttribute('has_prediction', 'true');
            const prediction = xml.ownerDocument.createElement('value');
            prediction.setAttribute('name', 'PREDICTION');
            const number = xml.ownerDocument.createElement('shadow');
            number.setAttribute('type', 'math_number_positive');
            const digit = xml.ownerDocument.createElement('field');
            digit.setAttribute('name', 'NUM');
            digit.textContent = '5';
            number.appendChild(digit);
            prediction.appendChild(number);
            option.appendChild(prediction);
        }

        const stack = xml.querySelector('block[type="before_purchase"] > statement[name="BEFOREPURCHASE_STACK"]');
        if (!stack) throw new Error('Purchase conditions root not found');
        const directPurchase = '<block type="purchase"><field name="PURCHASE_LIST">' +
            params.contract + '</field></block>';
        if (params.condition === 'always') {
            stack.innerHTML = directPurchase;
        } else {
            const clause = params.condition === 'last_digit_gt_7'
                ? '<block type="logic_compare"><field name="OP">GT</field>' +
                  '<value name="A"><block type="last_digit"/></value>' +
                  '<value name="B"><block type="math_number"><field name="NUM">7</field></block></value></block>'
                : '<block type="logic_boolean"><field name="BOOL">FALSE</field></block>';
            stack.innerHTML = '<block type="controls_if"><value name="IF0">' + clause +
                '</value><statement name="DO0">' + directPurchase + '</statement></block>';
        }

        const eventGroup = 'dbot-load' + Date.now();
        B.Events.setGroup(eventGroup);
        try {
            await workspace.asyncClear();
            B.Xml.clearWorkspaceAndLoadFromXml(xml, workspace);
            workspace.cleanUp();
        } finally {
            B.Events.setGroup(false);
        }
        const roots = workspace.getTopBlocks(false).map(b => b.type);
        const values = workspace.getAllBlocks().filter(b => [
            'trade_definition_market', 'trade_definition_tradetype',
            'trade_definition_contracttype', 'purchase',
        ].includes(b.type)).map(b => ({
            type: b.type,
            symbol: b.getFieldValue('SYMBOL_LIST'),
            tradeType: b.getFieldValue('TRADETYPE_LIST'),
            contract: b.getFieldValue('PURCHASE_LIST'),
        }));
        return { roots, values, blockCount: workspace.getAllBlocks().length };
    }, { contract, condition, duration });

    expect(built.roots).toEqual(expect.arrayContaining([
        'trade_definition', 'before_purchase', 'after_purchase',
    ]));
    expect(built.values.some(b => b.type === 'purchase' && b.contract === contract))
        .toBe(true);
    expect(built.values.some(b => b.type === 'trade_definition_market' && b.symbol === 'R_100'))
        .toBe(true);
    console.log('Normal Blockly constructed: ' + JSON.stringify({ contract, condition, built }));
    await dismissTour(page);
}

async function expectThreeTradesAndStop(page, contractType) {
    const run = page.locator('#db-animation__run-button');
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click({ timeout: 15000 });

    // Must actually buy from the regular Blockly Purchase block, rather than
    // remain forever on "Waiting for signal to buy".
    await expect.poll(async () => (await paperTrades(page)).filter(c => c.is_sold).length,
        { timeout: 40000, intervals: [500, 1000] }).toBeGreaterThanOrEqual(3);
    const completed = (await paperTrades(page)).filter(c => c.is_sold).slice(0, 3);
    for (const row of completed) {
        expect(row.contract_type).toBe(contractType);
        expect(row.tick_count).toBe(1);
        expect(row.is_sold).toBe(1);
        expect(row.transaction_ids.buy).toEqual(expect.any(Number));
        expect(row.transaction_ids.sell).toEqual(expect.any(Number));
    }

    await expect(page.locator('#db-animation__stop-button')).toBeVisible({ timeout: 12000 });
    await page.locator('#db-animation__stop-button').click();
    const countAtStop = (await paperTrades(page)).length;
    await expect.poll(async () => (await paperTrades(page)).every(c => c.is_sold),
        { timeout: 13000 }).toBe(true);
    await page.waitForTimeout(2800);
    expect(await paperTrades(page)).toHaveLength(countAtStop);
    await expect(run).toBeVisible({ timeout: 10000 });
}

test('6C: ordinary Blockly Rise/Fall purchase loops three times, with no Quick Strategy', async ({ page }) => {
    page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await enterTestMode(page);
    await createNormalBlocklyBot(page, { contract: 'CALL' });
    await expectThreeTradesAndStop(page, 'CALL');
});

test('6C: normal Blockly last-digit tick condition waits for a signal, then trades repeatedly', async ({ page }) => {
    page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await enterTestMode(page);
    await createNormalBlocklyBot(page, { contract: 'DIGITEVEN', condition: 'last_digit_gt_7' });
    await expectThreeTradesAndStop(page, 'DIGITEVEN');
});

for (const { name, type, condition } of [
    { name: 'Fall', type: 'PUT', condition: 'always' },
    { name: 'Digit Odd', type: 'DIGITODD', condition: 'last_digit_gt_7' },
    { name: 'Digit Matches', type: 'DIGITMATCH', condition: 'always' },
    { name: 'Digit Differs', type: 'DIGITDIFF', condition: 'last_digit_gt_7' },
]) {
    test('6C: ordinary Blockly ' + name + ' loads real blocks, buys and repeats',
        async ({ page }) => {
            page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
            await enterTestMode(page);
            await createNormalBlocklyBot(page, { contract: type, condition });
            await expectThreeTradesAndStop(page, type);
        }
    );
}

test('6C: normal Blockly false purchase condition does not buy or falsely report a trade', async ({ page }) => {
    page.on('dialog', async d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await enterTestMode(page);
    await createNormalBlocklyBot(page, { contract: 'CALL', condition: 'never' });
    const run = page.locator('#db-animation__run-button');
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click({ timeout: 15000 });
    await page.waitForTimeout(3500);
    expect(await paperTrades(page)).toHaveLength(0);
    const stop = page.locator('#db-animation__stop-button');
    await expect(stop).toBeVisible({ timeout: 10000 });
    await stop.click();
    await expect(run).toBeVisible({ timeout: 12000 });
    await page.waitForTimeout(1200);
    expect(await paperTrades(page)).toHaveLength(0);
    // Restart the normal Blockly workspace after a deliberate Stop, with
    // purchase conditions changed from always-false to always-true.
    await createNormalBlocklyBot(page, { contract: 'CALL', condition: 'always' });
    await expectThreeTradesAndStop(page, 'CALL');
});


test('presentation: custom Blockly with NEVER purchase condition still simulates wins/losses and updates reports', async ({ page }) => {
    page.on('dialog', async dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
    await enterTestMode(page);
    // The condition is ALWAYS FALSE: in actual engine mode it must not buy,
    // but presentation mode must simulate its selected market/contract anyway.
    await createNormalBlocklyBot(page, { contract: 'DIGITMATCH', condition: 'never' });
    await page.evaluate(() => {
        sessionStorage.setItem('yolo:local-admin-execution', 'presentation');
        sessionStorage.setItem('yolo:local-admin-win-probability', '100');
    });
    const run = page.locator('#db-animation__run-button');
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click({ timeout: 15000 });
    await expect.poll(async () => (await paperTrades(page)).filter(c => c.is_sold).length,
        { timeout: 32000, intervals: [300, 600, 1000] }).toBeGreaterThanOrEqual(3);
    await page.locator('#db-animation__stop-button').click({ timeout: 12000 });
    await expect(run).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await paperTrades(page)).every(c => c.is_sold),
        { timeout: 16000 }).toBe(true);
    const rows = await paperTrades(page);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every(c => c.contract_type === 'DIGITMATCH' &&
        c.underlying_symbol === 'R_100' && c.status === 'won')).toBe(true);
    await page.locator('li#db-run-panel-tab__transactions').click();
    await expect(page.getByTestId('dt_transactions_item').first()).toBeVisible({ timeout: 12000 });
    await page.locator('li#db-run-panel-tab__journal').click();
    await expect(page.locator('.journal__item-list')).toContainText(/Bought|Profit amount/, { timeout: 12000 });
    const balance = await page.evaluate(() => {
        const id = localStorage.getItem('active_loginid');
        return JSON.parse(sessionStorage.getItem('yolo:local-admin-balances') || '{}')[id];
    });
    expect(balance).toBeGreaterThan(10000);
    console.log('Custom never-signal Blockly presentation succeeded:', JSON.stringify({
        contracts: rows.length, type: rows[0].contract_type, balance,
    }));
});

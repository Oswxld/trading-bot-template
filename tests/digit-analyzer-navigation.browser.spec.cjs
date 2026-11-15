const { test, expect } = require('@playwright/test');

test.use({ baseURL: 'http://127.0.0.1:4173' });

async function dismissTour(page) {
    const tour = page.locator('.tour-dialog').first();
    if (await tour.isVisible().catch(() => false)) {
        const skip = tour.getByRole('button', { name: /Skip/i });
        if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 10000 });
    }
}

async function verifyAnalysis(page) {
    await expect(page.locator('#id-analysis')).toBeVisible({ timeout: 40000 });
    await expect(page.getByRole('heading', { name: 'Digit Analyzer' })).toBeVisible({ timeout: 40000 });
    await expect(page.getByRole('status', { name: 'Not connected' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Market' })).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Digit distribution' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent ticks' })).toBeVisible();
    await expect(page.locator('.digit-analyzer__bar-column')).toHaveCount(10);
}

test('desktop: Analysis deep link and tab switches do not break neighboring tools', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await verifyAnalysis(page);
    await dismissTour(page);

    const ids = await page.locator('.dc-tabs__list--main__tabs li[id]').evaluateAll(elements => elements.map(element => element.id));
    expect(ids).toEqual([
        'id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-analysis',
        'id-bulk-trader', 'id-trading-bots', 'id-tutorials',
    ]);

    await page.locator('#id-trading-bots').click();
    await expect(page.getByRole('region', { name: 'Trading bots' })).toBeVisible({ timeout: 20000 });
    await page.locator('#id-analysis').click();
    await verifyAnalysis(page);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#analysis');
});

test('mobile: 10 digit bars, controls and cards remain inside 375px viewport', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await verifyAnalysis(page);
    await dismissTour(page);

    const positions = await page.evaluate(() => {
        const rect = selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width };
        };
        return {
            viewport: window.innerWidth,
            analyzer: rect('.digit-analyzer'),
            distribution: rect('.digit-analyzer__distribution'),
            firstBar: rect('.digit-analyzer__bar-column'),
            lastBar: (() => {
                const bars = document.querySelectorAll('.digit-analyzer__bar-column');
                if (!bars.length) return null;
                const box = bars[bars.length - 1].getBoundingClientRect();
                return { left: box.left, right: box.right, width: box.width };
            })(),
        };
    });
    expect(positions.analyzer).not.toBeNull();
    expect(positions.firstBar).not.toBeNull();
    expect(positions.lastBar).not.toBeNull();
    expect(positions.analyzer.left).toBeGreaterThanOrEqual(-1);
    expect(positions.analyzer.right).toBeLessThanOrEqual(positions.viewport + 1);
    expect(positions.distribution.right).toBeLessThanOrEqual(positions.viewport + 1);
    expect(positions.lastBar.right).toBeLessThanOrEqual(positions.viewport + 1);
    expect(positions.firstBar.width).toBeGreaterThan(0);
    expect(positions.lastBar.width).toBeGreaterThan(0);

    await page.getByRole('combobox', { name: 'Sample size' }).selectOption('500');
    await expect(page.getByRole('combobox', { name: 'Sample size' })).toHaveValue('500');
    await page.getByRole('combobox', { name: 'Over/Under threshold' }).selectOption('7');
    await expect(page.getByText('Over 7')).toBeVisible();
});

test('small mobile: all 10 bars stay within a 320px viewport', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await verifyAnalysis(page);

    const dimensions = await page.locator('.digit-analyzer__distribution').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { right: rect.right, viewport: window.innerWidth };
    });
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1);
});

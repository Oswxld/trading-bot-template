const { test, expect } = require('@playwright/test');

test.use({ baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure' });

/**
 * Intercept ONLY the Analyzer's isolated public endpoint. Keep every existing
 * trading/other app WebSocket untouched. Browser tests must be deterministic,
 * not depend on connectivity to the real broker.
 */
async function installMarketCatalogFixture(page, { fail = false } = {}) {
    await page.addInitScript(({ endpoint, failCatalog }) => {
        const NativeWebSocket = window.WebSocket;
        const telemetry = { opened: 0, closed: 0, active: 0, maximum: 0, historyRequests: [] };
        window.__digitAnalyzerSocketMetrics = telemetry;
        const markets = [
            {
                underlying_symbol: 'R_10',
                underlying_symbol_name: 'Volatility 10 Index',
                market: 'synthetic_index',
                exchange_is_open: 1,
                is_trading_suspended: 0,
                pip_size: 0.01,
            },
            {
                underlying_symbol: 'R_75',
                underlying_symbol_name: 'Volatility 75 Index',
                market: 'synthetic_index',
                exchange_is_open: 1,
                is_trading_suspended: 0,
                pip_size: 0.001,
            },
            {
                underlying_symbol: 'R_50',
                underlying_symbol_name: 'Volatility 50 Index',
                market: 'synthetic_index',
                exchange_is_open: 0,
                is_trading_suspended: 0,
            },
        ];

        class PublicCatalogSocket {
            constructor(url) {
                this.url = String(url);
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onerror = null;
                this.onclose = null;
                this.isClosed = false;
                this.subscriptions = new Set();
                telemetry.opened += 1;
                setTimeout(() => {
                    if (this.isClosed) return;
                    this.readyState = 1;
                    this.onopen?.(new Event('open'));
                }, 0);
            }

            send(payload) {
                const request = JSON.parse(payload);
                if (request.active_symbols) {
                    setTimeout(() => {
                        if (this.isClosed) return;
                        const response = failCatalog
                            ? { req_id: request.req_id, error: { message: 'Catalog unavailable' } }
                            : { req_id: request.req_id, msg_type: 'active_symbols', active_symbols: markets };
                        this.onmessage?.({ data: JSON.stringify(response) });
                    }, 0);
                } else if (request.ticks_history) {
                    // A one-off historical SNAPSHOT, never a subscription.
                    const count = request.count;
                    const symbol = request.ticks_history;
                    const precision = symbol === 'R_75' ? 2 : 3;
                    telemetry.historyRequests.push({ symbol, count, subscribed: !!request.subscribe });
                    const times = Array.from({ length: count }, (_, i) => 1770000000 - count + i);
                    const prices = Array.from({ length: count }, (_, i) => (
                        symbol === 'R_75' ? 987.21 + i % 10 / 100 : 123.201 + i % 10 / 1000
                    ));
                    setTimeout(() => {
                        if (this.isClosed) return;
                        this.onmessage?.({ data: JSON.stringify({
                            msg_type: 'history',
                            req_id: request.req_id,
                            echo_req: {
                                ticks_history: symbol, count,
                                end: 'latest', style: 'ticks',
                            },
                            pip_size: precision,
                            history: { prices, times },
                        }) });
                    }, 0);
                } else if (request.ticks) {
                    const symbol = request.ticks;
                    const streamId = 'stream-' + symbol;
                    if (!this.subscriptions.has(streamId)) {
                        this.subscriptions.add(streamId);
                        telemetry.active += 1;
                        telemetry.maximum = Math.max(telemetry.maximum, telemetry.active);
                    }
                    const quote = symbol === 'R_75' ? 987.654 : 123.45;
                    const pipSize = symbol === 'R_75' ? 2 : 3;
                    setTimeout(() => {
                        if (this.isClosed) return;
                        this.onmessage?.({ data: JSON.stringify({
                            msg_type: 'tick', req_id: request.req_id,
                            subscription: { id: streamId },
                            tick: { symbol, epoch: 1770000000, quote, pip_size: pipSize },
                        }) });
                    }, 0);
                } else if (request.forget) {
                    setTimeout(() => {
                        if (this.isClosed) return;
                        if (this.subscriptions.delete(request.forget)) telemetry.active -= 1;
                        this.onmessage?.({ data: JSON.stringify({
                            msg_type: 'forget', req_id: request.req_id, forget: 1,
                        }) });
                    }, 0);
                }
            }

            close() {
                if (this.isClosed) return;
                this.isClosed = true;
                telemetry.closed += 1;
                telemetry.active -= this.subscriptions.size;
                this.subscriptions.clear();
                this.readyState = 3;
                this.onclose?.(new Event('close'));
            }
        }

        function WebSocketWrapper(url, protocols) {
            if (String(url) === endpoint) return new PublicCatalogSocket(url);
            return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        }
        WebSocketWrapper.prototype = NativeWebSocket.prototype;
        for (const field of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
            Object.defineProperty(WebSocketWrapper, field, { value: NativeWebSocket[field] });
        }
        window.WebSocket = WebSocketWrapper;
    }, {
        endpoint: 'wss://api.derivws.com/trading/v1/options/ws/public',
        failCatalog: fail,
    });
}

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
    await expect(page.locator('.digit-analyzer__connection')).toContainText('Live');
    await expect(page.getByRole('note')).toContainText('2 synthetic markets available');
    await expect(page.getByRole('note')).toContainText('Receiving live ticks');
    await expect(page.getByRole('combobox', { name: 'Market' })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Market' })).toHaveValue('R_10');
    // Playwright's toBeDisabled() does not consistently inspect disabled <option> elements.
    // The native HTMLSelectElement still prevents selection of this option.
    await expect(page.getByRole('option', { name: 'Volatility 50 Index (closed)' })).toHaveAttribute('disabled', '');
    await expect(page.locator('.digit-analyzer__quote')).toHaveText('123.450');
    await expect(page.locator('.digit-analyzer__last-digit')).toHaveText('0');
    await expect(page.locator('.digit-analyzer__sample-count')).toContainText('1,000 / 1,000');
    await expect(page.getByRole('note')).toContainText('Historical and live observations are synchronized');
    await expect(page.getByRole('note')).toContainText('Receiving live ticks');
    await expect(page.getByRole('region', { name: 'Recent ticks' })).toContainText('123.450');
    await expect(page.getByRole('region', { name: 'Digit distribution' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent ticks' })).toBeVisible();
    await expect(page.locator('.digit-analyzer__bar-column')).toHaveCount(10);
    // All ten descriptive pattern scores are live, and only the true
    // highest (digit zero for this deterministic sample) receives green.
    const patternPanel = page.getByRole('region', { name: 'Digit pattern scores' });
    await expect(patternPanel).toBeVisible();
    await expect(patternPanel.locator('.digit-analyzer__pattern-digit')).toHaveCount(10);
    await expect(patternPanel.locator('.digit-analyzer__pattern-digit--leader')).toHaveCount(1);
    await expect(patternPanel.getByRole('group', {
        name: /Digit 0: .* pattern points, highest observed pattern score/,
    })).toBeVisible();
    await expect(patternPanel).toContainText('not a');
    await expect(patternPanel).toContainText('trading recommendation');
    // Real fixture history ends before the first live tick. The new digit 0
    // replaces the oldest digit 1: 101 zeros, 99 ones, 100 of every other.
    await expect(page.getByRole('group', { name: 'Digit 0: 101 of 1000 ticks (10.1%)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Digit 1: 99 of 1000 ticks (9.9%)' })).toBeVisible();
    const parity = page.getByRole('region', { name: 'Even / Odd' }).locator('.digit-analyzer__metric-row');
    await expect(parity.nth(0)).toContainText('501');
    await expect(parity.nth(0)).toContainText('50.1%');
    await expect(parity.nth(1)).toContainText('499');
    await expect(parity.nth(1)).toContainText('49.9%');
    const overUnder = page.getByRole('region', { name: 'Over / Under' }).locator('.digit-analyzer__metric-row');
    await expect(overUnder.nth(0)).toContainText('40.0%');
    await expect(overUnder.nth(1)).toContainText('50.0%');
    await expect(overUnder.nth(2)).toContainText('10.0%');
    const matches = page.getByRole('region', { name: 'Matches / Differs' }).locator('.digit-analyzer__metric-row');
    await expect(matches.nth(0)).toContainText('10.0%');
    await expect(matches.nth(1)).toContainText('90.0%');
}

test('desktop: Analysis deep link and tab switches do not break neighboring tools', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMarketCatalogFixture(page);
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await verifyAnalysis(page);
    await dismissTour(page);

    const ids = await page.locator('.dc-tabs__list--main__tabs li[id]').evaluateAll(elements => elements.map(element => element.id));
    expect(ids).toEqual([
        'id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-analysis',
        'id-bulk-trader', 'id-trading-bots', 'id-tutorials',
    ]);

    await expect.poll(() => page.evaluate(() => window.__digitAnalyzerSocketMetrics.active)).toBe(1);
    await page.locator('#id-trading-bots').click();
    await expect(page.getByRole('region', { name: 'Trading bots' })).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.evaluate(() => window.__digitAnalyzerSocketMetrics.active)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__digitAnalyzerSocketMetrics.closed)).toBe(1);
    await page.locator('#id-analysis').click();
    await verifyAnalysis(page);
    const totals = await page.evaluate(() => window.__digitAnalyzerSocketMetrics);
    expect(totals.opened).toBe(2);
    expect(totals.active).toBe(1);
    expect(totals.maximum).toBe(1);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#analysis');
});

test('mobile: 10 digit bars, controls and cards remain inside 375px viewport', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 375, height: 812 });
    await installMarketCatalogFixture(page);
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

    await page.getByRole('combobox', { name: 'Market' }).selectOption('R_75');
    await expect(page.getByRole('combobox', { name: 'Market' })).toHaveValue('R_75');
    await expect(page.getByRole('note')).toContainText('Selected: Volatility 75 Index');
    await expect(page.locator('.digit-analyzer__quote')).toHaveText('987.65');
    await expect(page.locator('.digit-analyzer__last-digit')).toHaveText('5');
    await expect(page.getByRole('region', { name: 'Recent ticks' })).not.toContainText('123.450');
    const subscriptions = await page.evaluate(() => window.__digitAnalyzerSocketMetrics);
    expect(subscriptions.active).toBe(1);
    expect(subscriptions.maximum).toBe(1);
    expect(subscriptions.historyRequests.some(r => r.symbol === 'R_75' && r.count === 1000)).toBe(true);

    await page.getByRole('combobox', { name: 'Sample size' }).selectOption('500');
    await expect(page.getByRole('combobox', { name: 'Sample size' })).toHaveValue('500');
    await expect(page.locator('.digit-analyzer__sample-count')).toContainText('500 / 500');
    await expect(page.getByRole('group', { name: 'Digit 5: 51 of 500 ticks (10.2%)' })).toBeVisible();
    const patternAfterResize = page.getByRole('region', { name: 'Digit pattern scores' });
    await expect(patternAfterResize.locator('.digit-analyzer__pattern-digit--leader')).toHaveCount(1);
    await expect(patternAfterResize.getByRole('group', {
        name: /Digit 5: .* pattern points, highest observed pattern score/,
    })).toBeVisible();
    const matchesAfterResize = page.getByRole('region', { name: 'Matches / Differs' }).locator('.digit-analyzer__metric-row');
    await expect(matchesAfterResize.nth(0)).toContainText('51');
    await expect(matchesAfterResize.nth(0)).toContainText('10.2%');
    const afterResize = await page.evaluate(() => window.__digitAnalyzerSocketMetrics);
    expect(afterResize.historyRequests.some(r => r.symbol === 'R_75' && r.count === 500)).toBe(true);
    expect(afterResize.historyRequests.every(r => !r.subscribed)).toBe(true);
    expect(afterResize.maximum).toBe(1);
    expect(afterResize.opened).toBe(1);
    await page.getByRole('combobox', { name: 'Over/Under threshold' }).selectOption('7');
    await expect(page.getByText('Over 7')).toBeVisible();
    const over7 = page.getByRole('region', { name: 'Over / Under' }).locator('.digit-analyzer__metric-row');
    await expect(over7.nth(0)).toContainText('20.0%');
    await expect(over7.nth(1)).toContainText('70.0%');
    await expect(over7.nth(2)).toContainText('10.0%');
    await page.getByRole('combobox', { name: 'Matches/Differs digit' }).selectOption('1');
    const matches1 = page.getByRole('region', { name: 'Matches / Differs' }).locator('.digit-analyzer__metric-row');
    await expect(matches1.nth(0)).toContainText('49');
    await expect(matches1.nth(0)).toContainText('9.8%');
    const noNewSubscriptions = await page.evaluate(() => window.__digitAnalyzerSocketMetrics);
    expect(noNewSubscriptions.active).toBe(1);
    expect(noNewSubscriptions.maximum).toBe(1);
    expect(noNewSubscriptions.historyRequests.length).toBe(afterResize.historyRequests.length);
});

test('small mobile: all 10 bars stay within a 320px viewport', async ({ page }) => {
    test.setTimeout(110000);
    await page.setViewportSize({ width: 320, height: 700 });
    await installMarketCatalogFixture(page);
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await verifyAnalysis(page);

    const dimensions = await page.locator('.digit-analyzer__distribution').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { right: rect.right, viewport: window.innerWidth };
    });
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1);
    const patternBounds = await page.locator('.digit-analyzer__pattern-grid').evaluate(element => {
        const digits = element.querySelectorAll('.digit-analyzer__pattern-digit');
        const rect = element.getBoundingClientRect();
        const last = digits[digits.length - 1].getBoundingClientRect();
        return {
            total: digits.length,
            columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
            left: rect.left,
            right: rect.right,
            lastRight: last.right,
            viewport: window.innerWidth,
        };
    });
    expect(patternBounds.total).toBe(10);
    expect(patternBounds.columns).toBe(5);
    expect(patternBounds.left).toBeGreaterThanOrEqual(-1);
    expect(patternBounds.right).toBeLessThanOrEqual(patternBounds.viewport + 1);
    expect(patternBounds.lastRight).toBeLessThanOrEqual(patternBounds.viewport + 1);
});

test('catalog network errors show a retry instead of false market prices', async ({ page }) => {
    test.setTimeout(110000);
    await installMarketCatalogFixture(page, { fail: true });
    await page.goto('/#analysis', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Digit Analyzer' })).toBeVisible({ timeout: 40000 });
    await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
    await expect(page.getByRole('combobox', { name: 'Market' })).toBeDisabled();
    await expect(page.getByText('No ticks received yet')).toBeVisible();
    await page.getByRole('button', { name: 'Retry markets' }).click();
    await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
});

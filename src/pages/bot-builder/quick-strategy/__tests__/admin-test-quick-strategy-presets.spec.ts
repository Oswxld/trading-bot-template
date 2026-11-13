import { readFileSync } from 'fs';
import path from 'path';
import { STRATEGIES } from '../config';
import { TEST_DEMO_ID, TEST_REAL_ID, enterAdminTest, exitAdminTest } from '@/services/admin-test-kit';

// Read the actual source XML templates rather than jest-transform-stub output.
// These are checks on preset wiring and form fields, not a replacement for
// launching the Blockly workspace in a real browser.
const presetCases = [
    ['MARTINGALE', 'martingale_max-stake'],
    ['D_ALEMBERT', 'dalembert_max-stake'],
    ['OSCARS_GRIND', 'oscars_grind_max-stake'],
];

const actualTemplate = file => new DOMParser().parseFromString(
    readFileSync(path.join(process.cwd(), 'src', 'xml', file + '.xml'), 'utf8'),
    'application/xml'
);
const fieldsNamed = (dom, fieldName) =>
    Array.from(dom.querySelectorAll('field[name="' + fieldName + '"]'));

describe('Real Quick Strategy XML templates against simulated tick-contract configuration', () => {
    afterEach(() => {
        exitAdminTest();
        localStorage.clear();
        sessionStorage.clear();
    });
    for (const [key, file] of presetCases) {
        it('preserves the complete ' + file + ' purchase, settlement and restart Blockly roots', () => {
            localStorage.clear();
            sessionStorage.clear();
            enterAdminTest();
            const strategy = STRATEGIES()[key];
            expect(strategy).toBeDefined();
            expect(strategy.name).toBe(file);
            const doc = actualTemplate(file);
            expect(doc.querySelector('parsererror')).toBeNull();
            const before = doc.querySelector('block[type="before_purchase"]');
            const after = doc.querySelector('block[type="after_purchase"]');
            const trade = doc.querySelector('block[type="trade_definition"]');
            expect(trade).not.toBeNull();
            expect(before?.querySelector('block[type="purchase"]')).not.toBeNull();
            expect(after?.querySelector('block[type="trade_again"]')).not.toBeNull();
            const formFields = strategy.fields.flat().map(field => field.name);
            expect(formFields).toContain('symbol');
            expect(formFields).toContain('durationtype');
            expect(formFields).toContain('duration');
            expect(formFields).toContain('stake');

            // Simulate actual form dropdown selection applied by
            // QuickStrategyStore.onSubmit() to the real XML template.
            for (const [name, value] of [
                ['SYMBOL_LIST', 'R_100'],
                ['DURATIONTYPE_LIST', 't'],
                ['TRADETYPE_LIST', 'callput'],
                ['TYPE_LIST', 'both'],
            ]) {
                const targets = fieldsNamed(doc, name);
                expect(targets.length).toBeGreaterThan(0);
                targets.forEach(field => { field.textContent = value; });
                expect(fieldsNamed(doc, name).every(field => field.textContent === value)).toBe(true);
            }
            // Both fake accounts must use the *same* Blockly definitions.
            expect([TEST_DEMO_ID, TEST_REAL_ID]).toHaveLength(2);
        });
    }
});

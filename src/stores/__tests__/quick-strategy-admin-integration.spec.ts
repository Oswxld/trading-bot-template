import { readFileSync } from 'fs';
import path from 'path';
import QuickStrategyStore from '../quick-strategy-store';
import { ApiHelpers, load } from '@/external/bot-skeleton';

jest.mock('@/external/bot-skeleton', () => ({
    ApiHelpers: {
        instance: { contracts_for: {
            getMarketBySymbol: jest.fn(async () => 'synthetic_index'),
            getSubmarketBySymbol: jest.fn(async () => 'volidx'),
            getTradeTypeCategoryByTradeType: jest.fn(async () => 'callput'),
        } },
    },
    config: () => ({
        QUICK_STRATEGY: { DEFAULT: { symbol: 'R_100', tradetype: 'callput', durationtype: 't' } },
    }),
    load: jest.fn(async () => undefined),
}));

const presetCases = [
    ['MARTINGALE', 'martingale_max-stake'],
    ['D_ALEMBERT', 'dalembert_max-stake'],
    ['OSCARS_GRIND', 'oscars_grind_max-stake'],
] as const;

describe('Quick Strategy form → real XML template → Bot Builder Run callback', () => {
    let root: any;
    let workspace: any;
    let rawXml: Document;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        jest.clearAllMocks();
        root = { run_panel: { onRunButtonClick: jest.fn() } };
        workspace = {
            waitForBlockEvent: jest.fn(() => Promise.resolve()),
        };
        (window as any).Blockly = {
            derivWorkspace: workspace,
            utils: { xml: {
                textToDom: jest.fn(() => rawXml),
            } },
            Xml: {
                domToText: jest.fn((doc: Document) => new XMLSerializer().serializeToString(doc)),
            },
            Events: { BLOCK_CREATE: 'create' },
        };
        (ApiHelpers.instance.contracts_for.getMarketBySymbol as jest.Mock)
            .mockResolvedValue('synthetic_index');
        (ApiHelpers.instance.contracts_for.getSubmarketBySymbol as jest.Mock)
            .mockResolvedValue('volidx');
        (ApiHelpers.instance.contracts_for.getTradeTypeCategoryByTradeType as jest.Mock)
            .mockResolvedValue('callput');
    });
    afterEach(() => {
        delete (window as any).Blockly;
        localStorage.clear();
        sessionStorage.clear();
    });

    it.each(presetCases)('%s loads the configured XML with a simulated symbol and schedules Run', async (key, file) => {
        rawXml = new DOMParser().parseFromString(
            readFileSync(path.join(process.cwd(), 'src', 'xml', file + '.xml'), 'utf8'),
            'application/xml'
        );
        const store = new QuickStrategyStore(root);
        store.setSelectedStrategy(key);
        store.setFormVisibility(true);
        (load as jest.Mock).mockImplementation(async (args: any) => {
            expect(args.workspace).toBe(workspace);
            expect(args.block_string).toContain('trade_definition');
            await Promise.resolve();
        });
        await store.onSubmit({
            symbol: 'R_100',
            tradetype: 'callput',
            type: 'CALL',
            action: 'RUN',
            durationtype: 't',
            duration: 1,
            stake: 1,
            profit: 10,
            loss: 5,
            size: 2,
            unit: 1,
            boolean_max_stake: false,
            max_stake: 5,
        });
        expect(load).toHaveBeenCalledTimes(1);
        expect(workspace.waitForBlockEvent).toHaveBeenCalledWith({
            block_type: 'trade_definition',
            event_type: 'create',
            timeout: 5000,
        });
        expect(rawXml.querySelector('field[name="SYMBOL_LIST"]')?.textContent).toBe('R_100');
        expect(rawXml.querySelector('field[name="DURATIONTYPE_LIST"]')?.textContent).toBe('t');
        expect(rawXml.querySelector('field[name="TRADETYPE_LIST"]')?.textContent).toBe('callput');
        expect(rawXml.querySelector('field[name="PURCHASE_LIST"]')?.textContent).toBe('CALL');
        expect(store.is_open).toBe(false);
        await Promise.resolve();
        expect(root.run_panel.onRunButtonClick).toHaveBeenCalledTimes(1);
    });
});

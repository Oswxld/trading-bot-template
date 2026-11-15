import { DBOT_TABS, TAB_HASHES, TAB_IDS } from '../bot-contents';

describe('Analysis navigation configuration', () => {
    it('keeps hash and DOM ID order aligned with numeric tab indices', () => {
        const expected = [
            ['DASHBOARD', 0, 'dashboard', 'id-dbot-dashboard'],
            ['BOT_BUILDER', 1, 'bot_builder', 'id-bot-builder'],
            ['CHART', 2, 'chart', 'id-charts'],
            ['ANALYSIS', 3, 'analysis', 'id-analysis'],
            ['BULK_TRADER', 4, 'bulk_trader', 'id-bulk-trader'],
            ['TRADING_BOTS', 5, 'trading_bots', 'id-trading-bots'],
            ['TUTORIAL', 6, 'tutorial', 'id-tutorials'],
        ] as const;

        expect(TAB_HASHES).toHaveLength(expected.length);
        expect(TAB_IDS).toHaveLength(expected.length);
        expected.forEach(([name, index, hash, elementId]) => {
            expect(DBOT_TABS[name]).toBe(index);
            expect(TAB_HASHES[index]).toBe(hash);
            expect(TAB_IDS[index]).toBe(elementId);
        });
    });

    it('preserves existing deep-link URL hashes', () => {
        expect(TAB_HASHES).toEqual([
            'dashboard',
            'bot_builder',
            'chart',
            'analysis',
            'bulk_trader',
            'trading_bots',
            'tutorial',
        ]);
    });
});

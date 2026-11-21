type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

// Keep these indices in the same order as the <Tabs> children in pages/main/main.tsx.
export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    ANALYSIS: 3,
    BULK_TRADER: 4,
    TRADING_BOTS: 5,
    TUTORIAL: 6,
});

// URL hashes remain stable even when display positions change.
export const TAB_HASHES: ReadonlyArray<string> = Object.freeze([
    'dashboard',
    'bot_builder',
    'chart',
    'analysis',
    'bulk_trader',
    'trading_bots',
    'tutorial',
]);

// Used to distinguish previously saved numeric indices (six-tab layout)
// from the seven-tab layout that includes Analysis.
export const TAB_LAYOUT_VERSION = '2';

export const MAX_STRATEGIES = 10;

export const TAB_IDS: ReadonlyArray<string> = Object.freeze([
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-analysis',
    'id-bulk-trader',
    'id-trading-bots',
    'id-tutorials',
]);

export const DEBOUNCE_INTERVAL_TIME = 500;

import { DBOT_TABS, TAB_HASHES, TAB_LAYOUT_VERSION } from '@/constants/bot-contents';

const LEGACY_TAB_HASHES = ['dashboard', 'bot_builder', 'chart', 'bulk_trader', 'trading_bots', 'tutorial'];

/** Resolve navigation using stable hashes; interpret old saved indices safely. */
export const getActiveTabUrl = () => {
    const hash = window.location.hash.slice(1);
    const persisted = localStorage.getItem('active_tab');
    const savedIndex = persisted !== null && /^\d+$/.test(persisted) ? Number(persisted) : DBOT_TABS.DASHBOARD;
    const isCurrentLayout = localStorage.getItem('active_tab_layout_version') === TAB_LAYOUT_VERSION;
    const availableHashes = isCurrentLayout ? TAB_HASHES : LEGACY_TAB_HASHES;
    const tabName = TAB_HASHES.includes(hash) ? hash : availableHashes[savedIndex] ?? TAB_HASHES[DBOT_TABS.DASHBOARD];

    return `${window.location.href.split('#')[0]}#${tabName}`;
};

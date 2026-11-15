import { TAB_LAYOUT_VERSION } from '@/constants/bot-contents';
import { getActiveTabUrl } from '../getActiveTabUrl';

describe('getActiveTabUrl with Analysis inserted at index 3', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState({}, '', '/?account=demo');
    });

    afterEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('interprets old saved index 3 as Bulk Trader until the new layout is saved', () => {
        localStorage.setItem('active_tab', '3');

        expect(getActiveTabUrl()).toBe(`${window.location.origin}/?account=demo#bulk_trader`);
    });

    it('interprets saved index 3 as Analysis for the seven-tab layout', () => {
        localStorage.setItem('active_tab', '3');
        localStorage.setItem('active_tab_layout_version', TAB_LAYOUT_VERSION);

        expect(getActiveTabUrl()).toBe(`${window.location.origin}/?account=demo#analysis`);
    });

    it('uses a valid current URL hash over a saved index', () => {
        localStorage.setItem('active_tab', '3');
        localStorage.setItem('active_tab_layout_version', TAB_LAYOUT_VERSION);
        window.history.replaceState({}, '', '/?account=demo#tutorial');

        expect(getActiveTabUrl()).toBe(`${window.location.origin}/?account=demo#tutorial`);
    });

    it('falls back to Dashboard for out-of-range or missing saved indices', () => {
        localStorage.setItem('active_tab', '999');

        expect(getActiveTabUrl()).toBe(`${window.location.origin}/?account=demo#dashboard`);
        localStorage.removeItem('active_tab');
        expect(getActiveTabUrl()).toBe(`${window.location.origin}/?account=demo#dashboard`);
    });
});

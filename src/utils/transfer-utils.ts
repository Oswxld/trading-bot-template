import { standalone_routes } from '@/components/shared/utils/routes/routes';
import { isAdminTestActive } from '@/services/admin-test-kit';
import { getInitialLanguage } from '@deriv-com/translations';
import { navigateToUrl } from './navigation-utils';

/**
 * Transfer is a Deriv-managed payment action, not a trade or a simulated
 * balance adjustment. Never send the site's OAuth token, fake login ID,
 * or client balance to Deriv in a URL.
 */
export const buildDerivTransferUrl = (currency: string): string | null => {
    const code = String(currency || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(code)) return null;

    try {
        const url = new URL(standalone_routes.transfer);
        // A funds-related redirect may only go to Deriv over HTTPS.
        if (url.protocol !== 'https:' || !/(^|\\.)deriv\\.(com|me|be)$/.test(url.hostname)) return null;
        url.searchParams.set('curr', code);

        const language = getInitialLanguage();
        if (language && /^[a-zA-Z]{2}(?:[-_][a-zA-Z]{2})?$/.test(language)) {
            url.searchParams.set('lang', language);
        }
        return url.toString();
    } catch {
        return null;
    }
};

/**
 * Sends a REAL account holder to Deriv's authenticated transfer screen.
 * Deriv, not this site, chooses eligible source/destination accounts and
 * confirms the transfer. The external Deriv session may require sign-in.
 *
 * Returns false instead of navigating during the local Admin Test Kit.
 */
export const navigateToTransfer = (currency: string): boolean => {
    if (isAdminTestActive()) return false;
    const url = buildDerivTransferUrl(currency);
    if (!url) return false;
    navigateToUrl(url, true);
    return true;
};

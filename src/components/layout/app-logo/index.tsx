// Logo and a discreet local-simulation shortcut for the site operator.
import brandConfig from '@/../brand.config.json';
import { ADMIN_TEST_MANAGE_EVENT, isAdminTestActive } from '@/services/admin-test-kit';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { BrandLogo } from './BrandLogo';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();
    const logoUrl = brandConfig.platform.logo.link_url || '/';

    if (!isDesktop) return null;

    return (
        <div className='app-header__brand'>
            <a href={logoUrl} className='app-header__logo' aria-label={localize('Home')}>
                <BrandLogo width={180} height={36} />
            </a>
            {isAdminTestActive() && (
                <button
                    type='button'
                    className='app-header__admin-mode-shortcut'
                    aria-label='Manage simulated test accounts'
                    title='Manage simulated test accounts'
                    onClick={() => window.dispatchEvent(new Event(ADMIN_TEST_MANAGE_EVENT))}
                >
                    D
                </button>
            )}
        </div>
    );
};

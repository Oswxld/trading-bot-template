import { ComponentProps, ReactNode, useMemo } from 'react';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import RootStore from '@/stores/root-store';
import { LegacyLogout1pxIcon, LegacyTheme1pxIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';

export type TSubmenuSection = 'accountSettings' | 'cashier' | 'reports';

// Simple in-app navigation icons — no new icon package required.
const TradingToolIcon = ({ iconSize: _iconSize, ...props }: ComponentProps<'svg'> & { iconSize?: string }) => (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' {...props}>
        <path d='M3 18h18M5 14l4-5 4 3 6-7' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
);
const BulkToolIcon = ({ iconSize: _iconSize, ...props }: ComponentProps<'svg'> & { iconSize?: string }) => (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' {...props}>
        <rect x='3' y='4' width='8' height='7' rx='1.3' />
        <rect x='13' y='4' width='8' height='7' rx='1.3' />
        <rect x='3' y='13' width='8' height='7' rx='1.3' />
        <rect x='13' y='13' width='8' height='7' rx='1.3' />
    </svg>
);

//IconTypes
type TMenuConfig = {
    LeftComponent: React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
    isActive?: boolean;
}[];

const useMobileMenuConfig = (
    client?: RootStore['client'],
    onLogout?: () => void,
    enableThemeToggle: boolean = true
) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    const menuConfig = useMemo((): TMenuConfig[] => {

        return [
            [
                {
                    as: 'a',
                    label: localize('Trading Bot'),
                    LeftComponent: TradingToolIcon,
                    href: '/',
                    isActive: window.location.pathname === '/',
                },
                {
                    as: 'a',
                    label: localize('Bulk Trader'),
                    LeftComponent: BulkToolIcon,
                    href: '/bulk-trader',
                    isActive: window.location.pathname === '/bulk-trader',
                },
                // ========================================
                // CUSTOM MENU ITEMS PLACEHOLDER
                // ========================================
                //
                // Add your custom menu items here.
                //
                // EXAMPLE:
                // {
                //     as: 'a',
                //     label: localize('Your Page'),
                //     LeftComponent: YourIcon,
                //     href: '/your-page',
                // },
                //
                // For desktop menu items, see:
                // src/components/layout/header/header-config.tsx

                // Conditionally include theme toggle based on brand config
                enableThemeToggle && {
                    as: 'button',
                    label: localize('Dark theme'),
                    LeftComponent: LegacyTheme1pxIcon,
                    RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
                },
            ].filter(Boolean) as TMenuConfig,
            [
                client?.is_logged_in &&
                    onLogout && {
                        as: 'button',
                        label: localize('Log out'),
                        LeftComponent: LegacyLogout1pxIcon,
                        onClick: onLogout,
                        removeBorderBottom: true,
                    },
            ].filter(Boolean) as TMenuConfig,
        ].filter(section => section.length > 0);
    }, [
        client,
        onLogout,
        is_dark_mode_on,
        toggleTheme,
        localize,
        enableThemeToggle, // [AI] Added to recalculate menu when theme toggle config changes
    ]);

    // [AI] Check if menu has any items to determine if mobile menu should be shown
    const hasMenuItems = menuConfig.some(section => section.length > 0);
    // [/AI]

    return {
        config: menuConfig,
        // [AI] Return flag indicating if menu has any items
        hasMenuItems,
        // [/AI]
    };
};

export default useMobileMenuConfig;

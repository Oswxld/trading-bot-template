import React from 'react';
import classNames from 'classnames';
import { ADMIN_TEST_OPEN_EVENT, isAdminTestActive } from '@/services/admin-test-kit';
import { Icon } from '@/utils/tmp/dummy';
import Counter from '../counter';

type TTabProps = {
    active_icon_color?: string;
    active_tab_ref?: React.RefObject<HTMLLIElement> | null;
    bottom?: boolean;
    className?: string;
    count: number;
    header_content: React.ReactElement;
    header_fit_content?: boolean;
    icon_color?: string;
    icon_size?: number;
    icon: string;
    id?: string;
    is_active: boolean;
    is_label_hidden?: boolean;
    is_scrollable?: boolean;
    label: string;
    onClick: () => void;
    setActiveLineStyle: () => void;
    top: boolean;
};

const Tab = ({
    active_icon_color = '',
    active_tab_ref,
    bottom = false,
    className = '',
    count,
    header_content,
    header_fit_content = false,
    icon_color = '',
    icon_size = 0,
    icon,
    id = '',
    is_active,
    is_label_hidden,
    is_scrollable,
    label,
    onClick,
    setActiveLineStyle,
    top,
}: TTabProps) => {
    React.useEffect(() => {
        setActiveLineStyle();
    }, [count, label, header_content, setActiveLineStyle]);

    const classes = classNames('dc-tabs__item', {
        'dc-tabs__active': is_active,
        [`dc-tabs__active--${className}`]: className && is_active,
        'dc-tabs__item--top': top,
        'dc-tabs__item--bottom': bottom,
        'dc-tabs__item--header-fit-content': header_fit_content,
        'dc-tabs__item--is-hidden': is_label_hidden,
        [`dc-tabs__item--${className}`]: className,
        'dc-tabs__item--is-scrollable-and-active': is_scrollable && is_active,
    });
    const title_color = is_active ? active_icon_color : icon_color;
    const is_dashboard_shortcut = id === 'id-dbot-dashboard';
    const hold_timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const pointer_start = React.useRef<{ x: number; y: number } | null>(null);
    const opened_by_hold = React.useRef(false);

    const cancelHold = React.useCallback(() => {
        if (hold_timer.current !== null) {
            clearTimeout(hold_timer.current);
            hold_timer.current = null;
        }
        pointer_start.current = null;
    }, []);

    React.useEffect(() => () => cancelHold(), [cancelHold]);

    const startHold = () => {
        if (!is_dashboard_shortcut || !isAdminTestActive() || hold_timer.current !== null) return;
        opened_by_hold.current = false;
        hold_timer.current = setTimeout(() => {
            hold_timer.current = null;
            opened_by_hold.current = true;
            window.dispatchEvent(new Event(ADMIN_TEST_OPEN_EVENT));
        }, 3000);
    };

    const selectTab = (event: React.MouseEvent<HTMLLIElement>) => {
        // A completed long press must NOT also navigate to the Dashboard.
        if (opened_by_hold.current) {
            event.preventDefault();
            event.stopPropagation();
            opened_by_hold.current = false;
            return;
        }
        onClick();
    };

    return (
        <li
            id={id}
            className={classes}
            style={{ color: title_color }}
            onClick={selectTab}
            onPointerDown={event => {
                if (!is_dashboard_shortcut || (event.pointerType === 'mouse' && event.button !== 0)) return;
                pointer_start.current = { x: event.clientX, y: event.clientY };
                startHold();
            }}
            onPointerMove={event => {
                if (!pointer_start.current) return;
                // A swipe through the horizontal navigation should never open the panel.
                if (
                    !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
                    Math.abs(event.clientX - pointer_start.current.x) > 12 ||
                    Math.abs(event.clientY - pointer_start.current.y) > 12
                ) cancelHold();
            }}
            onPointerUp={cancelHold}
            onPointerCancel={() => { cancelHold(); opened_by_hold.current = false; }}
            onPointerLeave={() => { cancelHold(); opened_by_hold.current = false; }}
            onContextMenu={event => { if (is_dashboard_shortcut) event.preventDefault(); }}
            onKeyDown={event => {
                if (!is_dashboard_shortcut || event.repeat) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    startHold();
                }
            }}
            onKeyUp={event => {
                if (!is_dashboard_shortcut || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                const wasHold = opened_by_hold.current;
                cancelHold();
                opened_by_hold.current = false;
                if (!wasHold) onClick();
            }}
            onBlur={() => { cancelHold(); opened_by_hold.current = false; }}
            tabIndex={is_dashboard_shortcut && isAdminTestActive() ? 0 : undefined}
            ref={active_tab_ref}
        >
            {icon && <Icon icon={icon} size={icon_size} custom_color={title_color} className='dc-tabs__item__icon' />}
            {header_content || label}
            {!!count && <Counter className='dc-tabs__item__counter' count={count} />}
        </li>
    );
};

export default Tab;

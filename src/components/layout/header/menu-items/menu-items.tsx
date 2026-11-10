import { observer } from 'mobx-react-lite';
import './menu-items.scss';

export const MenuItems = observer(() => (
    <nav className='white-label-nav' aria-label='Trading tools'>
        <a href='/' className={window.location.pathname === '/' ? 'white-label-nav__active' : ''}>
            Trading Bot
        </a>
        <a href='/bulk-trader' className={window.location.pathname === '/bulk-trader' ? 'white-label-nav__active' : ''}>
            Bulk Trader
        </a>
    </nav>
));

export const TradershubLink = observer(() => null);

type MenuItemsType = typeof MenuItems & {
    TradershubLink: typeof TradershubLink;
};

(MenuItems as MenuItemsType).TradershubLink = TradershubLink;

export default MenuItems as MenuItemsType;

import { useMemo } from 'react';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { isVirtualAccount } from '@/utils/account-helpers';
import { parseFiniteBalance } from '@/utils/balance-utils';
import { isAdminTestActive } from '@/services/admin-test-kit';
/* [/AI] */
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { Balance } from '@deriv/api-types';

/** A custom hook that returns the account object for the current active account. */
const useActiveAccount = ({
    allBalanceData,
    directBalance,
}: {
    allBalanceData: Balance | null;
    directBalance?: string;
}) => {
    const { accountList, activeLoginid, isAuthorized, authData } = useApiBase();

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    const currentBalanceData = allBalanceData?.accounts?.[activeAccount?.loginid ?? ''];

    const modifiedAccount = useMemo(() => {
        if (!activeAccount) return undefined;

        // Use centralized utility to determine if demo account
        const isVirtual = isVirtualAccount(activeAccount.loginid);

        // The simulator keeps its existing local balances. Live accounts only
        // display a balance after the selected account has been authorized.
        const simulated = isAdminTestActive();
        const verifiedLive = isAuthorized && authData?.loginid === activeAccount.loginid;
        const amount = simulated
            ? parseFiniteBalance(currentBalanceData?.balance) ?? parseFiniteBalance(directBalance) ?? 0
            : verifiedLive
              ? parseFiniteBalance(currentBalanceData?.balance) ??
                parseFiniteBalance(directBalance) ??
                parseFiniteBalance(authData?.balance)
              : null;

        return {
            ...activeAccount,
            balance: amount === null ? '—' : addComma(amount.toFixed(getDecimalPlaces(activeAccount.currency))),
            currencyLabel: isVirtual ? 'Demo' : activeAccount?.currency,
            icon: <CurrencyIcon currency={activeAccount?.currency?.toLowerCase()} isVirtual={isVirtual} />,
            isVirtual: isVirtual,
            isActive: activeAccount?.loginid === activeLoginid,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount, activeLoginid, allBalanceData, directBalance, isAuthorized, authData]);

    return {
        /** User's current active account. */
        data: modifiedAccount,
    };
};

export default useActiveAccount;

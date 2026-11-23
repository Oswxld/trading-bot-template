import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    isAdminTestActive, isAdminTestRequested, isAdminTestSessionReady,
    getAdminTestAccounts, getAdminTestBalances,
    TEST_DEMO_ID, TEST_REAL_ID,
} from '@/services/admin-test-kit';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { placeNextDigitMatch, preflightNextDigitAccount } from '../services/next-digit-order';
import NextDigitTrader from '../components/next-digit-trader';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: null, account_id: '', account_info: {},
        is_authorized: true, is_running: false,
        ensureAdminTestSession: jest.fn(async () => true),
    },
}));
jest.mock('@/services/admin-test-kit', () => ({
    isAdminTestActive: jest.fn(),
    isAdminTestRequested: jest.fn(),
    isAdminTestSessionReady: jest.fn(),
    getAdminTestAccounts: jest.fn(),
    getAdminTestBalances: jest.fn(),
    TEST_DEMO_ID: 'VRTC_ADMIN_TEST',
    TEST_REAL_ID: 'CR_ADMIN_TEST',
}));
jest.mock('@/services/oauth-token-exchange.service', () => ({
    OAuthTokenExchangeService: { getAccessToken: jest.fn() },
}));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: {
        getStoredAccounts: jest.fn(() => []),
        fetchAccountsList: jest.fn(),
    },
}));
jest.mock('../services/next-digit-order', () => ({
    preflightNextDigitAccount: jest.fn(async () => 100),
    placeNextDigitMatch: jest.fn(),
}));
jest.mock('@/pages/bulk-trader/bulk-request-safety', () => ({
    acquireBulkRun: jest.fn(() => true),
    releaseBulkRun: jest.fn(),
}));

const modes = [
    { id: TEST_DEMO_ID, type: 'demo' },
    { id: TEST_REAL_ID, type: 'real' },
];
const accounts = () => modes.map(x => ({
    account_id: x.id, account_type: x.type, currency: 'USD',
    status: 'active', balance: '100.00',
}));
const makeTick = (digit: number, suffix: number) => ({
    id: `R_100:${Math.floor(Date.now() / 1000)}:${suffix}`,
    digit,
    quote: `123.4${digit}`,
    epoch: Math.floor(Date.now() / 1000),
});
const prediction = (digit: number) => ({
    symbol: 'R_100',
    status: 'ready' as const,
    entryDigit: digit,
    nextDigit: 7,
    sampleSize: 1000,
    transitionCount: 100,
    candidates: [{ digit: 7, count: 21, observedShare: 21 }],
    reason: 'Observed transition frequency, not a win probability.',
});
const init = (id: string) => {
    window.localStorage.setItem('active_loginid', id);
    (api_base as any).api = {
        isAdminSimulation: true,
        simulatedAccountId: id,
        connection: { readyState: 1 },
    };
    api_base.account_id = id;
    api_base.account_info = { loginid: id, currency: 'USD' };
    api_base.is_authorized = true;
    api_base.is_running = false;
    jest.mocked(isAdminTestActive).mockReturnValue(true);
    jest.mocked(isAdminTestRequested).mockReturnValue(true);
    jest.mocked(isAdminTestSessionReady).mockReturnValue(true);
    jest.mocked(getAdminTestAccounts).mockReturnValue(accounts() as any);
    jest.mocked(getAdminTestBalances).mockReturnValue({
        [TEST_DEMO_ID]: 100, [TEST_REAL_ID]: 100,
    } as any);
};

describe('Auto Trader Admin Test Kit visible Run integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        (preflightNextDigitAccount as jest.Mock).mockResolvedValue(100);
        (placeNextDigitMatch as jest.Mock).mockImplementation(async ({ onProposal, onBought, accountId }) => {
            onProposal({ price: 0.5, proposalId: 'adm-proposal-1' });
            onBought({ contractId: '9000001', price: 0.5, accountId,
                symbol: 'R_100', digit: 7 });
            return { contractId: '9000001', price: 0.5, profit: 3.7,
                status: 'won', symbol: 'R_100', digit: 7, accountId,
                entrySpot: 123.42, exitSpot: 123.47 };
        });
    });

    it.each(modes)('Run on simulated $type opens Summary Journal and uses ONLY the mock transport', async ({ id, type }) => {
        init(id);
        const first = makeTick(4, 1);
        const { rerender, unmount } = render(
            <NextDigitTrader symbol='R_100' marketName='Volatility 100 Index'
                prediction={prediction(4)} latestTick={first} tickStatus='streaming' />
        );
        try {
            expect(screen.getByText(new RegExp(`SIMULATED ${type.toUpperCase()}`))).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Run Auto Trader' }));
            const panel = screen.getByRole('complementary', { name: 'Next Digit Auto Trader Reports' });
            expect(panel).toBeVisible();
            expect(within(panel).getByRole('button', { name: 'Summary' })).toBeVisible();
            expect(within(panel).getByRole('button', { name: 'Journal' })).toBeVisible();
            await waitFor(() => expect(screen.getByText(new RegExp(`RUNNING on SIMULATED ${type.toUpperCase()}`))).toBeInTheDocument());
            expect(preflightNextDigitAccount).toHaveBeenCalledWith(expect.objectContaining({
                api: api_base.api, symbol: 'R_100', accountId: id, currency: 'USD',
            }));
            expect(OAuthTokenExchangeService.getAccessToken).not.toHaveBeenCalled();
            expect(DerivWSAccountsService.fetchAccountsList).not.toHaveBeenCalled();
            rerender(
                <NextDigitTrader symbol='R_100' marketName='Volatility 100 Index'
                    prediction={prediction(5)} latestTick={makeTick(5, 2)} tickStatus='streaming' />
            );
            await waitFor(() => expect(placeNextDigitMatch).toHaveBeenCalledWith(
                expect.objectContaining({ api: api_base.api, accountId: id, digit: 7, symbol: 'R_100' })
            ));
            fireEvent.click(within(panel).getByRole('button', { name: 'Journal' }));
            await waitFor(() => expect(within(panel).getByText(/SIMULATED SETTLEMENT/)).toBeInTheDocument());
            expect(within(panel).getByText(/No live broker purchases/)).toBeInTheDocument();
        } finally {
            unmount();
        }
    });

    it('blocks a genuine Deriv socket while Admin Test Kit is requested', () => {
        init(TEST_DEMO_ID);
        (api_base.api as any).isAdminSimulation = false;
        render(<NextDigitTrader symbol='R_100' marketName='Volatility 100 Index'
            prediction={prediction(4)} latestTick={makeTick(4, 1)} tickStatus='streaming' />);
        fireEvent.click(screen.getByRole('button', { name: 'Run Auto Trader' }));
        expect(preflightNextDigitAccount).not.toHaveBeenCalled();
        expect(placeNextDigitMatch).not.toHaveBeenCalled();
        expect(screen.getByText(/Admin Test Kit simulated account/)).toBeInTheDocument();
    });
});

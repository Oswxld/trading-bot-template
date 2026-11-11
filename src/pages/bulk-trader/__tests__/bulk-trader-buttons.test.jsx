import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

jest.mock('@/external/bot-skeleton', () => ({
    api_base: {
        api: null, account_id: '', account_info: {},
        is_authorized: false, is_running: false, active_symbols: [],
    },
}));
jest.mock('@/hooks/useStore', () => ({ useStore: jest.fn() }));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: {
        getStoredAccounts: jest.fn(),
        fetchAccountsList: jest.fn(),
    },
}));
jest.mock('@/services/oauth-token-exchange.service', () => ({
    OAuthTokenExchangeService: { getAccessToken: jest.fn() },
}));
jest.mock('@/services/trading-request-budget', () => ({
    tradingBudgetSnapshot: jest.fn(() => ({
        minuteUsed: 0, minuteLimit: 240, hourUsed: 0, hourLimit: 12000,
    })),
}));
jest.mock('../bulk-api-request', () => ({ requestBulkApi: jest.fn() }));
jest.mock('../bulk-reports', () => ({
    __esModule: true, default: () => null,
}));

import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { requestBulkApi } from '../bulk-api-request';
import BulkTrader from '../bulk-trader';

const makeApi = () => ({
    connection: { readyState: 1 },
    send: jest.fn(),
    onMessage: () => ({ subscribe: () => ({ unsubscribe: jest.fn() }) }),
});
const init = ({ id, cachedAccount = null, clientVirtual = 1, isAuthorized = true } = {}) => {
    localStorage.setItem('active_loginid', id);
    api_base.api = makeApi();
    api_base.account_id = id;
    api_base.account_info = { loginid: id, currency: 'USD' };
    api_base.is_authorized = isAuthorized;
    api_base.is_running = false;
    api_base.active_symbols = [];
    DerivWSAccountsService.getStoredAccounts.mockReturnValue(cachedAccount ? [cachedAccount] : []);
    OAuthTokenExchangeService.getAccessToken.mockReturnValue(null);
    useStore.mockReturnValue({
        client: {
            loginid: id, currency: 'USD', balance: '100',
            accounts: { [id]: { loginid: id, currency: 'USD', is_virtual: clientVirtual } },
            is_logged_in: true,
        },
    });
    requestBulkApi.mockImplementation(({ payload }) => {
        if (payload.contracts_for) return Promise.resolve({
            contracts_for: { available: [
                { contract_type: 'DIGITDIFF' }, { contract_type: 'DIGITMATCH' },
            ] },
        });
        if (payload.active_symbols) return Promise.resolve({ active_symbols: [] });
        if (payload.balance) return Promise.resolve({
            balance: { loginid: id, currency: 'USD', balance: 100 },
        });
        if (payload.proposal) return Promise.resolve({
            proposal: { id: 'p123', ask_price: 0.5 },
        });
        if (payload.buy) return Promise.resolve({
            buy: { contract_id: 873352, buy_price: 0.5 },
        });
        if (payload.proposal_open_contract) return Promise.resolve({});
        return Promise.resolve({});
    });
};
describe('Bulk Trader Matches / Differs button interactions (mock broker only)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        window.confirm = jest.fn(() => false);
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it('restores demo button access without a cached OAuth list and submits a mocked Differs purchase', async () => {
        init({ id: 'VRTC7001' });
        window.confirm.mockReturnValue(true);
        render(<BulkTrader />);
        const button = screen.getByRole('button', { name: 'Differs' });
        expect(button).toBeEnabled();
        fireEvent.click(button);
        await waitFor(() => expect(requestBulkApi).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    proposal: 1, contract_type: 'DIGITDIFF', barrier: '5',
                }),
            })
        ));
        await waitFor(() => expect(requestBulkApi).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { buy: 'p123', price: 0.5 } })
        ));
        expect(window.confirm).toHaveBeenCalledTimes(1);
    });

    it('restores Matches access for a cached demo account', async () => {
        init({
            id: 'VRTC7001',
            cachedAccount: { account_id: 'VRTC7001', currency: 'USD', account_type: 'demo' },
        });
        render(<BulkTrader />);
        const button = screen.getByRole('button', { name: 'Matches' });
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(requestBulkApi).not.toHaveBeenCalledWith(
            expect.objectContaining({ payload: expect.objectContaining({ buy: expect.anything() }) })
        );
    });

    it('verifies a real-account balance and asks for consent before any real purchase', async () => {
        init({
            id: 'CR7001', clientVirtual: 0,
            cachedAccount: { account_id: 'CR7001', currency: 'USD', account_type: 'real' },
        });
        render(<BulkTrader />);
        expect(screen.getByRole('button', { name: 'Matches' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Matches' }));
        await waitFor(() => expect(requestBulkApi).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { balance: 1 } })
        ));
        await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('button', { name: 'Matches' })).toBeEnabled();
        expect(requestBulkApi).not.toHaveBeenCalledWith(
            expect.objectContaining({ payload: expect.objectContaining({ buy: expect.anything() }) })
        );
    });

    it('explains a missing authenticated account without silently placing an order', async () => {
        init({ id: 'VRTC7001', isAuthorized: false });
        render(<BulkTrader />);
        const button = screen.getByRole('button', { name: 'Differs' });
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(await screen.findByText(/Select a verified authenticated Deriv account/)).toBeInTheDocument();
        expect(window.confirm).not.toHaveBeenCalled();
    });
});

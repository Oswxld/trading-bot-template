import React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

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

const makeApi = () => {
    const listeners = new Set();
    return {
        connection: { readyState: 1 },
        send: jest.fn(),
        emit: data => listeners.forEach(listener => listener({ data })),
        onMessage: () => ({
            subscribe: listener => {
                listeners.add(listener);
                return { unsubscribe: jest.fn(() => listeners.delete(listener)) };
            },
        }),
    };
};
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
                { contract_type: 'DIGITUNDER' }, { contract_type: 'DIGITOVER' },
                { contract_type: 'DIGITEVEN' }, { contract_type: 'DIGITODD' },
                { contract_type: 'PUT' }, { contract_type: 'CALL' },
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
        sessionStorage.clear();
        window.confirm = jest.fn(() => false);
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        sessionStorage.clear();
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

    it('relabels the SAME live tick history immediately when the trade type or prediction changes', async () => {
        init({ id: 'VRTC7001' });
        render(<BulkTrader />);

        await waitFor(() => expect(api_base.api.send.mock.calls.some(
            ([payload]) => Boolean(payload.ticks_history)
        )).toBe(true));
        const request = api_base.api.send.mock.calls.find(([payload]) => payload.ticks_history)[0];
        act(() => api_base.api.emit({
            msg_type: 'history',
            req_id: request.req_id,
            pip_size: 2,
            history: { prices: [100.01, 100.02, 100.05, 100.07, 100.08, 100.09] },
        }));
        const badges = () => [...document.querySelectorAll('.bulk-trader__recent span')];
        const letters = () => badges().map(node => node.textContent).join('');

        expect(letters()).toBe('DDMDDD');
        expect(screen.getByLabelText('Recent tick results for Matches/Differs')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('TRADE TYPE'), { target: { value: 'OVER_UNDER' } });
        expect(letters()).toBe('UU=OOO');
        expect(screen.getByLabelText('Recent tick results for Over/Under')).toBeInTheDocument();
        expect(badges()[0]).toHaveClass('bulk-trader__recent-primary');
        expect(badges()[2]).toHaveClass('bulk-trader__recent-neutral');
        expect(badges()[3]).toHaveClass('bulk-trader__recent-secondary');

        fireEvent.change(screen.getByLabelText('PREDICTION'), { target: { value: '7' } });
        expect(letters()).toBe('UUU=OO');

        fireEvent.change(screen.getByLabelText('TRADE TYPE'), { target: { value: 'EVEN_ODD' } });
        expect(letters()).toBe('OEOOEO');
        expect(screen.getByLabelText('Recent tick results for Even/Odd')).toBeInTheDocument();
        expect(badges()[1]).toHaveClass('bulk-trader__recent-primary');
        expect(badges()[0]).toHaveClass('bulk-trader__recent-secondary');

        fireEvent.change(screen.getByLabelText('TRADE TYPE'), { target: { value: 'MATCH_DIFF' } });
        expect(letters()).toBe('DDDMDD');
    });

    it.each([
        ['Differs', 'MATCH_DIFF'],
        ['Over', 'OVER_UNDER'],
        ['Even', 'EVEN_ODD'],
        ['Rise', 'RISE_FALL'],
    ])('automatically reveals reports after starting %s on mobile', async (button, type) => {
        const previousWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
        try {
            init({ id: 'VRTC7001' });
            window.confirm.mockReturnValue(true);
            render(<BulkTrader />);
            const reportsToggle = screen.getByRole('button', { name: /View Summary \/ Transactions \/ Journal/ });
            expect(reportsToggle).toHaveAttribute('aria-expanded', 'false');
            expect(document.querySelector('.bulk-trader')).not.toHaveClass('bulk-trader--reports-open');

            fireEvent.change(screen.getByLabelText('TRADE TYPE'), { target: { value: type } });
            const tradeButton = screen.getByRole('button', { name: button });
            await waitFor(() => expect(tradeButton).toBeEnabled());
            fireEvent.click(tradeButton);
            await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(reportsToggle).toHaveAttribute('aria-expanded', 'true'));
            expect(document.querySelector('.bulk-trader')).toHaveClass('bulk-trader--reports-open');
            // A report is now visible without clicking its toggle.
            expect(screen.getByRole('button', { name: /Hide reports/ })).toBeInTheDocument();
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
        }
    });

    it('does not open reports for a cancelled trade confirmation', async () => {
        const previousWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
        try {
            init({ id: 'VRTC7001' });
            render(<BulkTrader />);
            fireEvent.click(screen.getByRole('button', { name: 'Matches' }));
            await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
            expect(screen.getByRole('button', { name: /View Summary \/ Transactions \/ Journal/ }))
                .toHaveAttribute('aria-expanded', 'false');
            expect(document.querySelector('.bulk-trader')).not.toHaveClass('bulk-trader--reports-open');
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
        }
    });

    it('allows another demo batch immediately after a rejected proposal', async () => {
        init({ id: 'VRTC7001' });
        window.confirm.mockReturnValue(true);
        const normalRequest = requestBulkApi.getMockImplementation();
        let attempts = 0;
        requestBulkApi.mockImplementation(options => {
            if (options.payload.proposal && attempts++ === 0) {
                return Promise.reject(Object.assign(new Error('Deriv rejected the first proposal'), {
                    bulkRequest: { kind: 'api_rejected', requestType: 'proposal', dispatched: true },
                }));
            }
            return normalRequest(options);
        });

        render(<BulkTrader />);
        const button = screen.getByRole('button', { name: 'Matches' });
        fireEvent.click(button);
        await waitFor(() => expect(screen.getByText(/Completed\\. 1\\/1 operations/)).toBeInTheDocument());
        expect(button).toBeEnabled();

        fireEvent.click(button);
        await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(requestBulkApi.mock.calls.some(([{ payload }]) => payload.buy)).toBe(true));
    });

    it('continues a demo batch through two ordinary broker rejections', async () => {
        init({ id: 'VRTC7001' });
        window.confirm.mockReturnValue(true);
        const normalRequest = requestBulkApi.getMockImplementation();
        let proposals = 0;
        requestBulkApi.mockImplementation(options => {
            if (options.payload.proposal && proposals++ < 2) {
                return Promise.reject(Object.assign(new Error('Quote rejected'), {
                    bulkRequest: { kind: 'api_rejected', requestType: 'proposal', dispatched: true },
                }));
            }
            return normalRequest(options);
        });
        render(<BulkTrader />);
        fireEvent.change(screen.getByLabelText('NO OF TRADES'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Differs' }));

        await waitFor(() => expect(requestBulkApi.mock.calls.filter(([{ payload }]) => payload.proposal)).toHaveLength(3), { timeout: 4000 });
        await waitFor(() => expect(requestBulkApi.mock.calls.filter(([{ payload }]) => payload.buy)).toHaveLength(1), { timeout: 4000 });
        await waitFor(() => expect(screen.getByText(/Completed\\. 3\\/3 operations/)).toBeInTheDocument(), { timeout: 4000 });
    });

    it('explains a second tap while a batch is still processing, without duplicating buys', async () => {
        init({ id: 'VRTC7001' });
        window.confirm.mockReturnValue(true);
        const normalRequest = requestBulkApi.getMockImplementation();
        let confirmBuy;
        requestBulkApi.mockImplementation(options => {
            if (options.payload.buy) {
                return new Promise(resolve => { confirmBuy = resolve; });
            }
            return normalRequest(options);
        });
        render(<BulkTrader />);
        const button = screen.getByRole('button', { name: 'Matches' });
        fireEvent.click(button);
        await waitFor(() => expect(typeof confirmBuy).toBe('function'));
        fireEvent.click(button);
        expect(screen.getByText(/previous batch is still processing/i)).toBeInTheDocument();
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(requestBulkApi.mock.calls.filter(([{ payload }]) => payload.buy)).toHaveLength(1);
        await act(async () => confirmBuy({ buy: { contract_id: 45678, buy_price: 0.5 } }));
        await waitFor(() => expect(screen.getByText(/Completed\\. 1\\/1 operations/)).toBeInTheDocument());
    });

    it('permits a NEW demo batch despite an unconfirmed historical row, without replaying the old buy', async () => {
        init({ id: 'VRTC7001' });
        window.confirm.mockReturnValue(true);
        sessionStorage.setItem('bulk-trader:records:VRTC7001', JSON.stringify([
            { localId: 'old-batch:0', status: 'unconfirmed', reason: 'Previous buy acknowledgement missing' },
        ]));
        render(<BulkTrader />);
        fireEvent.click(screen.getByRole('button', { name: 'Matches' }));
        await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(requestBulkApi.mock.calls.filter(([{ payload }]) => payload.buy)).toHaveLength(1));
    });

    it('still blocks a new real-money batch while a previous purchase is unconfirmed', async () => {
        init({
            id: 'CR7001', clientVirtual: 0,
            cachedAccount: { account_id: 'CR7001', currency: 'USD', account_type: 'real' },
        });
        sessionStorage.setItem('bulk-trader:records:CR7001', JSON.stringify([
            { localId: 'old-batch:0', status: 'unconfirmed', reason: 'Previous buy acknowledgement missing' },
        ]));
        render(<BulkTrader />);
        fireEvent.click(screen.getByRole('button', { name: 'Matches' }));
        expect(screen.getByText(/earlier purchase has no confirmation/i)).toBeInTheDocument();
        expect(window.confirm).not.toHaveBeenCalled();
        expect(requestBulkApi.mock.calls.some(([{ payload }]) => payload.buy)).toBe(false);
    });

});

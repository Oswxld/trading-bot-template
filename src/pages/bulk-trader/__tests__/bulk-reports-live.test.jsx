import React from 'react';
import { render, screen, within } from '@testing-library/react';

jest.mock('@/components/draggable/draggable-resize-wrapper', () => ({
    __esModule: true,
    default: ({ children }) => <section>{children}</section>,
}));
jest.mock('@/components/run-panel/run-panel', () => ({
    StatisticsSummary: () => null,
}));
jest.mock('@/components/market/market-icon', () => ({
    MarketIcon: ({ type }) => <span data-testid='market-icon'>{type}</span>,
}));
jest.mock('@/components/trade-type/trade-type-icon', () => ({
    TradeTypeIcon: ({ type }) => <span data-testid='trade-icon'>{type}</span>,
}));
jest.mock('@deriv/quill-icons', () => ({
    LegacyRadioOnIcon: () => <span data-testid='entry-radio'>●</span>,
    LegacyRadioOffIcon: () => <span data-testid='exit-radio'>○</span>,
}));
jest.mock('@/components/transactions/transaction-loaders', () => ({
    TransactionFieldLoader: () => <svg data-testid='deriv-transaction-shimmer' />,
}));

import { TradesTable } from '../bulk-reports';

const record = overrides => ({
    localId: 'batch:0',
    number: 1,
    timestamp: new Date('2026-11-11T01:42:28.000Z').getTime(),
    contractId: '38613361799',
    symbol: 'R_100',
    symbolName: 'Volatility 100 Index',
    contractType: 'Matches',
    entrySpot: '510.91',
    exitSpot: null,
    price: 0.5,
    profit: null,
    status: 'open',
    ...overrides,
});

describe('Bulk Trader native Deriv-style transactions display', () => {
    it('shows the known entry and buy price but animates pending exit and P/L in detailed summary', () => {
        render(<TradesTable records={[record()]} currency='USD' detailed />);
        const table = screen.getByRole('table');
        expect(within(table).getByText('2026-11-11 01:42:28 GMT')).toBeInTheDocument();
        expect(within(table).getByText('38613361799')).toBeInTheDocument();
        expect(within(table).getByText('510.91')).toBeInTheDocument();
        expect(within(table).getByText('0.50')).toBeInTheDocument();
        expect(within(table).getAllByTestId('deriv-transaction-shimmer')).toHaveLength(2);
    });

    it('uses the same two-line Deriv transaction format in compact view', () => {
        render(<TradesTable records={[record()]} currency='USD' />);
        const table = screen.getByRole('table');
        expect(within(table).getByText('Entry/Exit spot')).toBeInTheDocument();
        expect(within(table).getByText('Buy price and P/L')).toBeInTheDocument();
        expect(within(table).getByText('510.91')).toBeInTheDocument();
        expect(within(table).getByText('0.50 USD')).toBeInTheDocument();
        expect(within(table).getByTestId('entry-radio')).toBeInTheDocument();
        expect(within(table).getByTestId('exit-radio')).toBeInTheDocument();
        expect(within(table).getAllByTestId('deriv-transaction-shimmer')).toHaveLength(2);
    });

    it('animates all unknown fields during proposal and buying, with no fake contract reference', () => {
        for (const phase of ['quoting', 'buying']) {
            const { unmount } = render(
                <TradesTable records={[record({
                    status: phase, contractId: null, entrySpot: null, price: null,
                })]} currency='USD' detailed />
            );
            expect(screen.getAllByTestId('deriv-transaction-shimmer')).toHaveLength(5);
            expect(screen.queryByText('38613361799')).not.toBeInTheDocument();
            unmount();
        }
    });

    it('replaces animations with verified entry, exit and red P/L after a Deriv loss', () => {
        render(<TradesTable records={[record({
            status: 'lost', profit: -0.5, exitSpot: '510.91',
        })]} currency='USD' detailed />);
        const table = screen.getByRole('table');
        expect(within(table).getAllByText('510.91')).toHaveLength(2);
        expect(within(table).getByText('-0.50')).toHaveClass('bulk-reports__loss');
        expect(within(table).queryByTestId('deriv-transaction-shimmer')).not.toBeInTheDocument();
    });

    it('never makes a rejected or unconfirmed purchase look settled', () => {
        render(<TradesTable records={[record({
            status: 'unconfirmed', contractId: null, price: null,
            entrySpot: null, reason: 'No buy acknowledgement',
        })]} currency='USD' detailed />);
        expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
        expect(screen.queryByTestId('deriv-transaction-shimmer')).not.toBeInTheDocument();
    });
});

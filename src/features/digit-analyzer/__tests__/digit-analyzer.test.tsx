import { fireEvent, render, screen } from '@testing-library/react';
// Exercise the same public entry point used by main.tsx's lazy import.
import DigitAnalyzer from '..';

describe('Digit Analyzer feature shell', () => {
    it('shows an honest disconnected state before market data integration', () => {
        render(<DigitAnalyzer />);

        expect(screen.getByRole('heading', { name: 'Digit Analyzer' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Not connected');
        expect(screen.getByRole('note')).toHaveTextContent('Live market data is not connected yet');
    });

    it('mounts and unmounts without leaving analyzer content behind', () => {
        const { unmount } = render(<DigitAnalyzer />);

        expect(screen.getByRole('heading', { name: 'Digit Analyzer' })).toBeInTheDocument();
        unmount();
        expect(screen.queryByRole('heading', { name: 'Digit Analyzer' })).not.toBeInTheDocument();

        // Tab content is mounted again when the user returns to Analysis.
        render(<DigitAnalyzer />);
        expect(screen.getByRole('status')).toHaveTextContent('Not connected');
    });

    it('shows disabled network controls until the public data feed is available', () => {
        render(<DigitAnalyzer />);

        expect(screen.getByRole('combobox', { name: 'Market' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
        expect(screen.getByText('No ticks received yet')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Latest tick' })).toBeInTheDocument();
    });

    it('lets users configure analysis options without inventing data', () => {
        render(<DigitAnalyzer />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Sample size' }), { target: { value: '500' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Over/Under threshold' }), {
            target: { value: '7' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Matches/Differs digit' }), {
            target: { value: '2' },
        });

        expect(screen.getByRole('combobox', { name: 'Sample size' })).toHaveValue('500');
        expect(screen.getByRole('combobox', { name: 'Over/Under threshold' })).toHaveValue('7');
        expect(screen.getByRole('combobox', { name: 'Matches/Differs digit' })).toHaveValue('2');
        expect(screen.getByText('Over 7')).toBeInTheDocument();
        expect(screen.getByText('Matches 2')).toBeInTheDocument();
        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
    });

    it('renders the planned analysis areas without fabricating tick results', () => {
        render(<DigitAnalyzer />);

        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
        expect(screen.getByRole('region', { name: 'Digit distribution' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent ticks' })).toBeInTheDocument();
    });
});

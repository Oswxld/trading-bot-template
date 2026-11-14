import { render, screen } from '@testing-library/react';
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

    it('renders the planned analysis areas without fabricating tick results', () => {
        render(<DigitAnalyzer />);

        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
        expect(screen.getByRole('region', { name: 'Digit distribution' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent ticks' })).toBeInTheDocument();
    });
});

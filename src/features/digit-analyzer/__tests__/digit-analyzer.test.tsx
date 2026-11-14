import { render, screen } from '@testing-library/react';
import DigitAnalyzer from '../components/digit-analyzer';

describe('Digit Analyzer feature shell', () => {
    it('shows an honest disconnected state before market data integration', () => {
        render(<DigitAnalyzer />);

        expect(screen.getByRole('heading', { name: 'Digit Analyzer' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Not connected');
        expect(screen.getByRole('note')).toHaveTextContent('Live market data is not connected yet');
    });

    it('renders the planned analysis areas without fabricating tick results', () => {
        render(<DigitAnalyzer />);

        expect(screen.getAllByText('Awaiting market data')).toHaveLength(5);
        expect(screen.getByRole('region', { name: 'Digit distribution' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Recent ticks' })).toBeInTheDocument();
    });
});

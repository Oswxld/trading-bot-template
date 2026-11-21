import ConnectionStatus from './connection-status';
import type { DigitAnalyzerConnectionState } from '../types/digit-analyzer.types';

type AnalyzerHeaderProps = {
    connectionState: DigitAnalyzerConnectionState;
};

const AnalyzerHeader = ({ connectionState }: AnalyzerHeaderProps) => (
    <header className='digit-analyzer__header'>
        <div className='digit-analyzer__heading'>
            <p className='digit-analyzer__eyebrow'>MARKET ANALYSIS</p>
            <h2 id='digit-analyzer-title' className='digit-analyzer__title'>
                Digit Analyzer
            </h2>
            <p className='digit-analyzer__subtitle'>
                Explore last-digit frequencies and patterns using Deriv market data.
            </p>
        </div>
        <ConnectionStatus state={connectionState} />
    </header>
);

export default AnalyzerHeader;

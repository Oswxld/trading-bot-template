import type { DigitAnalyzerConnectionState } from '../types/digit-analyzer.types';

type ConnectionStatusProps = {
    state: DigitAnalyzerConnectionState;
};

const STATUS_LABELS: Record<DigitAnalyzerConnectionState, string> = {
    idle: 'Not connected',
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    paused: 'Paused',
    error: 'Connection error',
};

/** Display only: this component never opens or manages a WebSocket. */
const ConnectionStatus = ({ state }: ConnectionStatusProps) => (
    <span className={`digit-analyzer__connection digit-analyzer__connection--${state}`} role='status' aria-live='polite'>
        <span className='digit-analyzer__connection-dot' aria-hidden='true' />
        {STATUS_LABELS[state]}
    </span>
);

export default ConnectionStatus;

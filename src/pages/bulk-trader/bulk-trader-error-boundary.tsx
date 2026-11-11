import React from 'react';

type BulkTraderErrorBoundaryState = {
    hasError: boolean;
    message: string;
};

/**
 * Keep a Bulk Trader render error from appearing as an empty white screen.
 * The existing Bot Builder remains usable if this isolated trading tab fails.
 */
export default class BulkTraderErrorBoundary extends React.Component<
    React.PropsWithChildren<object>,
    BulkTraderErrorBoundaryState
> {
    state: BulkTraderErrorBoundaryState = {
        hasError: false,
        message: '',
    };

    static getDerivedStateFromError(error: Error): BulkTraderErrorBoundaryState {
        return {
            hasError: true,
            message: error?.message || 'Unexpected component error',
        };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        // Don't include auth tokens, API credentials, or trading payloads here.
        console.error('[BulkTrader] UI render failed', error.name, info.componentStack);
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return (
            <section role='alert' style={{ background: '#fff', color: '#212121', margin: 16, padding: 24, border: '1px solid #ddd', borderRadius: 8 }}>
                <h2 style={{ fontSize: 20, marginBottom: 8 }}>Bulk Trader couldn't display</h2>
                <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                    The Bulk Trader encountered a display error. Check your Deriv account statement before
                    attempting another order. Refresh this tab, then check the browser Console if it continues.
                </p>
                <p style={{ fontSize: 12, color: '#b42318', overflowWrap: 'anywhere' }}>
                    Display error. Please share the first red error from the browser Console (without any tokens or credentials).
                </p>
                <button type='button' onClick={() => window.location.reload()}
                    style={{ marginTop: 12, padding: '10px 18px', background: '#1746dc', color: '#fff', borderRadius: 6, border: 0, cursor: 'pointer' }}>
                    Reload Bulk Trader
                </button>
            </section>
        );
    }
}

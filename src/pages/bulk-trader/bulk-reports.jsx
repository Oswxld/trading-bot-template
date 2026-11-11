import { useState } from 'react';
import DraggableResizeWrapper from '@/components/draggable/draggable-resize-wrapper';
import { StatisticsSummary } from '@/components/run-panel/run-panel';
import { MarketIcon } from '@/components/market/market-icon';
import { TradeTypeIcon } from '@/components/trade-type/trade-type-icon';
import { TransactionFieldLoader } from '@/components/transactions/transaction-loaders';
import { LegacyRadioOffIcon, LegacyRadioOnIcon } from '@deriv/quill-icons';
import { realizedPayoutForRecord } from './bulk-contract-monitor';
import { isBulkRowAwaitingData } from './bulk-trade-records';
import './bulk-reports.scss';

// A bulk purchase is not a Deriv Bot run. Render the existing Deriv Drawer,
// Tabs and six-stat summary components, but keep reports sourced ONLY from the
// contracts submitted by this bulk trader, not the Bot Builder's transactions.
const amount = (number, currency) => `${Number(number || 0).toFixed(2)} ${currency}`;
const safeCsv = value => {
    const str = String(value ?? '');
    return '"' + (/^[=+@\-]/.test(str) ? "'" : '') + str.replace(/"/g, '""') + '"';
};

// Use the exact same Deriv SVG icon components as Bot Builder's
// Transactions detailed summary. Bulk records currently save the action label
// (e.g. "Differs") instead of Deriv's API contract_type code.
const BULK_TRADE_TYPE_CODES = {
    Differs: 'DIGITDIFF',
    Matches: 'DIGITMATCH',
    Over: 'DIGITOVER',
    Under: 'DIGITUNDER',
    Even: 'DIGITEVEN',
    Odd: 'DIGITODD',
    Rise: 'CALL',
    Fall: 'PUT',
};
const resolveTradeTypeCode = value => {
    const label = String(value || '');
    return BULK_TRADE_TYPE_CODES[label] || Object.values(BULK_TRADE_TYPE_CODES)
        .find(code => code === label.toUpperCase()) || null;
};

const MarketCell = ({ item }) => {
    const symbol = item.symbol;
    const name = item.symbolName || symbol || 'Unknown market';
    return symbol ? (
        <span className='bulk-reports__contract-icon' title={name} aria-label={name}>
            <MarketIcon type={symbol} size='sm' />
        </span>
    ) : <span>{name}</span>;
};

const TradeTypeCell = ({ item }) => {
    const contractCode = resolveTradeTypeCode(item.contractType);
    const name = item.contractType || 'Unknown trade type';
    return contractCode ? (
        <span className='bulk-reports__contract-icon' title={name} aria-label={name}>
            <TradeTypeIcon type={contractCode} size='sm' />
        </span>
    ) : <span>{name}</span>;
};

// Deriv Bot uses the same SVG shimmer for missing entry/exit ticks and an
// unresolved profit. Only animate data that Deriv has NOT actually reported.
// An explicit failure/unconfirmed buy shows a status, never fabricated values.
const hasValue = value => value !== null && value !== undefined && value !== '';
const confirmedPrice = item => hasValue(item.price) &&
    Number.isFinite(Number(item.price)) && Number(item.price) > 0;
const isSettled = item => ['won', 'lost'].includes(item.status);

const formatGMT = timestamp => {
    if (!timestamp) return '—';
    const parsed = new Date(timestamp);
    return Number.isFinite(parsed.getTime())
        ? `${parsed.toISOString().slice(0, 19).replace('T', ' ')} GMT`
        : '—';
};

const Field = ({ value, loading, label, className = '' }) => (
    hasValue(value)
        ? <span className={className}>{value}</span>
        : loading
            ? <span className='bulk-reports__pending' aria-label={label || 'Waiting for Deriv'}>
                <TransactionFieldLoader />
            </span>
            : <span className='bulk-reports__missing'>—</span>
);

const ProfitField = ({ item, currency, detailed = false }) => {
    if (isSettled(item)) {
        const result = Number(item.profit);
        if (!Number.isFinite(result)) return '—';
        return (
            <span className={item.status === 'won' ? 'bulk-reports__profit' : 'bulk-reports__loss'}>
                {result > 0 ? '+' : ''}{result.toFixed(2)}{detailed ? '' : ` ${currency}`}
            </span>
        );
    }
    if (isBulkRowAwaitingData(item)) {
        return <Field loading label='Waiting for Deriv to settle the contract' />;
    }
    return <span className='bulk-reports__outcome' title={item.reason || item.status}>
        {item.status === 'unconfirmed' ? 'Unconfirmed'
            : item.status === 'failed' ? 'Failed'
            : item.status === 'skipped' ? 'Skipped'
            : '—'}
    </span>;
};

const PriceField = ({ item, currency, detailed = false }) => confirmedPrice(item)
    ? <span>{Number(item.price).toFixed(2)}{detailed ? '' : ` ${currency}`}</span>
    : <Field loading={isBulkRowAwaitingData(item)}
        label='Waiting for Deriv buy price confirmation' />;

const IconPair = ({ item }) => (
    <div className='bulk-reports__icon-pair'>
        <MarketCell item={item} />
        <TradeTypeCell item={item} />
    </div>
);

const SpotLine = ({ value, entry, loading }) => (
    <div className='bulk-reports__spot-line'>
        <span className='bulk-reports__spot-icon'
            title={entry ? 'Entry spot' : 'Exit spot'}
            aria-label={entry ? 'Entry spot' : 'Exit spot'}>
            {entry ? <LegacyRadioOnIcon width={10} height={10} />
                : <LegacyRadioOffIcon width={10} height={10} />}
        </span>
        <Field value={value} loading={loading}
            label={entry ? 'Waiting for entry spot' : 'Waiting for exit spot'} />
    </div>
);

const TradesTable = ({ records, currency, detailed = false }) => (
    <div className='bulk-reports__table-scroll'>
        <table className={`bulk-reports__table${detailed
            ? ' bulk-reports__table--detailed'
            : ' bulk-reports__table--compact'}`}>
            <thead>
                {detailed ? (
                    <tr>
                        <th scope='col'>Timestamp</th>
                        <th scope='col'>Reference</th>
                        <th scope='col'>Market</th>
                        <th scope='col'>Trade type</th>
                        <th scope='col'>Entry spot</th>
                        <th scope='col'>Exit spot</th>
                        <th scope='col'>Buy price</th>
                        <th scope='col'>Profit/Loss</th>
                    </tr>
                ) : (
                    <tr>
                        <th scope='col'>Type</th>
                        <th scope='col'>Entry/Exit spot</th>
                        <th scope='col'>Buy price and P/L</th>
                    </tr>
                )}
            </thead>
            <tbody>
                {records.length === 0 ? (
                    <tr><td colSpan={detailed ? 8 : 3} className='bulk-reports__empty'>
                        No bulk trade transactions yet.
                    </td></tr>
                ) : records.map(item => (
                    <tr key={item.localId || item.contractId || item.number}
                        className={isBulkRowAwaitingData(item) ? 'bulk-reports__row--active' : ''}
                        title={item.reason || (item.contractId ? `Contract ${item.contractId}` : item.status)}>
                        {detailed ? (
                            <>
                                <td className='bulk-reports__date'>{formatGMT(item.timestamp)}</td>
                                <td className='bulk-reports__reference'>
                                    <Field value={item.contractId}
                                        loading={item.status === 'quoting' || item.status === 'buying'}
                                        label='Waiting for contract reference' />
                                </td>
                                <td><MarketCell item={item} /></td>
                                <td><TradeTypeCell item={item} /></td>
                                <td><Field value={item.entrySpot}
                                    loading={isBulkRowAwaitingData(item)} label='Waiting for entry spot' /></td>
                                <td><Field value={item.exitSpot}
                                    loading={isBulkRowAwaitingData(item)} label='Waiting for exit spot' /></td>
                                <td><PriceField item={item} currency={currency} detailed /></td>
                                <td><ProfitField item={item} currency={currency} detailed /></td>
                            </>
                        ) : (
                            <>
                                <td><IconPair item={item} /></td>
                                <td className='bulk-reports__spot-lines'>
                                    <SpotLine entry value={item.entrySpot}
                                        loading={isBulkRowAwaitingData(item)} />
                                    <SpotLine value={item.exitSpot}
                                        loading={isBulkRowAwaitingData(item)} />
                                </td>
                                <td className='bulk-reports__price-lines'>
                                    <div><PriceField item={item} currency={currency} /></div>
                                    <div><ProfitField item={item} currency={currency} /></div>
                                </td>
                            </>
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const exportCsv = (records, currency) => {
    const columns = ['Timestamp', 'Reference', 'Market', 'Trade type', 'Entry spot', 'Exit spot', 'Buy price', 'Profit/Loss', 'Status', 'Error'];
    const rows = records.map(item => [
        item.timestamp ? new Date(item.timestamp).toISOString() : '',
        item.contractId, item.symbolName || item.symbol, item.contractType,
        item.entrySpot ?? '', item.exitSpot ?? '', item.price ?? '',
        item.profit ?? '', item.status, item.reason || '',
    ]);
    const contents = [columns, ...rows].map(row => row.map(safeCsv).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + contents], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bulk-trader-${currency}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

function BulkReports({ records, journal, accountId, currency, balance, isRunning, onReset, reportsOpen, onReportsToggle }) {
    const [active, setActive] = useState(0);
    const [detail, setDetail] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const [showInfo, setShowInfo] = useState(false);

    const confirmed = records.filter(r => r.contractId && ['open', 'won', 'lost'].includes(r.status));
    const settled = records.filter(r => r.contractId && ['won', 'lost'].includes(r.status));
    const totalStake = confirmed.reduce((sum, r) => sum + Number(r.price || 0), 0);
    // Use realized returns, not a possibly still-potential Deriv payout quote.
    // Also corrects historical locally cached rows written before this fix.
    const totalPayout = settled.reduce((sum, r) => sum + (realizedPayoutForRecord(r) ?? 0), 0);
    const profit = settled.reduce((sum, r) => sum + Number(r.profit || 0), 0);
    const won = settled.filter(r => r.status === 'won').length;
    const lost = settled.filter(r => r.status === 'lost').length;
    // Newly started operations must be visible before Deriv confirms buy.
    const mostRecent = records.find(item => isBulkRowAwaitingData(item) ||
        isSettled(item)) || confirmed[0];
    const sections = ['Summary', 'Transactions', 'Journal'];

    const onClear = () => {
        if (isRunning) return;
        if (window.confirm('Reset the bulk trader report for this account? This only clears this website\'s local report. Deriv account statements are not changed.')) {
            onReset();
        }
    };

    // Render the report as an ordinary right-hand panel inside Bulk Trader.
    // The previous nested, fixed-position Deriv Drawer could show an empty
    // white overlay because of inherited height/overflow/transform rules.
    // The tabs, stats and draggable detail modal are still the same experience.
    return (
        <>
            {reportsOpen && <aside
                id='bulk-reports-panel'
                className={`bulk-reports__panel${maximized ? ' bulk-reports__panel--maximized' : ''}`}
                aria-label='Bulk Trader reports'
            >
                <header className='bulk-reports__header'>
                    <strong>Bulk Trader Reports</strong>
                    <div className='bulk-reports__header-actions'>
                        <button type='button' onClick={() => setMaximized(value => !value)}
                            aria-label={maximized ? 'Restore reports size' : 'Expand reports'}
                            title={maximized ? 'Restore size' : 'Expand reports'}>
                            {maximized ? 'Restore' : 'Expand'}
                        </button>
                        <button type='button' onClick={() => { setMaximized(false); onReportsToggle(false); }}
                            aria-label='Hide Bulk Trader reports'>✕</button>
                    </div>
                </header>

                <nav className='bulk-reports__tabs' aria-label='Bulk trading report sections'>
                    {sections.map((section, index) => (
                        <button key={section} type='button'
                            className={active === index ? 'bulk-reports__tab bulk-reports__tab--active' : 'bulk-reports__tab'}
                            aria-current={active === index ? 'page' : undefined}
                            onClick={() => setActive(index)}>{section}</button>
                    ))}
                </nav>

                <div className='bulk-reports__panel-body'>
                    {active === 0 && <div className='bulk-reports__summary'>
                        {mostRecent ? <>
                            <span className={mostRecent.status === 'won' ? 'bulk-reports__profit' : mostRecent.status === 'lost' ? 'bulk-reports__loss' : ''}>
                                {isSettled(mostRecent) ? '⚑ Closed' :
                                    mostRecent.status === 'quoting' ? '◷ Getting proposal' :
                                    mostRecent.status === 'buying' ? '◷ Purchasing' : '◷ Awaiting outcome'}
                            </span>
                            <strong className={mostRecent.status === 'won' ? 'bulk-reports__profit' : mostRecent.status === 'lost' ? 'bulk-reports__loss' : ''}>
                                {isSettled(mostRecent) ?
                                    (Number(mostRecent.profit) > 0 ? '+' : '') + amount(mostRecent.profit, currency) :
                                    confirmedPrice(mostRecent) ? amount(mostRecent.price, currency) + ' stake' :
                                        <TransactionFieldLoader />}
                            </strong>
                            <small>{mostRecent.contractId
                                ? `Contract ${mostRecent.contractId}`
                                : 'Waiting for Deriv purchase confirmation'}</small>
                        </> : <span>No bulk trades yet. Select a demo account and place a trade to see its summary.</span>}
                    </div>}

                    {active === 1 && <div className='bulk-reports__transactions'>
                        <div className='bulk-reports__actions'>
                            <button type='button' onClick={() => exportCsv(records, currency)}
                                disabled={!records.length}>Download</button>
                            <button type='button' onClick={() => setDetail(true)}>View Detail</button>
                        </div>
                        <TradesTable records={records} currency={currency} />
                    </div>}

                    {active === 2 && <div className='bulk-reports__journal'>
                        {journal.length ? journal.map((entry, index) => (
                            <div className='bulk-reports__log' key={entry.id || index}>
                                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                                <p>{entry.message}</p>
                            </div>
                        )) : <p className='bulk-reports__empty'>There are no messages to display.</p>}
                    </div>}
                </div>

                {active !== 2 && <div className='bulk-reports__stats'>
                    <StatisticsSummary
                        currency={currency}
                        is_mobile={false}
                        lost_contracts={lost}
                        number_of_runs={confirmed.length}
                        total_stake={totalStake}
                        total_payout={totalPayout}
                        toggleStatisticsInfoModal={() => setShowInfo(true)}
                        total_profit={profit}
                        won_contracts={won}
                    />
                </div>}

                <footer className='bulk-reports__footer'>
                    <button type='button' onClick={onClear} disabled={(!records.length && !journal.length) || isRunning}>Reset</button>
                </footer>
            </aside>}

            {detail && <DraggableResizeWrapper boundary='.main'
                header='Transactions detailed summary'
                onClose={() => setDetail(false)}
                modalWidth={880} modalHeight={430} minWidth={320} minHeight={320} enableResizing>
                <div className='bulk-reports__detail'>
                    <TradesTable records={records} currency={currency} detailed />
                    <div className='bulk-reports__detail-stats'>
                        <div><b>Account</b><span>{accountId || '—'}</span></div>
                        <div><b>No. of runs</b><span>{confirmed.length}</span></div>
                        <div><b>Total stake</b><span>{amount(totalStake, currency)}</span></div>
                        <div><b>Total payout</b><span>{amount(totalPayout, currency)}</span></div>
                        <div><b>Win</b><span>{won}</span></div>
                        <div><b>Loss</b><span>{lost}</span></div>
                        <div><b>Total profit/loss</b><span>{amount(profit, currency)}</span></div>
                        <div><b>Balance</b><span>{balance == null ? '—' : amount(balance, currency)}</span></div>
                    </div>
                    <p className='bulk-reports__fine-print'>Totals reflect this Bulk Trader's locally recorded purchases. Open contracts have no settled profit/loss yet.</p>
                </div>
            </DraggableResizeWrapper>}

            {showInfo && <div className='bulk-reports__info-overlay' role='presentation' onClick={() => setShowInfo(false)}>
                <div className='bulk-reports__info-dialog' role='dialog' aria-modal='true' aria-label='Statistics information' onClick={e => e.stopPropagation()}>
                    <button type='button' onClick={() => setShowInfo(false)} aria-label='Close'>×</button>
                    <h3>About these statistics</h3>
                    <p>These statistics are for purchases placed with this Bulk Trader only. Total stake is the cost of confirmed contracts. Total payout is the realized return calculated from the confirmed buy price plus Deriv's settled profit, not the potential payout quoted before settlement. Profit/loss counts verified settled contracts only; Deriv's account statement remains authoritative.</p>
                </div>
            </div>}
        </>
    );
}

export default BulkReports;

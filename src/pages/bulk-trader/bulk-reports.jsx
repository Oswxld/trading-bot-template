import { useState } from 'react';
import Drawer from '@/components/shared_ui/drawer';
import Tabs from '@/components/shared_ui/tabs';
import DraggableResizeWrapper from '@/components/draggable/draggable-resize-wrapper';
import { StatisticsSummary } from '@/components/run-panel/run-panel';
import { useDevice } from '@deriv-com/ui';
import './bulk-reports.scss';

// A bulk purchase is not a Deriv Bot run. Render the existing Deriv Drawer,
// Tabs and six-stat summary components, but keep reports sourced ONLY from the
// contracts submitted by this bulk trader, not the Bot Builder's transactions.
const amount = (number, currency) => `${Number(number || 0).toFixed(2)} ${currency}`;
const safeCsv = value => {
    const str = String(value ?? '');
    return '"' + (/^[=+@\-]/.test(str) ? "'" : '') + str.replace(/"/g, '""') + '"';
};

const TradesTable = ({ records, currency, detailed = false }) => (
    <div className='bulk-reports__table-scroll'>
        <table className='bulk-reports__table'>
            <thead>
                <tr>
                    {detailed && <th>Timestamp</th>}
                    <th>Reference</th>
                    <th>Market</th>
                    <th>Trade type</th>
                    {detailed && <><th>Entry spot</th><th>Exit spot</th></>}
                    <th>Buy price</th>
                    <th>Profit/Loss</th>
                </tr>
            </thead>
            <tbody>
                {records.length === 0 ? (
                    <tr><td colSpan={detailed ? 8 : 5} className='bulk-reports__empty'>No bulk trade transactions yet.</td></tr>
                ) : (
                    records.map(item => (
                        <tr key={item.contractId || item.number}>
                            {detailed && <td>{item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}</td>}
                            <td title={item.contractId || item.reason || ''}>{item.contractId || '—'}</td>
                            <td>{item.symbolName || item.symbol || '—'}</td>
                            <td>{item.contractType || '—'}</td>
                            {detailed && <><td>{item.entrySpot ?? '—'}</td><td>{item.exitSpot ?? '—'}</td></>}
                            <td>{Number.isFinite(item.price) && item.price > 0 ? amount(item.price, currency) : '—'}</td>
                            <td className={item.status === 'won' ? 'bulk-reports__profit' : item.status === 'lost' ? 'bulk-reports__loss' : ''}>
                                {item.status === 'won' || item.status === 'lost'
                                    ? (Number(item.profit || 0) > 0 ? '+' : '') + amount(item.profit, currency)
                                    : item.status === 'open' ? 'Open'
                                    : item.status === 'unconfirmed' ? 'Unconfirmed'
                                    : item.status === 'failed' ? 'Failed'
                                    : 'Pending'}
                            </td>
                        </tr>
                    ))
                )}
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

function BulkReports({ records, journal, accountId, currency, balance, isRunning, onReset }) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [detail, setDetail] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const { isDesktop } = useDevice();
    const confirmed = records.filter(r => r.contractId && ['open', 'won', 'lost'].includes(r.status));
    const settled = records.filter(r => r.contractId && ['won', 'lost'].includes(r.status));
    const totalStake = confirmed.reduce((sum, r) => sum + Number(r.price || 0), 0);
    const totalPayout = settled.reduce((sum, r) => sum + Number(r.payout || 0), 0);
    const profit = settled.reduce((sum, r) => sum + Number(r.profit || 0), 0);
    const won = settled.filter(r => r.status === 'won').length;
    const lost = settled.filter(r => r.status === 'lost').length;
    const mostRecent = settled[0] || confirmed[0];

    const onClear = () => {
        if (isRunning) return;
        if (window.confirm('Reset the bulk trader report for this account? This only clears this website\'s local report. Deriv account statements are not changed.')) {
            onReset();
        }
    };

    return (
        <>
            <div className='run-panel bulk-reports'>
                <Drawer
                    anchor='right'
                    className='run-panel run-panel__container bulk-reports__drawer'
                    contentClassName='run-panel__content bulk-reports__content'
                    width={366}
                    is_open={open}
                    toggleDrawer={setOpen}
                    zIndex={6}
                    footer={
                        <div className='run-panel__footer'>
                            <button type='button' className='bulk-reports__reset' onClick={onClear}
                                disabled={(!records.length && !journal.length) || isRunning}>Reset</button>
                        </div>
                    }
                >
                    <Tabs active_index={active} onTabItemClick={setActive} top>
                        <div id='bulk-reports-summary-tab' label='Summary'>
                            <div className='bulk-reports__summary'>
                                {mostRecent ? (
                                    <>
                                        <span className={mostRecent.status === 'won' ? 'bulk-reports__profit' : mostRecent.status === 'lost' ? 'bulk-reports__loss' : ''}>
                                            {mostRecent.status === 'won' || mostRecent.status === 'lost' ? '⚑ Closed' : '◷ Open'}
                                        </span>
                                        <strong className={mostRecent.status === 'won' ? 'bulk-reports__profit' : mostRecent.status === 'lost' ? 'bulk-reports__loss' : ''}>
                                            {['won', 'lost'].includes(mostRecent.status) ?
                                                (Number(mostRecent.profit) > 0 ? '+' : '') + amount(mostRecent.profit, currency) :
                                                amount(mostRecent.price, currency) + ' stake'}
                                        </strong>
                                        <small>Contract {mostRecent.contractId}</small>
                                    </>
                                ) : <span>No bulk trades completed yet.</span>}
                            </div>
                        </div>
                        <div id='bulk-reports-transactions-tab' label='Transactions'>
                            <div className='bulk-reports__transactions'>
                                <div className='bulk-reports__actions'>
                                    <button type='button' onClick={() => exportCsv(records, currency)} disabled={!records.length}>Download</button>
                                    <button type='button' onClick={() => setDetail(true)} disabled={!records.length}>View Detail</button>
                                </div>
                                <TradesTable records={records} currency={currency} />
                            </div>
                        </div>
                        <div id='bulk-reports-journal-tab' label='Journal'>
                            <div className='bulk-reports__journal'>
                                {journal.length ? journal.map((entry, index) => (
                                    <div className='bulk-reports__log' key={entry.id || index}>
                                        <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                                        <p>{entry.message}</p>
                                    </div>
                                )) : <p className='bulk-reports__empty'>There are no messages to display.</p>}
                            </div>
                        </div>
                    </Tabs>
                    {open && active !== 2 && <StatisticsSummary
                        currency={currency}
                        is_mobile={!isDesktop}
                        lost_contracts={lost}
                        number_of_runs={confirmed.length}
                        total_stake={totalStake}
                        total_payout={totalPayout}
                        toggleStatisticsInfoModal={() => setShowInfo(true)}
                        total_profit={profit}
                        won_contracts={won}
                    />}
                </Drawer>
            </div>

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
                    <p>These statistics are for purchases placed with this Bulk Trader only. Total stake is the cost of confirmed contracts. Total payout and profit/loss count settled contracts only; Deriv's account statement remains the authoritative record.</p>
                </div>
            </div>}
        </>
    );
}

export default BulkReports;

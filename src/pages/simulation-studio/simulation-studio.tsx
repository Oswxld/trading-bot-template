import { useEffect, useMemo, useState } from 'react';
import brandConfig from '../../../brand.config.json';
import './simulation-studio.scss';

type Strategy = 'Fixed stake' | 'Martingale' | "D'Alembert";
type SimulationTrade = {
    id: number;
    time: string;
    stake: number;
    profit: number;
    balance: number;
    won: boolean;
};

const money = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

const round = (value: number) => Math.round(value * 100) / 100;
const getNextStake = (trades: SimulationTrade[], strategy: Strategy, baseStake: number) => {
    if (!trades.length || strategy === 'Fixed stake') return baseStake;
    const last = trades[0];
    if (strategy === 'Martingale') return last.won ? baseStake : round(last.stake * 2);
    return last.won ? Math.max(baseStake, round(last.stake - baseStake)) : round(last.stake + baseStake);
};

/**
 * This entire route is a standalone, illustrative experience.
 * It deliberately does not import Deriv API services, send orders,
 * or modify the user's genuine account balance and trade history.
 */
export default function SimulationStudio() {
    const [startingBalance, setStartingBalance] = useState(1000);
    const [stake, setStake] = useState(1);
    const [strategy, setStrategy] = useState<Strategy>('Fixed stake');
    const [stopLoss, setStopLoss] = useState(50);
    const [takeProfit, setTakeProfit] = useState(50);
    const [maxTrades, setMaxTrades] = useState(30);
    const [trades, setTrades] = useState<SimulationTrade[]>([]);
    const [running, setRunning] = useState(false);

    const balance = trades[0]?.balance ?? startingBalance;
    const pnl = round(balance - startingBalance);
    const wins = trades.filter(trade => trade.won).length;
    const canContinue = trades.length < maxTrades && pnl > -stopLoss && pnl < takeProfit && balance >= 0.01;

    useEffect(() => {
        if (!canContinue && running) setRunning(false);
    }, [canContinue, running]);

    useEffect(() => {
        if (!running || !canContinue) return;
        const interval = window.setInterval(() => {
            setTrades(previous => {
                const currentBalance = previous[0]?.balance ?? startingBalance;
                const currentProfit = round(currentBalance - startingBalance);
                if (
                    previous.length >= maxTrades ||
                    currentProfit <= -stopLoss ||
                    currentProfit >= takeProfit
                ) return previous;

                const nextStake = Math.min(getNextStake(previous, strategy, stake), currentBalance);
                if (nextStake < 0.01) return previous;

                // Random illustrative outcomes: NOT market data, actual Deriv quotes, or predictions.
                const won = Math.random() < 0.47;
                const profit = round(won ? nextStake * 0.85 : -nextStake);
                const nextBalance = round(currentBalance + profit);
                return [{
                    id: (previous[0]?.id ?? 0) + 1,
                    time: new Date().toLocaleTimeString(),
                    stake: nextStake,
                    profit,
                    balance: nextBalance,
                    won,
                }, ...previous];
            });
        }, 1600);
        return () => window.clearInterval(interval);
    }, [running, canContinue, startingBalance, maxTrades, stopLoss, takeProfit, strategy, stake]);

    const chart = useMemo(() => {
        const values = [startingBalance, ...trades.slice().reverse().map(t => t.balance)];
        const low = Math.min(...values) - 2;
        const high = Math.max(...values) + 2;
        return values.map((v, i) =>
            `${(i / Math.max(1, values.length - 1)) * 100},${100 - ((v - low) / (high - low)) * 100}`
        ).join(' ');
    }, [trades, startingBalance]);

    const reset = () => {
        setRunning(false);
        setTrades([]);
    };

    const field = (label: string, value: number, setter: (value: number) => void, min: number, max: number, step = 1) => (
        <label className='simulation-studio__field'>
            <span>{label}</span>
            <input type='number' min={min} max={max} step={step} disabled={running || trades.length > 0}
                value={value} onChange={event => setter(Math.max(min, Math.min(max, Number(event.target.value) || min)))} />
        </label>
    );

    return (
        <div className='simulation-studio'>
            <div className='simulation-studio__banner' role='status'>
                SIMULATION ONLY • VIRTUAL FUNDS • NO REAL TRADES OR VERIFIED PERFORMANCE
            </div>
            <header className='simulation-studio__header'>
                <div>
                    <p className='simulation-studio__eyebrow'>Training and promotional demonstration</p>
                    <h1>{brandConfig.brand_name} — Simulation Studio</h1>
                    <p>Explore illustrative stake-management sequences without placing Deriv orders.</p>
                </div>
                <a href='/'>Back to live Deriv Bot</a>
            </header>
            <div className='simulation-studio__layout'>
                <section className='simulation-studio__panel'>
                    <h2>Virtual account</h2>
                    <p className='simulation-studio__eyebrow'>SIMULATED BALANCE • USD</p>
                    <div className='simulation-studio__balance'>{money(balance)}</div>
                    <div className='simulation-studio__stats'>
                        <div><span>Illustrative P/L</span><strong className={pnl >= 0 ? 'positive' : 'negative'}>{money(pnl)}</strong></div>
                        <div><span>Simulated trades</span><strong>{trades.length}</strong></div>
                        <div><span>Illustrative win rate</span><strong>{trades.length ? (wins / trades.length * 100).toFixed(1) : '0.0'}%</strong></div>
                    </div>
                    <div className='simulation-studio__chart'>
                        <div>Illustrative balance progression</div>
                        <svg viewBox='0 0 100 100' preserveAspectRatio='none' role='img' aria-label='Simulated balance progression'>
                            <polyline points={chart} fill='none' stroke='#f5c842' strokeWidth='1.5' vectorEffect='non-scaling-stroke'/>
                        </svg>
                    </div>
                    <p className='simulation-studio__note'>Results are randomly simulated, not based on live prices. They do not predict bot performance or constitute trading records.</p>
                </section>
                <section className='simulation-studio__panel'>
                    <h2>Demonstration controls</h2>
                    <label className='simulation-studio__field'>
                        <span>Illustrative stake rule</span>
                        <select value={strategy} disabled={running || trades.length > 0} onChange={e => setStrategy(e.target.value as Strategy)}>
                            <option>Fixed stake</option>
                            <option>Martingale</option>
                            <option>D'Alembert</option>
                        </select>
                    </label>
                    <div className='simulation-studio__fields'>
                        {field('Starting virtual balance ($)', startingBalance, setStartingBalance, 10, 100000)}
                        {field('Base virtual stake ($)', stake, setStake, 0.35, 10000, 0.01)}
                        {field('Stop loss ($)', stopLoss, setStopLoss, 1, 100000)}
                        {field('Take profit ($)', takeProfit, setTakeProfit, 1, 100000)}
                        {field('Maximum simulated trades', maxTrades, setMaxTrades, 1, 200)}
                    </div>
                    <div className='simulation-studio__actions'>
                        <button type='button' className='simulation-studio__primary' disabled={!running && !canContinue}
                            onClick={() => setRunning(value => !value)}>
                            {running ? 'Stop simulation' : 'Run simulation'}
                        </button>
                        <button type='button' onClick={reset}>Reset</button>
                    </div>
                    {!canContinue && <p className='simulation-studio__note'>Simulation limit reached. Reset to start another session.</p>}
                    <p className='simulation-studio__note'>This feature does not connect to Deriv or use real money. Stake rules here are simplified illustrations, not Deriv's Quick Strategy engine.</p>
                </section>
            </div>
            <section className='simulation-studio__panel simulation-studio__history'>
                <h2>Illustrative transaction history</h2>
                {trades.length === 0 ? <p>No simulated transactions yet. Select Run simulation to begin.</p> : (
                    <div className='simulation-studio__table-wrap'>
                        <table>
                            <thead><tr><th>Trade</th><th>Time</th><th>Virtual stake</th><th>Result</th><th>Virtual balance</th></tr></thead>
                            <tbody>{trades.map(trade => (
                                <tr key={trade.id}>
                                    <td>SIM-{String(trade.id).padStart(4, '0')}</td>
                                    <td>{trade.time}</td>
                                    <td>{money(trade.stake)}</td>
                                    <td className={trade.won ? 'positive' : 'negative'}>{money(trade.profit)}</td>
                                    <td>{money(trade.balance)}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

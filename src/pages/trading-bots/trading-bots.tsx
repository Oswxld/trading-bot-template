import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import './trading-bots.scss';

type TReadyBot = {
    id: string;
    label: string;
    category: string;
    strategy: string;
    risk: string;
    desc: string;
};

// All XML templates live in this repository. No paid services or external downloads.
const READY_BOTS: TReadyBot[] = [
  {
    "id": "rsi-direction",
    "label": "RSI Direction",
    "category": "Indicators",
    "strategy": "RSI 14: Rise below 30, Fall above 70",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Checks RSI for overbought and oversold conditions before buying Rise/Fall contracts."
  },
  {
    "id": "moving-average",
    "label": "Moving Average",
    "category": "Indicators",
    "strategy": "SMA 10 vs SMA 21",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Compares short- and long-period simple moving averages to choose a direction."
  },
  {
    "id": "bollinger-bands",
    "label": "Bollinger Bands",
    "category": "Indicators",
    "strategy": "20-period / 2-deviation bands",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Takes a contrarian Rise/Fall entry when the last close is outside a Bollinger Band."
  },
  {
    "id": "macd-momentum",
    "label": "MACD Momentum",
    "category": "Indicators",
    "strategy": "MACD 12/26/9 histogram",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Uses the sign of the MACD histogram to choose Rise or Fall."
  },
  {
    "id": "digit-differs",
    "label": "Digit Differs",
    "category": "Digits",
    "strategy": "Differs from digit 5",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Buys Digit Differs contracts against a fixed, editable prediction digit."
  },
  {
    "id": "digit-over-under",
    "label": "Digit Over/Under",
    "category": "Digits",
    "strategy": "Over/Under digit 5",
    "risk": "Fixed stake · 20-trade limit",
    "desc": "Selects an Over or Under contract using a simple last-digit rule; no predictive edge is claimed."
  }
];

const TradingBots = observer(() => {
    const { dashboard, run_panel, blockly_store } = useStore();
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [error, setError] = useState('');

    const loadReadyBot = async (bot: TReadyBot) => {
        if (loadingId || blockly_store.is_loading) return;
        if (run_panel.is_running) {
            setError('Stop the currently running bot before loading another strategy.');
            return;
        }

        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace) {
            setError('The Bot Builder is not ready. Please try again after it finishes loading.');
            return;
        }

        setError('');
        setLoadingId(bot.id);
        try {
            const module = await import(/* webpackChunkName: "ready-bots" */ `../../xml/ready-bots/${bot.id}.xml`);
            const result = (await load({
                block_string: module.default,
                drop_event: null,
                file_name: bot.label,
                strategy_id: null,
                from: save_types.UNSAVED,
                workspace,
                showIncompatibleStrategyDialog: null,
                show_snackbar: false,
            })) as { error?: string } | void;

            if (result?.error) throw new Error(result.error);

            // Deliberately do not run the strategy. The user reviews it and clicks Run.
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not import this bot.');
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <section className='trading-bots' aria-label='Trading bots'>
            <div className='trading-bots__intro'>
                <div>
                    <p className='trading-bots__eyebrow'>BOT LIBRARY</p>
                    <h2>Free Trading Bots</h2>
                    <p>Choose a strategy, load it into Bot Builder, review the blocks, then press Run yourself.</p>
                </div>
                <span className='trading-bots__count'>6 free bots</span>
            </div>
            {error && <p className='trading-bots__error' role='alert'>{error}</p>}
            <div className='trading-bots__grid'>
                {READY_BOTS.map(bot => (
                    <article className='trading-bots__card' key={bot.id}>
                        <div className='trading-bots__card-head'>
                            <span className='trading-bots__emoji' aria-hidden='true'>🤖</span>
                            <span className='trading-bots__badge'>FREE</span>
                        </div>
                        <h3>{bot.label}</h3>
                        <span className='trading-bots__category'>{bot.category}</span>
                        <p className='trading-bots__description'>{bot.desc}</p>
                        <div className='trading-bots__details'>
                            <span>{bot.strategy}</span>
                            <span>{bot.risk}</span>
                        </div>
                        <button
                            type='button'
                            className='trading-bots__load'
                            disabled={!!loadingId || blockly_store.is_loading || run_panel.is_running}
                            onClick={() => void loadReadyBot(bot)}
                        >
                            {loadingId === bot.id ? 'LOADING BOT…' : 'LOAD BOT INTO BUILDER'}
                        </button>
                    </article>
                ))}
            </div>
            <p className='trading-bots__disclaimer'>
                Trading involves a risk of loss. These are example strategies, not profit guarantees.
                Fixed stakes and session stop conditions do not guarantee a maximum loss.
                Loading a bot replaces your current Blockly workspace. Test on a demo account first.
            </p>
        </section>
    );
});

export default TradingBots;

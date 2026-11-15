# Chunk 6.1 — Digit Pattern Score Model (Design Contract v1.0.0)

**Status:** model and interface **defined in 6.1**, scoring calculations **implemented in 6.2**, and highest-score/tie detection **implemented in 6.3**. Dashboard integration **implemented in 6.4**; forward-only predictive evaluation remains for 6.5.

## Product meaning and constraints

The dashboard may show **one score from 0 to 100 for each of the ten digits (0–9)** and highlight the highest in green once enough genuine observations exist. A score is a *relative descriptive pattern-strength index* over the observed window. It is **not** a probability of the next tick matching that digit, a statistical confidence interval, a trading signal, or a verified trading advantage. Scores need not add up to 100. A score of 84 **does not** mean an 84% chance of a match.

Use the honest user-facing label **Digit pattern score**, optionally with an explanatory tooltip: “Historical frequency, recency and trend relative to an equal-digit reference; not a next-tick probability.” Never show an unqualified “84% confidence” or “84% chance”.

## Input / sample design

- Input: one market's **validated, oldest-to-newest, deduplicated** rolling observations from the existing synchronized live/history pipeline. Use the actual retained tick count `N`, **not** the selected capacity 100, 500 or 1,000.
- The formatted price's last digit from the existing `AnalyzerTick.digit` is authoritative; do not reformat or infer precision, generate missing ticks, access authenticated accounts, or place trades.
- Require **N >= 100** valid actual observations before returning scores or a leader. If `N < 100`, return `status: insufficient-data` with `scores: []`. No green highlight. For `N = 0`, this is “awaiting market data”; for `0 < N < 100`, it is “collecting observations (N/100)”.
- For an eligible sample, define **recent** as the last `R = min(100, floor(N/2))` observations and **earlier** as the first `E = N - R`. These slices **must not overlap**. At N=100: R=50 and E=50. At N=500: R=100 and E=400. At N=1,000: R=100 and E=900. A selection change only recomputes; no extra sockets.
- For every digit `d` simultaneously, count its occurrences `c_full[d]`, `c_recent[d]`, `c_earlier[d]`, where `c_full[d] = c_recent[d] + c_earlier[d]`. Preserve all ten entries ordered 0–9.
- Use a **uniform reference rate** `p0 = 0.1` purely as a comparison benchmark. This is not a claim that Deriv digits are statistically independent, uniform in every market, or predictable.

## Exact v1 calculation specified for Chunk 6.2

Per digit `d`:

```text
p_full   = c_full[d]    / N
p_recent = c_recent[d]  / R
p_earlier= c_earlier[d] / E
p0 = 0.10

z_full   = (p_full - p0) / sqrt(p0 * (1 - p0) / N)
z_recent = (p_recent - p0) / sqrt(p0 * (1 - p0) / R)
z_trend  = (p_recent - p_earlier) /
           sqrt(p0 * (1 - p0) * (1/R + 1/E))

clamp(x, lo, hi) = min(hi, max(lo, x))
signal(z) = clamp(z / 3, -1, 1)

raw_score = 50 + 50 * (
      0.40 * signal(z_full)
    + 0.35 * signal(z_recent)
    + 0.25 * signal(z_trend)
)
score = clamp(raw_score, 0, 100)
```

This compares a digit's **full-window frequency (40%)**, **recent frequency (35%)**, and **recent-versus-earlier shift (25%)**. The sqrt terms scale differences by window size against the reference's binomial variance. This is a *standardized contrast*, **not a formal significance test**: ticks may be correlated and the reference assumption may not hold.

- Scores must be **unrounded internally**. Round only in UI labels.
- `50` is neutral (no measured deviation from the reference on any component). `0` and `100` are clipping endpoints, not probabilities. Components share observations and are correlated; the weights are intentionally heuristic, **not validated or calibrated**.
- Never let a NaN, Infinity, malformed digit, mismatched snapshot count, wrong symbol or out-of-order sample silently produce a score. Fail safely using existing validation primitives.
- All calculations must be **pure read-only functions**. Do not alter tick IDs, append ticks, write to any trading module, or persist user/account state.

## Score readiness, highest green indicator and ties

- `insufficient-data`: **no scores and no green leader**.
- `ready`: ten valid finite scores indexed by digit; each in `[0,100]`, with fixed weight/configuration version.
- Chunk 6.3 identifies leaders from the **unrounded** scores using the deterministic rule `highestScore = max(score[0..9])` and `leaderDigits = {d | highestScore - score[d] <= 1e-9}`. The absolute tolerance **1e-9 score points** only absorbs tiny floating-point differences; **equal rounded UI labels do not create ties**. Return all joint leaders in ascending digit order and `isTie: true` for two or more. A uniformly balanced sample produces ten co-leaders, never an invented unique prediction. Do not arbitrarily choose the first, use randomness or infer next-tick odds. The function also validates score entries, totals, readiness metadata and model version before ranking.
- The green indicator means **“highest historical pattern score in this observed sample”**, not “recommended trade”, “next digit” or “probable win”. No green highlight when loading, disconnected with no verified ticks, invalid, or insufficient observations.
- On genuine tick arrival, recompute from the currently selected market and window. On a market switch, clear old-market scores immediately; do not combine markets. On size change, use only retained actual ticks.

## Evaluation plan for Chunk 6.5 (must precede predictive claims)

1. Reproduce all scores exactly with an independent reference over 100/500/1,000 tick windows, partial samples, rollover, stale responses, market switches and simultaneous ticks.
2. Verify score order 0–9; no-data states; repeatability; immutable inputs; finite bounds; tie handling; and mobile label accessibility.
3. Run **chronological walk-forward** evaluation: compute a candidate ranking using only ticks strictly **before** the next held-out tick; compare top-digit hit rate to the 10% uniform reference and to a simple historical-frequency-only ranking on the same periods. Avoid leakage, selecting a window based on hindsight, and tuning weights on the test period.
4. Assess stability across instruments and changing market regimes; report the sample count and uncertainty for hit rates. If there is no meaningful out-of-sample lift, keep the feature **descriptive only** and do not assert predictive ability.

## Build sequence

- **6.1** (this commit): define the scoring formula, versioned configuration, data contract and restrictions.
- **6.2** (complete): pure scoring engine in `../services/digit-pattern-score.ts` with mathematical unit tests, strict input validation, rolling snapshot support and no inferred next-tick probability.
- **6.3** (complete): pure leader detection and deterministic tie handling in `../services/digit-pattern-leaders.ts`, with no-data gating and regression tests.
- **6.4** (complete): render all ten digit scores in the dashboard using `../components/digit-pattern-scores.tsx`; highlight all joint leaders in green, distinguish loading/collecting/ready states, and maintain a 5-column layout on narrow screens.
- **6.5**: full integration/stress testing and forward-only performance evaluation.

Source of truth for configuration and result types: `../services/digit-pattern-score-model.ts`. Scoring engine: `../services/digit-pattern-score.ts`. Leader selection: `../services/digit-pattern-leaders.ts`. The dashboard now connects scoring and leader selection to the same synchronized rolling sample as the existing statistics. The green highlight is descriptive only; it is not a probability or trading signal.

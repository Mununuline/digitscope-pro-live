# DigitScope Pro — AI Strategy Discovery Engine

## Purpose

Extend the existing DigitScope Pro Live terminal and AI Market Assistant into an adaptive research system that **discovers, manufactures, tests, ranks, and improves candidate trading strategies** under prevailing Deriv synthetic-index conditions.

The user-facing workflow remains simple:

1. Select a Volatility market.
2. Tap **SCAN**.
3. Analyse the current market regime and recent live ticks.
4. Select the strongest eligible candidate strategy and target last digit (0–9).
5. Return **TRADE**, **WAIT**, or **NO TRADE**, including contract, entry tick, expiry tick, probability estimates, validation evidence, and reasons.

“Manufacture” means generating explicit, testable strategy hypotheses and parameter variants. It does not mean fabricating a winning digit or claiming certainty. The system must be ambitious in discovery and strict in validation.

## Fit with the existing project

This is an extension of the existing DigitScope Pro Live application, not a separate predictor or replacement dashboard.

- Preserve the existing live Deriv feed, market selector, tick processing, Dataset Registry (DS-01–DS-08), provenance audit, and AI Market Assistant.
- Keep DS-08 as a chronological view derived from DS-06, not an independent dataset.
- Do not delete, rewrite, silently migrate, or invent historical dataset records or IDs.
- Keep performance comparisons and trading use of registry datasets disabled until provenance and duplicate conflicts are reconciled.
- The current assistant decision engine remains the final deterministic safety gate. An LLM may propose hypotheses or explain evidence, but may not override validation or decision gates.
- Order execution remains disabled. This project phase is research and decision support only.

## Strategy discovery lifecycle

### 1. Observe prevailing market conditions

Build a market-regime snapshot independently for each market. Candidate features include:

- Digit 0–9 frequency and deviations across multiple rolling windows.
- Digit transition matrix and conditional next-digit frequencies.
- Repetition, alternation, run length, and digit drought measures.
- Distribution drift and change-point indicators.
- Volatility/market tick cadence, feed latency, missing ticks, and data quality.
- Stability or disagreement between short-, medium-, and long-window features.

Regime labels are descriptive (for example, balanced, frequency-skewed, transition-skewed, drifting, or insufficient data). They must be inferred from measured features, not assumed to represent exploitable predictability.

### 2. Manufacture candidate strategies

Generate versioned, reproducible strategy hypotheses from a bounded strategy grammar. Candidate families may include:

- Rolling-frequency strategies (hot/cold digits).
- Conditional-transition strategies (previous digit or short sequence).
- Repetition and alternation strategies.
- Run-length and drought-conditioned strategies.
- Multi-window confluence strategies.
- Regime-conditioned ensembles combining independently validated candidates.

Each candidate must declare: immutable strategy ID/version, market scope, contract type, target digit or selection rule, features, lookback windows, forecast horizon/expiry, entry rule, regime applicability, parameter set, and a deterministic prediction function. Every change to parameters or logic creates a new version; no retroactive editing of historical predictions.

### 3. Test without leakage

Use chronological walk-forward evaluation:

- Train/choose parameters only on data available before each forecast origin.
- Record the forecast before its target tick arrives.
- Evaluate only on subsequent unseen ticks or a strictly separated holdout.
- Prevent duplicate/overlapping target outcomes from inflating sample counts.
- Keep market, contract, digit, horizon, strategy version, and regime cohorts separate.
- Compare against appropriate random/base-rate and simple frequency baselines.
- Track sample count, hit rate, confidence intervals (including Wilson lower bound), calibration/Brier score, drawdown or payout-aware return simulation, and regime stability.
- Correct for multiple strategy/digit/market hypotheses (for example, Holm or another predeclared family-wise error procedure) and account for repeated strategy searches.
- Never use aggregate results from unrelated contracts/digits as evidence for a specific candidate.

### 4. Compete and promote

A strategy tournament ranks candidates on a predeclared scorecard, not raw hit rate alone. Require minimum evidence, positive payout-aware expectancy after quoted payout, confidence bounds above break-even, acceptable calibration, robustness across time blocks, and no data-quality warnings.

Keep candidates in distinct states: DISCOVERED → BACKTESTED → SHADOW / LIVE-VALIDATION → QUALIFIED or REJECTED. A newly generated strategy cannot become TRADE-eligible based only on in-sample results. Promotion requires a fresh, contract-matched, out-of-sample validation record for the exact strategy version and forecast horizon.

### 5. Improve safely

AI may suggest new feature combinations, parameter ranges, regime conditions, or ensemble designs based on failure analysis. The system then creates a new candidate version and repeats the full evaluation lifecycle. Preserve experiment logs, rejected candidates, model/strategy versions, and reasons for promotion or rejection. No candidate may rewrite its own past forecasts or validation outcomes.

## Quick Scan result contract

For each selected market, the scan should return:

- Market and market-regime snapshot.
- Decision: TRADE / WAIT / NO TRADE.
- Strategy name, immutable version, and validation status.
- Contract: MATCHES / DIFFERS (and EVEN / ODD only where supported by a separately validated strategy).
- Recommended target last digit (0–9) for digit contracts.
- Entry condition and exact entry tick reference.
- Expiry/forecast horizon and target tick reference.
- Estimated event probability, confidence interval, current payout quote, and break-even probability.
- Contract-matched out-of-sample sample size, hit rate, calibration, and recent regime-specific performance.
- Clear reasons and data-quality/latency status.

The “exit point” in this product means the **target last digit/settlement outcome**, not a price level. For a one-tick contract, identify the next eligible target tick. The UI must distinguish the forecast target tick from a confirmed settlement result.

## Decision policy

- **TRADE:** only when the exact strategy version has sufficient independent contract- and market-matched out-of-sample evidence; its conservative probability bound and expected payout-aware performance clear the current quote's break-even threshold after applicable multiple-testing controls; and feed/data quality gates pass.
- **WAIT:** insufficient live ticks, no fresh quote, too little validation, or a strategy still in discovery/shadow testing.
- **NO TRADE:** evidence indicates the candidate fails the predefined statistical, payout, stability, latency, or data-integrity criteria.

The existing deterministic assistant engine remains authoritative. AI-generated candidate scores or natural-language confidence cannot bypass it. A displayed probability is an estimate, not a guarantee.

## Implementation sequence

1. **Foundation:** preserve current UI and DS-01–DS-08; complete provenance/duplicate reconciliation before using registry records for comparative performance.
2. **Regime engine:** implement per-market rolling feature snapshots and regime-change detection with tests.
3. **Strategy registry and generator:** define a deterministic strategy interface, immutable versions, bounded candidate generation, and reproducible experiment IDs.
4. **Walk-forward evaluator:** add leakage-proof chronological replay, unique target tracking, market/contract isolation, calibration, confidence intervals, and multiple-testing controls.
5. **Tournament and shadow validation:** rank candidates and promote only exact versions that pass out-of-sample gates.
6. **Quick Scan integration:** connect the best eligible candidate to the existing AI Market Assistant and show the recommended target last digit, contract, entry, and expiry.
7. **Monitoring:** record every recommendation before outcome, then reconcile actual outcomes and monitor drift; retain full audit history.
8. **Later, separately authorised phase:** demo execution only after decision quality, risk limits, confirmations, and loss protections are independently tested. No live execution is part of this scope.

## Required tests

- No future tick or target outcome is visible to a forecast.
- Strategy versions and experiment records are immutable.
- No duplicate target tick inflates independent trial counts.
- Evidence is isolated by market, contract, digit, horizon, regime, and strategy version.
- Candidate generation is reproducible from a recorded seed/configuration.
- Multiple-testing correction is applied to the declared candidate family.
- Probability calibration and payout break-even are computed correctly.
- AI output cannot override deterministic TRADE / WAIT / NO TRADE gates.
- Dataset provenance constraints remain enforced.
- Missing/stale quotes, latency, feed gaps, and insufficient samples fail closed.

## Current status

This document defines the integrated target architecture. It does not claim that autonomous strategy generation, the regime engine, the tournament, or contract-specific validation have already been implemented. The existing assistant still lacks the validated contract-specific evidence needed to issue a TRADE decision from the current UI. Order execution remains disabled.

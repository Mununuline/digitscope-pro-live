"use strict";

const ALLOWED_MARKETS = new Set(["R_10","R_25","R_50","R_75","R_100","1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"]);

function countsOf(digits) {
  const counts = Array(10).fill(0);
  digits.forEach(d => { counts[d]++; });
  return counts;
}

function chooseHot(digits) {
  const counts = countsOf(digits);
  return counts.indexOf(Math.max(...counts));
}

function chooseCold(digits) {
  const counts = countsOf(digits);
  return counts.indexOf(Math.min(...counts));
}

function chooseTransition(digits) {
  const matrix = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (let i = 0; i < digits.length - 1; i++) matrix[digits[i]][digits[i + 1]]++;
  const previous = digits[digits.length - 1];
  const row = matrix[previous];
  if (!row || row.reduce((a, b) => a + b, 0) < 5) return null;
  return row.indexOf(Math.max(...row));
}

function chooseRepeat(digits) {
  if (digits.length < 2) return null;
  return digits[digits.length - 1];
}

function chooseAlternate(digits) {
  if (digits.length < 3) return null;
  const last = digits[digits.length - 1];
  const previous = digits[digits.length - 2];
  if (last === previous) return null;
  return last;
}

const STRATEGIES = [
  { id: "rolling-hot-100-v1", label: "Rolling hot digit · 100", window: 100, pick: chooseHot },
  { id: "rolling-cold-100-v1", label: "Rolling cold digit · 100", window: 100, pick: chooseCold },
  { id: "rolling-hot-250-v1", label: "Rolling hot digit · 250", window: 250, pick: chooseHot },
  { id: "rolling-cold-250-v1", label: "Rolling cold digit · 250", window: 250, pick: chooseCold },
  { id: "conditional-transition-250-v1", label: "Conditional transition · 250", window: 250, pick: chooseTransition },
  { id: "repeat-last-v1", label: "Repeat-last hypothesis", window: 100, pick: chooseRepeat },
  { id: "alternate-last-v1", label: "Alternate-last hypothesis", window: 100, pick: chooseAlternate }
];

function wilsonLowerBound(wins, trials, z = 1.96) {
  if (!trials) return 0;
  const p = wins / trials, z2 = z * z;
  return (p + z2 / (2 * trials) - z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / (1 + z2 / trials);
}

/**
 * Exploratory, one-step walk-forward replay. At each origin the strategy sees
 * only prior digits and predicts the next digit. Outcomes are not shared across
 * strategies as independent evidence; this endpoint never grants TRADE status.
 */
function discoverStrategies(input) {
  const market = String(input.market || "");
  const digits = Array.isArray(input.digits) ? input.digits.map(Number) : [];
  if (!ALLOWED_MARKETS.has(market)) throw new Error("Unsupported market.");
  if (digits.length > 1000 || digits.some(d => !Number.isInteger(d) || d < 0 || d > 9)) {
    throw new Error("Provide up to 1,000 valid last digits (0–9).");
  }
  if (digits.length < 300) {
    return { market, status: "WAIT", message: "Collect at least 300 sequential ticks before strategy discovery.", observations: digits.length, candidates: [] };
  }

  const candidates = STRATEGIES.map(strategy => {
    let predictions = 0, wins = 0, brier = 0;
    const firstOrigin = strategy.window;
    for (let targetIndex = firstOrigin; targetIndex < digits.length; targetIndex++) {
      const history = digits.slice(targetIndex - strategy.window, targetIndex);
      const predicted = strategy.pick(history);
      if (!Number.isInteger(predicted) || predicted < 0 || predicted > 9) continue;
      const actual = digits[targetIndex];
      predictions++;
      if (predicted === actual) wins++;
      // Brier score for a 10-class point forecast; descriptive only.
      for (let d = 0; d < 10; d++) {
        const error = (d === predicted ? 1 : 0) - (d === actual ? 1 : 0);
        brier += error * error;
      }
    }
    const rate = predictions ? wins / predictions : null;
    return {
      id: strategy.id, label: strategy.label, contract: "DIGIT_MATCH",
      forecastHorizonTicks: 1, trainingWindow: strategy.window,
      trials: predictions, wins, hitRate: rate,
      wilsonLowerBound: predictions ? wilsonLowerBound(wins, predictions) : null,
      brierScore: predictions ? brier / predictions : null,
      status: predictions >= 100 ? "EXPLORATORY_CANDIDATE" : "INSUFFICIENT_EVIDENCE"
    };
  }).sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1));

  return {
    market, status: "RESEARCH_ONLY", observations: digits.length,
    methodology: "Chronological one-step replay; each prediction uses only preceding ticks. Candidate comparisons are exploratory and require untouched future shadow validation and multiple-testing correction.",
    baselineHitRate: 0.10,
    candidates,
    tradeEligible: false,
    decision: "WAIT",
    execution: "DISABLED — strategy discovery does not place orders."
  };
}

module.exports = { discoverStrategies, wilsonLowerBound };

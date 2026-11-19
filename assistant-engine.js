"use strict";

const ALLOWED_MARKETS = new Set(["R_10","R_25","R_50","R_75","R_100","1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"]);

function wilsonLowerBound(wins, trials, z = 1.96) {
  if (!trials) return 0;
  const p = wins / trials, z2 = z * z;
  return (p + z2 / (2 * trials) - z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / (1 + z2 / trials);
}

function evaluateAssistant(input) {
  const market = String(input.market || "");
  const contract = String(input.contract || "");
  const tickCount = Number(input.tickCount);
  const latencyMs = input.latencyMs === null ? null : Number(input.latencyMs);
  const validationTrials = Number(input.validationTrials);
  const validationWins = Number(input.validationWins);
  const payout = Number(input.totalPayout);
  const estimatedChance = Number(input.estimatedChance);
  const reasons = [];
  if (!ALLOWED_MARKETS.has(market)) reasons.push("Unknown or unsupported market.");
  if (!["MATCHES","DIFFERS"].includes(contract)) reasons.push("No valid contract candidate.");
  if (!Number.isInteger(tickCount) || tickCount < 500) reasons.push("At least 500 live ticks are required.");
  if (input.signalQualified !== true) reasons.push("The statistical signal gate is not qualified.");
  if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs > 250)) reasons.push("Feed latency is too high or unavailable.");
  if (!Number.isInteger(validationTrials) || validationTrials < 100) reasons.push("At least 100 independent, contract-matched out-of-sample trials are required.");
  if (!Number.isInteger(validationWins) || validationWins < 0 || validationWins > validationTrials) reasons.push("Validation outcome counts are invalid.");
  if (!Number.isFinite(payout) || payout <= 1) reasons.push("A current Deriv total-payout quote is required.");
  if (!Number.isFinite(estimatedChance) || estimatedChance <= 0 || estimatedChance >= 1) reasons.push("A valid estimated event probability is required.");
  const lowerBound = Number.isInteger(validationTrials) && validationTrials > 0 &&
    Number.isInteger(validationWins) && validationWins >= 0 && validationWins <= validationTrials
      ? wilsonLowerBound(validationWins, validationTrials) : 0;
  const breakEven = Number.isFinite(payout) && payout > 1 ? 1 / payout : null;
  if (breakEven !== null && lowerBound <= breakEven) reasons.push("The 95% Wilson lower bound does not exceed the quoted break-even probability.");
  if (Number.isFinite(estimatedChance) && breakEven !== null && estimatedChance <= breakEven) reasons.push("The estimated probability does not exceed the quoted break-even probability.");
  const decision = reasons.length ? (tickCount < 500 || validationTrials < 100 || !Number.isFinite(payout) || payout <= 1 ? "WAIT" : "NO TRADE") : "TRADE";
  return {
    decision, market, contract, tickCount: Number.isFinite(tickCount) ? tickCount : 0,
    validationTrials: Number.isFinite(validationTrials) ? validationTrials : 0,
    validationWinRate: validationTrials > 0 && validationWins >= 0 && validationWins <= validationTrials ? validationWins / validationTrials : null,
    validationLowerBound: lowerBound, breakEvenProbability: breakEven, reasons,
    execution: "DISABLED — decision support only; no order was placed."
  };
}

module.exports = { evaluateAssistant, wilsonLowerBound };

/* DigitScope Dataset Registry v1
 * Metadata and compatibility controls only. Legacy outcomes are never rewritten.
 * This module does not infer missing tick IDs or claim independent samples.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DigitScopeDatasetRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFINITIONS = Object.freeze({
    "DS-01": { name: "Live market radar", kind: "raw_observations", unit: "tick", sampling: "live_stream", horizon: null, baseline: null, independent: false },
    "DS-02": { name: "Signal Validation & Performance", kind: "forecast_outcomes", unit: "settled_forecast", sampling: "rolling_overlapping", horizon: 3, baseline: 0.10, independent: false },
    "DS-03": { name: "Unified DIGIT Trade Scanner", kind: "contract_model_outcomes", unit: "model_contract_evaluation", sampling: "rolling_overlapping_multi_model", horizon: 3, baseline: "contract_specific", independent: false },
    "DS-04": { name: "3-Tick MATCH / DIFFERS Analyzer", kind: "replay_outcomes", unit: "settled_forecast", sampling: "rolling_overlapping_replay", horizon: 3, baseline: "MATCH=0.10;DIFFERS=0.90", independent: false },
    "DS-05": { name: "MATCH / DIFFERS Decision Engine", kind: "forecast_outcomes", unit: "settled_forecast", sampling: "every_third_tick", horizon: 3, baseline: "contract_specific", independent: false },
    "DS-06": { name: "Rolling Performance Tracker", kind: "forecast_outcomes", unit: "settled_forecast", sampling: "rolling_overlapping", horizon: 3, baseline: 0.10, independent: false },
    "DS-07": { name: "Statistical Reliability", kind: "forecast_outcomes", unit: "settled_forecast", sampling: "every_third_tick", horizon: 3, baseline: 0.10, independent: false },
    "DS-08": { name: "Market Evidence & Holdout", kind: "evaluation_view", unit: "view_of_DS-06_outcomes", sampling: "chronological_split_of_DS-06", horizon: 3, baseline: 0.10, independent: false, derivedFrom: "DS-06" }
  });

  const REQUIRED = ["dataset_id", "methodology_version", "market", "contract", "model_id",
    "forecast_origin_tick_id", "target_tick_id", "training_window", "forecast_horizon",
    "observed_digit", "hit", "scored_at_utc"];

  function nonEmpty(value) { return value !== null && value !== undefined && String(value).trim() !== ""; }
  function validDigit(value) { return Number.isInteger(value) && value >= 0 && value <= 9; }

  function createProvenance(input) {
    const source = input || {};
    return {
      dataset_id: source.dataset_id || "",
      methodology_version: source.methodology_version || VERSION,
      market: source.market || "",
      contract: source.contract || "",
      model_id: source.model_id || "",
      selected_digit: source.selected_digit === undefined ? null : source.selected_digit,
      forecast_origin_tick_id: source.forecast_origin_tick_id || null,
      target_tick_id: source.target_tick_id || null,
      training_window: source.training_window || null,
      forecast_horizon: source.forecast_horizon === undefined ? null : source.forecast_horizon,
      observed_digit: source.observed_digit === undefined ? null : source.observed_digit,
      hit: typeof source.hit === "boolean" ? source.hit : null,
      scored_at_utc: source.scored_at_utc || null
    };
  }

  function validate(record) {
    const r = createProvenance(record);
    const missing = REQUIRED.filter(key => !nonEmpty(r[key]));
    const errors = [];
    if (!DEFINITIONS[r.dataset_id]) errors.push("unknown_dataset_id");
    if (r.forecast_horizon !== null && (!Number.isInteger(r.forecast_horizon) || r.forecast_horizon < 1)) errors.push("invalid_forecast_horizon");
    if (r.training_window !== null && (!Number.isInteger(r.training_window) || r.training_window < 1)) errors.push("invalid_training_window");
    if (r.selected_digit !== null && !validDigit(r.selected_digit)) errors.push("invalid_selected_digit");
    if (r.observed_digit !== null && !validDigit(r.observed_digit)) errors.push("invalid_observed_digit");
    if (r.forecast_origin_tick_id && r.target_tick_id && r.forecast_origin_tick_id === r.target_tick_id) errors.push("origin_equals_target");
    if (r.scored_at_utc && Number.isNaN(Date.parse(r.scored_at_utc))) errors.push("invalid_scored_at_utc");
    return { valid: missing.length === 0 && errors.length === 0, missing, errors, record: r,
      status: missing.length || errors.length ? "LEGACY — PROVENANCE INCOMPLETE" : "PROVENANCE COMPLETE" };
  }

  function compatibility(a, b) {
    const left = DEFINITIONS[a], right = DEFINITIONS[b];
    if (!left || !right) return { compatible: false, status: "INVALID", reasons: ["unknown_dataset"] };
    if (a === "DS-08" || b === "DS-08") return {
      compatible: false, status: "VIEW — NOT AN INDEPENDENT DATASET",
      reasons: ["DS-08 is a chronological evaluation view of DS-06, not a new outcome stream."]
    };
    if (a !== b) return { compatible: false, status: "NOT COMPARABLE BY DEFAULT",
      reasons: ["Different dataset identities/methodologies; record-level compatibility must be established first."] };
    return { compatible: true, status: "SAME DATASET DEFINITION",
      reasons: ["Still verify market, contract, model, horizon, training window, and target-tick overlap."] };
  }

  function audit(records) {
    const list = Array.isArray(records) ? records : [];
    const seen = new Set(), targets = new Map();
    let duplicates = 0, targetReuse = 0, incomplete = 0;
    const byDataset = {};
    list.forEach(item => {
      const result = validate(item);
      const r = result.record;
      byDataset[r.dataset_id] = (byDataset[r.dataset_id] || 0) + 1;
      if (!result.valid) incomplete++;
      const key = [r.dataset_id, r.market, r.contract, r.model_id, r.forecast_origin_tick_id, r.target_tick_id].join("|");
      if (nonEmpty(r.forecast_origin_tick_id) && nonEmpty(r.target_tick_id)) {
        if (seen.has(key)) duplicates++;
        seen.add(key);
      }
      if (nonEmpty(r.target_tick_id)) {
        const targetKey = r.market + "|" + r.target_tick_id;
        const prior = targets.get(targetKey) || new Set();
        if (prior.size && !prior.has(r.dataset_id + "|" + r.model_id)) targetReuse++;
        prior.add(r.dataset_id + "|" + r.model_id);
        targets.set(targetKey, prior);
      }
    });
    return { records: list.length, incomplete, duplicates, targetReuse, byDataset,
      status: incomplete || duplicates ? "INVALID — PERFORMANCE COMPARISON DISABLED" : "METADATA CHECKS PASSED — COMPATIBILITY STILL REQUIRED" };
  }

  return Object.freeze({ VERSION, DEFINITIONS, REQUIRED, createProvenance, validate, compatibility, audit });
});

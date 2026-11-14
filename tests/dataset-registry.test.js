const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../public/dataset-registry.js");

test("registry exposes permanent dataset definitions", () => {
  assert.deepEqual(Object.keys(registry.DEFINITIONS), ["DS-01","DS-02","DS-03","DS-04","DS-05","DS-06","DS-07","DS-08"]);
  assert.equal(registry.DEFINITIONS["DS-08"].derivedFrom, "DS-06");
});

test("legacy records remain incomplete when tick provenance is absent", () => {
  const result = registry.validate({ dataset_id: "DS-05", market: "R_100", hit: true });
  assert.equal(result.valid, false);
  assert.equal(result.status, "LEGACY — PROVENANCE INCOMPLETE");
  assert.ok(result.missing.includes("target_tick_id"));
});

test("complete record validates without fabricating identifiers", () => {
  const result = registry.validate({
    dataset_id:"DS-05", methodology_version:"1.0.0", market:"R_100", contract:"MATCH",
    model_id:"coldest-v1", selected_digit:4, forecast_origin_tick_id:"tick-10",
    target_tick_id:"tick-13", training_window:100, forecast_horizon:3,
    observed_digit:4, hit:true, scored_at_utc:"2026-11-14T10:00:00Z"
  });
  assert.equal(result.valid, true);
});

test("DS-08 is never represented as an independent comparable stream", () => {
  assert.equal(registry.compatibility("DS-06","DS-08").compatible, false);
  assert.match(registry.compatibility("DS-06","DS-08").status, /NOT AN INDEPENDENT/);
});

test("audit detects duplicate forecast keys and shared targets", () => {
  const base = { dataset_id:"DS-05", methodology_version:"1", market:"R_100", contract:"MATCH",
    model_id:"m1", forecast_origin_tick_id:"o1", target_tick_id:"t4", training_window:100,
    forecast_horizon:3, observed_digit:2, hit:false, scored_at_utc:"2026-11-14T10:00:00Z" };
  const other = {...base, dataset_id:"DS-07", model_id:"m2", forecast_origin_tick_id:"o2"};
  const result = registry.audit([base, base, other]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.targetReuse, 1);
});

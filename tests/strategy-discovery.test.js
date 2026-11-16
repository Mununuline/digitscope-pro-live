"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverStrategies } = require("../strategy-discovery");

test("waits for sufficient sequential market history", () => {
  const result = discoverStrategies({ market: "R_75", digits: Array(100).fill(3) });
  assert.equal(result.status, "WAIT");
  assert.equal(result.candidates.length, 0);
});

test("generates versioned candidate strategies without granting trade eligibility", () => {
  const digits = Array.from({ length: 600 }, (_, i) => (i * 7 + Math.floor(i / 11)) % 10);
  const result = discoverStrategies({ market: "R_75", digits });
  assert.equal(result.status, "RESEARCH_ONLY");
  assert.equal(result.candidates.length, 7);
  assert.equal(result.tradeEligible, false);
  assert.equal(result.decision, "WAIT");
  assert.ok(result.candidates.every(x => x.id && x.trials > 0 && x.status === "EXPLORATORY_CANDIDATE"));
  assert.match(result.execution, /DISABLED/);
});

test("rejects unsupported markets and invalid digits", () => {
  assert.throws(() => discoverStrategies({ market: "UNKNOWN", digits: Array(400).fill(1) }), /Unsupported market/);
  assert.throws(() => discoverStrategies({ market: "R_50", digits: [...Array(300).fill(1), 10] }), /valid last digits/);
});

test("walk-forward candidate results never claim certainty", () => {
  const result = discoverStrategies({ market: "R_10", digits: Array(500).fill(4) });
  assert.equal(result.tradeEligible, false);
  assert.equal(result.decision, "WAIT");
  assert.ok(result.candidates.every(x => x.hitRate <= 1 && x.wilsonLowerBound <= x.hitRate));
});

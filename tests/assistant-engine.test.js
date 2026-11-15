"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAssistant, wilsonLowerBound } = require("../assistant-engine");

const qualified = {
  market:"R_100", contract:"MATCHES", tickCount:1000, signalQualified:true,
  latencyMs:80, validationTrials:100, validationWins:80,
  totalPayout:8.5, estimatedChance:0.25
};

test("assistant allows TRADE only when every evidence and payout gate passes", () => {
  const result=evaluateAssistant(qualified);
  assert.equal(result.decision,"TRADE");
  assert.ok(result.validationLowerBound>result.breakEvenProbability);
  assert.match(result.execution,/DISABLED/);
});

test("assistant returns WAIT when out-of-sample evidence or quote is missing", () => {
  const result=evaluateAssistant({...qualified,validationTrials:12,totalPayout:null});
  assert.equal(result.decision,"WAIT");
  assert.ok(result.reasons.some(x=>x.includes("100 independent")));
  assert.ok(result.reasons.some(x=>x.includes("payout quote")));
});

test("assistant blocks a candidate when latency exceeds the safety ceiling", () => {
  const result=evaluateAssistant({...qualified,latencyMs:400});
  assert.equal(result.decision,"NO TRADE");
  assert.ok(result.reasons.some(x=>x.includes("latency")));
});

test("assistant blocks a candidate when the confidence bound does not clear break-even", () => {
  const result=evaluateAssistant({...qualified,validationWins:12,estimatedChance:0.25});
  assert.equal(result.decision,"NO TRADE");
  assert.ok(result.reasons.some(x=>x.includes("Wilson lower bound")));
});

test("assistant rejects unsupported markets and invalid outcome counts", () => {
  const result=evaluateAssistant({...qualified,market:"UNKNOWN",validationWins:101});
  assert.equal(result.decision,"NO TRADE");
  assert.ok(result.reasons.some(x=>x.includes("unsupported market")));
  assert.ok(result.reasons.some(x=>x.includes("outcome counts are invalid")));
});

test("Wilson lower bound stays below the observed rate and above zero", () => {
  const lower=wilsonLowerBound(80,100);
  assert.ok(lower>0 && lower<0.8);
});

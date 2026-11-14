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
    model_id:"coldest-v1", selected_digit:4, tick_identity_version:"session-v1",
    forecast_origin_tick_id:"R_100:session-a:10", target_tick_id:"R_100:session-a:13",
    training_window:100, forecast_horizon:3,
    observed_digit:4, hit:true, scored_at_utc:"2026-11-14T10:00:00Z"
  });
  assert.equal(result.valid, true);
});

test("legacy counter-only tick IDs are not treated as globally unique provenance", () => {
  const result = registry.validate({
    dataset_id:"DS-05", methodology_version:"1.0.0", market:"R_100", contract:"MATCH",
    model_id:"coldest-v1", selected_digit:4, forecast_origin_tick_id:"R_100:10",
    target_tick_id:"R_100:13", training_window:100, forecast_horizon:3,
    observed_digit:4, hit:true, scored_at_utc:"2026-11-14T10:00:00Z"
  });
  assert.equal(result.valid,false);
  assert.ok(result.missing.includes("tick_identity_version"));
});

test("session-scoped tick IDs must share a session and match the forecast horizon", () => {
  const base = {dataset_id:"DS-07",methodology_version:"1.0.0",tick_identity_version:"session-v1",
    market:"R_100",contract:"DIGIT_MATCH",model_id:"m",selected_digit:4,
    forecast_origin_tick_id:"R_100:session-a:10",target_tick_id:"R_100:session-a:13",
    training_window:100,forecast_horizon:3,observed_digit:4,hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"};
  assert.equal(registry.validate(base).valid,true);
  assert.ok(registry.validate({...base,target_tick_id:"R_100:session-b:13"}).errors.includes("cross_session_forecast"));
  assert.ok(registry.validate({...base,target_tick_id:"R_100:session-a:14"}).errors.includes("tick_sequence_horizon_mismatch"));
});

test("DS-08 is never represented as an independent comparable stream", () => {
  assert.equal(registry.compatibility("DS-06","DS-08").compatible, false);
  assert.match(registry.compatibility("DS-06","DS-08").status, /NOT AN INDEPENDENT/);
});

test("audit detects duplicate forecast keys and shared targets", () => {
  const base = { dataset_id:"DS-05", methodology_version:"1", market:"R_100", contract:"MATCH",
    model_id:"m1", forecast_origin_tick_id:"R_100:session-a:1", target_tick_id:"R_100:session-a:4", training_window:100,
    forecast_horizon:3, observed_digit:2, hit:false, scored_at_utc:"2026-11-14T10:00:00Z" };
  const other = {...base, dataset_id:"DS-07", model_id:"m2", forecast_origin_tick_id:"o2"};
  const result = registry.audit([base, base, other]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.targetReuse, 1);
});

test("sample comparison requires identical methodology and disjoint target ticks", () => {
  const make = (target, training_window = 100) => ({
    dataset_id:"DS-05", methodology_version:"1.0.0", market:"R_100", contract:"MATCH",
    model_id:"coldest-v1", selected_digit:4, tick_identity_version:"session-v1",
    forecast_origin_tick_id:"R_100:"+target+":10", target_tick_id:"R_100:"+target+":13",
    training_window, forecast_horizon:3, observed_digit:4,
    hit:true, scored_at_utc:"2026-11-14T10:00:00Z"
  });
  assert.equal(registry.compareSamples([make("t1")],[make("t2")]).compatible, true);
  const mismatch = registry.compareSamples([make("t1")],[make("t2",250)]);
  assert.equal(mismatch.compatible, false);
  assert.match(mismatch.status, /COMPARISON DISABLED/);
});

test("sample comparison blocks shared target ticks", () => {
  const make = target => ({
    dataset_id:"DS-05", methodology_version:"1.0.0", market:"R_100", contract:"MATCH",
    model_id:"coldest-v1", tick_identity_version:"session-v1",
    forecast_origin_tick_id:"R_100:shared-session:10", target_tick_id:"R_100:shared-session:13",
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  const result = registry.compareSamples([make("same-target")],[make("same-target")]);
  assert.equal(result.compatible, false);
  assert.equal(result.uniqueTargetOverlap, 1);
});


test("persistent audit reads legacy and complete records without mutating storage", () => {
  const complete = {
    dataset_id:"DS-07", methodology_version:"1.0.0", tick_identity_version:"session-v1",
    market:"R_100", contract:"DIGIT_MATCH", model_id:"rolling-most-frequent-v1", selected_digit:4,
    forecast_origin_tick_id:"R_100:session-a:1", target_tick_id:"R_100:session-a:4",
    training_window:100, forecast_horizon:3, observed_digit:4,
    hit:true, scored_at_utc:"2026-11-14T10:00:00Z"
  };
  const legacy = { hit:true, target:4, actual:4 };
  const saved = {
    "digitscopePro.matchDecision.v1": JSON.stringify({version:1,markets:{R_100:{match:[
      {...complete,dataset_id:"DS-05",hit:1,contract:"MATCH",model_id:"coldest-digit-v1"},
      legacy
    ],differs:[]}}}),
    "digitscopePro.rollingValidation.v1": JSON.stringify({version:1,markets:{R_100:{outcomes:[legacy]}}}),
    "digitscopePro.statisticalReliability.v1": JSON.stringify({version:1,markets:{R_100:{outcomes:[complete]}}})
  };
  const before = JSON.stringify(saved);
  const storage = { getItem(key) { return Object.prototype.hasOwnProperty.call(saved,key) ? saved[key] : null; } };
  const result = registry.auditPersistentStorage(storage);
  assert.equal(result.available,true);
  assert.equal(result.streams[0].storedRecords,2);
  assert.equal(result.streams[0].provenanceComplete,1);
  assert.equal(result.streams[0].legacyIncomplete,1);
  assert.equal(result.streams[2].provenanceComplete,1);
  assert.equal(JSON.stringify(saved),before);
});

test("persistent audit reports malformed JSON and absent storage keys", () => {
  const storage = { getItem(key) {
    if(key==="digitscopePro.matchDecision.v1") return "{broken";
    return null;
  }};
  const result=registry.auditPersistentStorage(storage);
  assert.equal(result.streams[0].storage_status,"MALFORMED JSON");
  assert.equal(result.streams[0].malformed,1);
  assert.equal(result.streams[1].storage_status,"KEY ABSENT");
  assert.equal(result.streams[2].storage_status,"KEY ABSENT");
});

test("persistent audit distinguishes unavailable storage", () => {
  const result=registry.auditPersistentStorage({getItem(){throw new Error("blocked");}});
  assert.equal(result.available,false);
  assert.equal(result.status,"STORAGE READ FAILED");
});

test("persistent audit counts malformed record entries and repeated target keys", () => {
  const row = {dataset_id:"DS-07",methodology_version:"1",market:"R_100",contract:"DIGIT_MATCH",
    model_id:"m",forecast_origin_tick_id:"o",target_tick_id:"t",training_window:100,forecast_horizon:3,
    observed_digit:2,hit:true,scored_at_utc:"2026-11-14T10:00:00Z"};
  const storage={getItem(key){
    if(key==="digitscopePro.statisticalReliability.v1")
      return JSON.stringify({version:1,markets:{R_100:{outcomes:[row,row,null]}}});
    return null;
  }};
  const result=registry.auditPersistentStorage(storage);
  const stream=result.streams.find(x=>x.dataset_id==="DS-07");
  assert.equal(stream.storedRecords,3);
  assert.equal(stream.provenanceComplete,0);
  assert.equal(stream.legacyIncomplete,2);
  assert.equal(stream.malformed,1);
  assert.equal(stream.duplicates,1);
  assert.equal(stream.duplicateGroups,1);
  assert.equal(stream.identicalDuplicateExcessRecords,1);
  assert.equal(stream.conflictingDuplicateExcessRecords,0);
  assert.equal(stream.repeatedTargetGroups,0);
  assert.equal(stream.uniqueTargets,1);
});

test("persistent audit separates conflicting duplicate keys from repeated targets", () => {
  const base={dataset_id:"DS-07",methodology_version:"1.0.0",market:"R_100",contract:"DIGIT_MATCH",
    model_id:"rolling-most-frequent-v1",selected_digit:4,forecast_origin_tick_id:"origin-1",
    target_tick_id:"target-4",training_window:100,forecast_horizon:3,observed_digit:4,hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"};
  const conflicting={...base,observed_digit:5,hit:false};
  const secondForecast={...base,forecast_origin_tick_id:"origin-2",selected_digit:2};
  const raw=JSON.stringify({version:1,markets:{R_100:{outcomes:[base,conflicting,secondForecast]}}});
  const result=registry.auditPersistentStorage({getItem:key=>
    key==="digitscopePro.statisticalReliability.v1"?raw:null
  });
  const stream=result.streams.find(x=>x.dataset_id==="DS-07");
  assert.equal(stream.duplicates,1);
  assert.equal(stream.duplicateGroups,1);
  assert.equal(stream.identicalDuplicateExcessRecords,0);
  assert.equal(stream.conflictingDuplicateExcessRecords,1);
  assert.equal(stream.repeatedTargetGroups,1);
  assert.equal(stream.repeatedTargetExamples[0].distinctForecastKeys,2);
  assert.equal(stream.duplicateExamples[0].classification,"CONFLICTING_RESULT");
});


test("persistent audit reconciles storage counts with each dashboard loader", () => {
  const make = (dataset_id, contract="DIGIT_MATCH") => ({
    dataset_id, methodology_version:"1.0.0", tick_identity_version:"session-v1",
    market:"R_100", contract, model_id:"m", selected_digit:4,
    forecast_origin_tick_id:"R_100:session-a:1", target_tick_id:"R_100:session-a:4",
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  const saved = {
    "digitscopePro.matchDecision.v1": JSON.stringify({version:1,markets:{R_100:{
      match:[{...make("DS-05","MATCH"),hit:1},{...make("DS-05","MATCH"),hit:0},null],
      differs:[{...make("DS-05","DIFFERS"),hit:1}]
    }}}),
    "digitscopePro.rollingValidation.v1": JSON.stringify({version:1,markets:{R_100:{
      outcomes:[make("DS-06"),{hit:0},{...make("DS-06"),forecast_origin_tick_id:"R_100:session-a:4",target_tick_id:"R_100:session-a:7"}]
    }}}),
    "digitscopePro.statisticalReliability.v1": JSON.stringify({version:1,markets:{R_100:{
      outcomes:[make("DS-07")]
    }}})
  };
  const result=registry.auditPersistentStorage({getItem:key=>saved[key]||null});
  const ds05=result.streams.find(x=>x.dataset_id==="DS-05");
  const ds06=result.streams.find(x=>x.dataset_id==="DS-06");
  const ds07=result.streams.find(x=>x.dataset_id==="DS-07");
  assert.equal(ds05.storedRecords,4);
  assert.equal(ds05.dashboardLoadedRecords,3); // filter(Boolean), then last 5,000 per market/contract
  assert.equal(ds06.storedRecords,3);
  assert.equal(ds06.dashboardLoadedRecords,2); // Boolean hit only, then last 5,000 per market
  assert.equal(ds07.dashboardLoadedRecords,1);
  assert.equal(result.crossStreamTargetOverlap,1);
  assert.equal(result.overlapByPair["DS-05/DS-06"],1);
  assert.equal(result.overlapByPair["DS-05/DS-07"],1);
  assert.equal(result.overlapByPair["DS-06/DS-07"],1);
});


test("persistent audit applies the dashboard's 5,000-outcome per-market retention cap", () => {
  const outcomes=Array.from({length:5003},(_,i)=>({
    dataset_id:"DS-06",methodology_version:"1.0.0",tick_identity_version:"session-v1",
    market:"R_100",contract:"DIGIT_MATCH",model_id:"m",selected_digit:1,
    forecast_origin_tick_id:"R_100:retention-session:"+(i*3+1),
    target_tick_id:"R_100:retention-session:"+(i*3+4),
    training_window:100,forecast_horizon:3,observed_digit:1,hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  }));
  const raw=JSON.stringify({version:1,markets:{R_100:{outcomes}}});
  const result=registry.auditPersistentStorage({getItem:key=>
    key==="digitscopePro.rollingValidation.v1"?raw:null
  });
  const stream=result.streams.find(x=>x.dataset_id==="DS-06");
  assert.equal(stream.storedRecords,5003);
  assert.equal(stream.dashboardLoadedRecords,5000);
  assert.equal(stream.overCapRecords,3);
});


test("DS-02 and DS-03 session-scoped outcome provenance validates", () => {
  for (const dataset_id of ["DS-02", "DS-03"]) {
    const contract = dataset_id === "DS-03" ? "over_4" : "DIGIT_MATCH";
    const result = registry.validate({
      dataset_id, methodology_version:"1.0.0", tick_identity_version:"session-v1",
      market:"1HZ10V", contract, model_id:"rolling-most-frequent-v1",
      selected_digit:4, forecast_origin_tick_id:"1HZ10V:session-a:10",
      target_tick_id:"1HZ10V:session-a:13", training_window:100,
      forecast_horizon:3, observed_digit:4, hit:true,
      scored_at_utc:"2026-11-14T10:00:00Z"
    });
    assert.equal(result.valid, true, dataset_id + " should emit complete session provenance");
  }
});


test("DS-04 replay audit validates each third-tick origin/target pair without accumulating rerenders", () => {
  const rows = [0,1,2].map(i => ({
    dataset_id:"DS-04",methodology_version:"1.0.0",tick_identity_version:"session-v1",
    market:"1HZ10V",contract:"MATCH",model_id:"coldest-digit-replay-v1",selected_digit:4,
    forecast_origin_tick_id:"1HZ10V:session-a:"+(10+i),
    target_tick_id:"1HZ10V:session-a:"+(13+i),training_window:100,forecast_horizon:3,
    observed_digit:4,hit:true,scored_at_utc:"2026-11-14T10:00:00Z"
  }));
  const first=registry.reportReplay(rows);
  assert.equal(first.records,3);
  assert.equal(first.complete,3);
  assert.equal(first.incomplete,0);
  assert.equal(first.duplicates,0);
  const second=registry.reportReplay(rows);
  assert.equal(second.records,3);
  assert.equal(registry.runtimeSnapshot().replay.records,3);
  const invalid=registry.reportReplay([{...rows[0],target_tick_id:"1HZ10V:session-a:14"}]);
  assert.equal(invalid.incomplete,1);
  assert.match(invalid.status,/INVALID/);
});

test("DS-02 and DS-03 runtime summaries remain separated by dataset count unit", () => {
  const make = (dataset_id, contract) => ({
    dataset_id,methodology_version:"1.0.0",tick_identity_version:"session-v1",
    market:"1HZ10V",contract,model_id:"model-a",selected_digit:4,
    forecast_origin_tick_id:"1HZ10V:session-a:10",target_tick_id:"1HZ10V:session-a:13",
    training_window:100,forecast_horizon:3,observed_digit:4,hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  registry.ingest(make("DS-02","DIGIT_MATCH"));
  registry.ingest(make("DS-03","over_4"));
  const snapshot=registry.runtimeSnapshot();
  assert.equal(snapshot.byDataset["DS-02"].records,1);
  assert.equal(snapshot.byDataset["DS-03"].records,1);
  assert.equal(snapshot.byDataset["DS-02"].incomplete,0);
  assert.equal(snapshot.byDataset["DS-03"].incomplete,0);
});


test("persistent audit separates duplicate groups by provenance completeness", () => {
  const complete = {dataset_id:"DS-07",methodology_version:"1.0.0",tick_identity_version:"session-v1",
    market:"R_100",contract:"DIGIT_MATCH",model_id:"rolling-v1",selected_digit:3,
    forecast_origin_tick_id:"R_100:session-a:10",target_tick_id:"R_100:session-a:13",
    training_window:100,forecast_horizon:3,observed_digit:3,hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"};
  const completeConflict={...complete,observed_digit:7,hit:false};
  const legacy={...complete,forecast_origin_tick_id:"R_100:10",target_tick_id:"R_100:13"};
  const legacyConflict={...legacy,observed_digit:8,hit:false};
  const raw=JSON.stringify({version:1,markets:{R_100:{outcomes:[
    complete,completeConflict,legacy,legacyConflict
  ]}}});
  const result=registry.auditPersistentStorage({getItem:key=>
    key==="digitscopePro.statisticalReliability.v1"?raw:null
  });
  const stream=result.streams.find(x=>x.dataset_id==="DS-07");
  assert.equal(stream.provenanceComplete,2);
  assert.equal(stream.legacyIncomplete,2);
  assert.equal(stream.provenanceSplit.complete.duplicateGroups,1);
  assert.equal(stream.provenanceSplit.complete.duplicateExcessRecords,1);
  assert.equal(stream.provenanceSplit.complete.conflictingDuplicateExcessRecords,1);
  assert.equal(stream.provenanceSplit.incomplete.duplicateGroups,1);
  assert.equal(stream.provenanceSplit.incomplete.duplicateExcessRecords,1);
  assert.equal(stream.provenanceSplit.incomplete.conflictingDuplicateExcessRecords,1);
  assert.equal(stream.provenanceSplit.complete.uniqueTargets,1);
  assert.equal(stream.provenanceSplit.incomplete.uniqueTargets,1);
  assert.equal(stream.duplicateGroups,2);
  assert.equal(stream.duplicates,2);
});


test("sample compatibility reports count unit, sampling design and within-sample integrity", () => {
  const make = (target, origin, extra={}) => ({
    dataset_id:"DS-07", methodology_version:"1.0.0", market:"R_100", contract:"DIGIT_MATCH",
    model_id:"rolling-most-frequent-v1", selected_digit:4, tick_identity_version:"session-v1",
    forecast_origin_tick_id:"R_100:session-a:"+origin, target_tick_id:"R_100:session-a:"+target,
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z", ...extra
  });
  const left=[make(13,10),make(16,13)];
  const right=[make(22,19),make(25,22)];
  const result=registry.compareSamples(left,right);
  assert.equal(result.compatible,true);
  assert.equal(result.leftProfile.countUnit,"settled_forecast");
  assert.equal(result.leftProfile.sampling,"every_third_tick");
  assert.equal(result.leftProfile.uniqueTargets,2);
  const duplicate=registry.compareSamples([left[0],left[0]],[right[0]]);
  assert.equal(duplicate.compatible,false);
  assert.ok(duplicate.reasons.some(reason=>reason.includes("Duplicate forecast identity")));
});

test("rolling-overlapping DS-06 samples cannot be labelled independent comparisons", () => {
  const make = (origin, target) => ({
    dataset_id:"DS-06", methodology_version:"1.0.0", market:"R_100", contract:"DIGIT_MATCH",
    model_id:"rolling-most-frequent-v1", selected_digit:4, tick_identity_version:"session-v1",
    forecast_origin_tick_id:"R_100:session-a:"+origin, target_tick_id:"R_100:session-a:"+target,
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  const result=registry.compareSamples([make(10,13)],[make(13,16)]);
  assert.equal(result.compatible,false);
  assert.ok(result.reasons.some(reason=>reason.includes("Rolling-overlapping")));
});


test("every rolling-overlapping dataset design is blocked from independent-sample comparison", () => {
  const cases = [
    ["DS-02","DIGIT_MATCH","rolling-most-frequent-v1"],
    ["DS-03","over_4","empirical-frequency-100-v1"],
    ["DS-04","MATCH","coldest-digit-replay-v1"],
    ["DS-06","DIGIT_MATCH","rolling-most-frequent-v1"]
  ];
  cases.forEach(([dataset_id,contract,model_id]) => {
    const make = (origin,target) => ({
      dataset_id,methodology_version:"1.0.0",market:"R_100",contract,model_id,
      selected_digit:4,tick_identity_version:"session-v1",
      forecast_origin_tick_id:"R_100:session-a:"+origin,
      target_tick_id:"R_100:session-a:"+target,
      training_window:100,forecast_horizon:3,observed_digit:4,hit:true,
      scored_at_utc:"2026-11-14T10:00:00Z"
    });
    const result=registry.compareSamples([make(10,13)],[make(19,22)]);
    assert.equal(result.compatible,false,dataset_id+" must remain blocked");
    assert.ok(result.reasons.some(reason=>reason.includes("Rolling-overlapping")),dataset_id);
  });
});

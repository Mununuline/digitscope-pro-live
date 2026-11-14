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

test("sample comparison requires identical methodology and disjoint target ticks", () => {
  const make = (target, training_window = 100) => ({
    dataset_id:"DS-05", methodology_version:"1.0.0", market:"R_100", contract:"MATCH",
    model_id:"coldest-v1", selected_digit:4, forecast_origin_tick_id:"origin-"+target,
    target_tick_id:target, training_window, forecast_horizon:3, observed_digit:4,
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
    model_id:"coldest-v1", forecast_origin_tick_id:"origin-"+target, target_tick_id:target,
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  const result = registry.compareSamples([make("same-target")],[make("same-target")]);
  assert.equal(result.compatible, false);
  assert.equal(result.uniqueTargetOverlap, 1);
});


test("persistent audit reads legacy and complete records without mutating storage", () => {
  const complete = {
    dataset_id:"DS-07", methodology_version:"1.0.0", market:"R_100", contract:"DIGIT_MATCH",
    model_id:"rolling-most-frequent-v1", selected_digit:4, forecast_origin_tick_id:"o1",
    target_tick_id:"t4", training_window:100, forecast_horizon:3, observed_digit:4,
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
  assert.equal(stream.provenanceComplete,2);
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
    dataset_id, methodology_version:"1.0.0", market:"R_100", contract, model_id:"m",
    selected_digit:4, forecast_origin_tick_id:"origin-1", target_tick_id:"R_100:104",
    training_window:100, forecast_horizon:3, observed_digit:4, hit:true,
    scored_at_utc:"2026-11-14T10:00:00Z"
  });
  const saved = {
    "digitscopePro.matchDecision.v1": JSON.stringify({version:1,markets:{R_100:{
      match:[{...make("DS-05","MATCH"),hit:1},{...make("DS-05","MATCH"),hit:0},null],
      differs:[{...make("DS-05","DIFFERS"),hit:1}]
    }}}),
    "digitscopePro.rollingValidation.v1": JSON.stringify({version:1,markets:{R_100:{
      outcomes:[make("DS-06"),{hit:0},{...make("DS-06"),target_tick_id:"R_100:107"}]
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
    dataset_id:"DS-06",methodology_version:"1.0.0",market:"R_100",contract:"DIGIT_MATCH",
    model_id:"m",selected_digit:1,forecast_origin_tick_id:"o"+i,target_tick_id:"t"+i,
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

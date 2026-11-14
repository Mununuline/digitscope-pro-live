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

  const runtimeRecords = [];
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
      hit: typeof source.hit === "boolean" ? source.hit : (source.hit === 0 || source.hit === 1 ? Boolean(source.hit) : null),
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

  function compareSamples(leftRecords, rightRecords) {
    const left = Array.isArray(leftRecords) ? leftRecords : [];
    const right = Array.isArray(rightRecords) ? rightRecords : [];
    const reasons = [];
    if (!left.length || !right.length) return { compatible:false, status:"INVALID — EMPTY SAMPLE", reasons:["Both samples must contain records."] };
    const all = left.concat(right);
    const checked = all.map(validate);
    if (checked.some(x => !x.valid)) reasons.push("One or more records have incomplete or invalid provenance.");
    const ids = new Set(all.map(x => x.dataset_id));
    if (ids.size !== 1) reasons.push("Dataset identities differ; cross-dataset comparison is disabled by default.");
    if (ids.has("DS-08")) reasons.push("DS-08 is a derived holdout view of DS-06, not an independent dataset.");
    const signature = r => [r.dataset_id,r.methodology_version,r.market,r.contract,r.model_id,r.training_window,r.forecast_horizon].join("|");
    const leftKeys = new Set(left.map(signature)), rightKeys = new Set(right.map(signature));
    if (leftKeys.size !== 1 || rightKeys.size !== 1 || [...leftKeys][0] !== [...rightKeys][0]) {
      reasons.push("Market, contract, model, methodology version, training window, and forecast horizon must match exactly.");
    }
    const targetSet = records => new Set(records.filter(r => nonEmpty(r.market) && nonEmpty(r.target_tick_id)).map(r => r.market + "|" + r.target_tick_id));
    const lt = targetSet(left), rt = targetSet(right);
    let overlap = 0;
    lt.forEach(key => { if (rt.has(key)) overlap++; });
    if (overlap) reasons.push(overlap + " unique market/target ticks occur in both samples; inference must account for dependence.");
    const compatible = reasons.length === 0;
    return { compatible, status: compatible ? "COMPATIBLE SAMPLE DEFINITIONS" : "INVALID — PERFORMANCE COMPARISON DISABLED",
      reasons, leftRecords:left.length, rightRecords:right.length, uniqueTargetOverlap:overlap };
  }

  function ingest(record) {
    const result = validate(record);
    runtimeRecords.push(result.record);
    if (runtimeRecords.length > 20000) runtimeRecords.shift();
    const summary = audit(runtimeRecords);
    if (typeof document !== "undefined") {
      const node = document.getElementById("dspRegistryRuntime");
      if (node) node.textContent = summary.records + " new outcomes observed this page session · " +
        summary.incomplete + " provenance-incomplete · " + summary.duplicates + " duplicate keys · " +
        summary.targetReuse + " reused target-tick comparisons · " + summary.status;
    }
    return result;
  }

  // Read-only audit of the three persistent validation streams. This function
  // never writes to storage, migrates records, or invents missing identifiers.
  const STORAGE_STREAMS = [
    {dataset_id:"DS-05",key:"digitscopePro.matchDecision.v1",maxPerBucket:5000,
      isLoaded:row=>Object.prototype.hasOwnProperty.call(row,"_auditRaw")?Boolean(row._auditRaw):Boolean(row),bucket:row=>row._auditBucket,
      extract:data=>{
        const out=[];Object.keys(data.markets||{}).forEach(symbol=>{
          const market=data.markets[symbol]||{};
          ["match","differs"].forEach(contract=>{
            const rows=market[contract];
            if(Array.isArray(rows))rows.forEach(row=>out.push(row&&typeof row==="object"?{...row,
              dataset_id:row.dataset_id||"DS-05",market:row.market||symbol,
              contract:row.contract||contract.toUpperCase(),_auditBucket:symbol+"|"+contract.toUpperCase()}:
              {_auditRaw:row,_auditBucket:symbol+"|"+contract.toUpperCase()}));
          });
        });return out;
      }},
    {dataset_id:"DS-06",key:"digitscopePro.rollingValidation.v1",maxPerBucket:5000,
      isLoaded:row=>Boolean(row&&typeof row.hit==="boolean"),bucket:row=>row._auditBucket,
      extract:data=>{
        const out=[];Object.keys(data.markets||{}).forEach(symbol=>{
          const rows=data.markets[symbol]&&data.markets[symbol].outcomes;
          if(Array.isArray(rows))rows.forEach(row=>out.push(row&&typeof row==="object"?{...row,
            dataset_id:row.dataset_id||"DS-06",market:row.market||symbol,_auditBucket:symbol}:
            {_auditRaw:row,_auditBucket:symbol}));
        });return out;
      }},
    {dataset_id:"DS-07",key:"digitscopePro.statisticalReliability.v1",maxPerBucket:5000,
      isLoaded:row=>Boolean(row&&typeof row.hit==="boolean"),bucket:row=>row._auditBucket,
      extract:data=>{
        const out=[];Object.keys(data.markets||{}).forEach(symbol=>{
          const rows=data.markets[symbol]&&data.markets[symbol].outcomes;
          if(Array.isArray(rows))rows.forEach(row=>out.push(row&&typeof row==="object"?{...row,
            dataset_id:row.dataset_id||"DS-07",market:row.market||symbol,_auditBucket:symbol}:
            {_auditRaw:row,_auditBucket:symbol}));
        });return out;
      }}
  ];

  function auditPersistentStorage(storage) {
    let source=storage || null;
    if(!source) {
      try { if(typeof localStorage!=="undefined") source=localStorage; }
      catch (_) { return {available:false,status:"STORAGE ACCESS BLOCKED",streams:[],crossStreamTargetOverlap:0}; }
    }
    if(!source) return {available:false,status:"STORAGE UNAVAILABLE",streams:[],crossStreamTargetOverlap:0};
    const streams=[], all=[];
    for(const stream of STORAGE_STREAMS) {
      let raw;
      try { raw=source.getItem(stream.key); }
      catch (_) { return {available:false,status:"STORAGE READ FAILED",streams:[],crossStreamTargetOverlap:0}; }
      if(raw===null) {
        streams.push({dataset_id:stream.dataset_id,key:stream.key,storage_status:"KEY ABSENT",storedRecords:0,
          provenanceComplete:0,legacyIncomplete:0,malformed:0,uniqueTargets:0,duplicates:0});
        continue;
      }
      let parsed;
      try { parsed=JSON.parse(raw); }
      catch (_) {
        streams.push({dataset_id:stream.dataset_id,key:stream.key,storage_status:"MALFORMED JSON",storedRecords:0,
          provenanceComplete:0,legacyIncomplete:0,malformed:1,uniqueTargets:0,duplicates:0});
        continue;
      }
      if(!parsed || parsed.version!==1 || !parsed.markets || typeof parsed.markets!=="object") {
        streams.push({dataset_id:stream.dataset_id,key:stream.key,storage_status:"UNRECOGNIZED SCHEMA",storedRecords:0,
          provenanceComplete:0,legacyIncomplete:0,malformed:1,uniqueTargets:0,duplicates:0});
        continue;
      }
      let rows;
      try { rows=stream.extract(parsed); } catch (_) { rows=[]; }
      let complete=0,incomplete=0,malformed=0,duplicates=0,loadedEligible=0,loadedRecords=0;
      const seen=new Map(),targets=new Set(),targetForecastKeys=new Map(),bucketCounts=new Map(),bucketLoaded=new Map();
      const duplicateExamples=[];
      let duplicateGroups=0,identicalDuplicateExcessRecords=0,conflictingDuplicateExcessRecords=0;
      rows.forEach(row=>{
        const bucket=stream.bucket(row)||"unknown";
        bucketCounts.set(bucket,(bucketCounts.get(bucket)||0)+1);
        if(stream.isLoaded(row)){
          loadedEligible++;
          const used=bucketLoaded.get(bucket)||0;
          if(used<stream.maxPerBucket){bucketLoaded.set(bucket,used+1);loadedRecords++;}
        }
        if(!row||typeof row!=="object"||Array.isArray(row)||Object.prototype.hasOwnProperty.call(row,"_auditRaw")){
          malformed++;return;
        }
        const v=validate(row);
        if(v.valid)complete++;else incomplete++;
        const key=[row.market||"",row.contract||"",row.model_id||"",row.forecast_origin_tick_id||"",row.target_tick_id||""].join("|");
        if(nonEmpty(row.forecast_origin_tick_id)&&nonEmpty(row.target_tick_id)){
          const resultSignature=JSON.stringify([row.methodology_version||"",row.training_window??null,
            row.forecast_horizon??null,row.selected_digit??null,row.observed_digit??null,row.hit??null]);
          const prior=seen.get(key)||{count:0,resultSignatures:new Set(),ids:[]};
          if(prior.count>0){
            duplicates++;
            prior.resultSignatures.add(resultSignature);
            if(prior.count===1)duplicateGroups++;
            if(prior.resultSignatures.size>1)conflictingDuplicateExcessRecords++;
            else identicalDuplicateExcessRecords++;
            if(duplicateExamples.length<5)duplicateExamples.push({
              market:row.market||"",contract:row.contract||"",model_id:row.model_id||"",
              forecast_origin_tick_id:row.forecast_origin_tick_id,target_tick_id:row.target_tick_id,
              occurrences:prior.count+1,classification:prior.resultSignatures.size>1?"CONFLICTING_RESULT":"SAME_RESULT",
              record_id:row.id??null
            });
          } else prior.resultSignatures.add(resultSignature);
          prior.count++;
          if(row.id!==undefined&&prior.ids.length<5)prior.ids.push(row.id);
          seen.set(key,prior);
          const targetKey=(row.market||"")+"|"+row.target_tick_id;
          const forecasts=targetForecastKeys.get(targetKey)||new Set();
          forecasts.add(key);targetForecastKeys.set(targetKey,forecasts);
        }
        if(nonEmpty(row.market)&&nonEmpty(row.target_tick_id))targets.add(row.market+"|"+row.target_tick_id);
        all.push({dataset_id:stream.dataset_id,market:row.market||"",target_tick_id:row.target_tick_id||null});
      });
      const repeatedTargetGroups=[...targetForecastKeys.entries()].filter(entry=>entry[1].size>1);
      const marketBreakdown=[...bucketCounts.entries()].map(entry=>({
        bucket:entry[0],storedRecords:entry[1],loadedRecords:Math.min(entry[1],stream.maxPerBucket)
      }));
      streams.push({dataset_id:stream.dataset_id,key:stream.key,storage_status:"READ ONLY · PARSED",
        storedRecords:rows.length,provenanceComplete:complete,legacyIncomplete:incomplete,
        malformed,uniqueTargets:targets.size,duplicates,duplicateGroups,
        identicalDuplicateExcessRecords,conflictingDuplicateExcessRecords,duplicateExamples,
        repeatedTargetGroups:repeatedTargetGroups.length,
        repeatedTargetExamples:repeatedTargetGroups.slice(0,5).map(entry=>({market_target:entry[0],distinctForecastKeys:entry[1].size})),
        loadedEligibleRecords:loadedEligible,dashboardLoadedRecords:loadedRecords,
        excludedFromDashboard:rows.length-loadedRecords,overCapRecords:loadedEligible-loadedRecords,marketBreakdown});

    }
    const targetSets=new Map();
    all.forEach(row=>{
      if(!row.target_tick_id)return;
      const k=row.market+"|"+row.target_tick_id;
      const s=targetSets.get(k)||new Set(); s.add(row.dataset_id); targetSets.set(k,s);
    });
    const crossStreamTargetOverlap=[...targetSets.values()].filter(s=>s.size>1).length;
    const overlapByPair={"DS-05/DS-06":0,"DS-05/DS-07":0,"DS-06/DS-07":0};
    targetSets.forEach(ids=>{
      [["DS-05","DS-06"],["DS-05","DS-07"],["DS-06","DS-07"]].forEach(pair=>{
        if(ids.has(pair[0])&&ids.has(pair[1]))overlapByPair[pair[0]+"/"+pair[1]]++;
      });
    });
    return {available:true,status:"READ ONLY — NO DATA CHANGED",streams,crossStreamTargetOverlap,overlapByPair};
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


  if (typeof document !== "undefined") {
    const installPanel = () => {
      if (document.getElementById("dspDataIntegrity")) return;
      const main = document.querySelector("main");
      if (!main) return;
      const panel = document.createElement("section");
      panel.id = "dspDataIntegrity";
      panel.style.cssText = "margin:14px 0;padding:18px;background:#101d2d;border:1px solid #76552b;border-radius:14px;color:#eaf2fb";
      const rows = Object.entries(DEFINITIONS).map(([id, d]) =>
        "<tr><td>"+id+"</td><td>"+d.name+"</td><td>"+d.unit+"</td><td>"+d.sampling+"</td><td>"+(d.derivedFrom || "—")+"</td></tr>"
      ).join("");
      panel.innerHTML = '<p style="font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800">DATA INTEGRITY · VALIDATION SEPARATION</p>' +
        '<h2 style="font-size:19px;margin:4px 0 8px">Dataset Registry &amp; Provenance Control</h2>' +
        '<p style="font-size:12px;color:#ffc477;margin:8px 0">INTEGRATION IN PROGRESS — PERFORMANCE COMPARISON DISABLED until each stream emits and reconciles complete provenance.</p>' +
        '<p style="font-size:11px;color:#9db0c4;margin:8px 0">Registry definitions are installed. Existing stored outcomes are preserved and are not upgraded with invented tick IDs. Legacy records without origin/target IDs remain labelled provenance-incomplete.</p>' +
        '<div style="overflow-x:auto"><table style="width:100%;min-width:720px;border-collapse:collapse;font-size:11px"><thead><tr><th align="left">ID</th><th align="left">Dataset</th><th align="left">Count unit</th><th align="left">Sampling design</th><th align="left">Relationship</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button id="dspPersistentAuditBtn" type="button" style="margin-top:12px;padding:9px 12px;background:#18344a;border:1px solid #426078;border-radius:8px;color:#eaf2fb">Run read-only saved-data audit</button><p id="dspPersistentAudit" style="font-size:11px;color:#9db0c4;margin:8px 0 0">Saved browser records have not been inspected. This audit only reads existing storage.</p><p id="dspRegistryRuntime" style="font-size:11px;color:#ffc477;margin:10px 0 0">No runtime outcomes registered yet. Existing persisted records are not included in this page-session audit.</p><p style="font-size:11px;color:#9db0c4;margin:10px 0 0">DS-08 is a chronological evaluation view of DS-06, not an independent sample. Counts from model evaluations, forecasts, settled outcomes, raw ticks and unique target ticks must never be added or compared as if they were the same unit.</p>';
      const auditButton=panel.querySelector("#dspPersistentAuditBtn");
      if(auditButton) auditButton.addEventListener("click",()=>{
        const result=auditPersistentStorage();
        const output=panel.querySelector("#dspPersistentAudit");
        if(!result.available){output.textContent=result.status;return;}
        output.style.whiteSpace="pre-line";
        output.textContent=result.streams.map(s=>{
          const buckets=(s.marketBreakdown||[]).map(x=>x.bucket+" stored="+x.storedRecords+" loaded="+x.loadedRecords).join("; ");
          return s.dataset_id+" · "+s.storage_status+" · stored="+s.storedRecords+
            " · complete="+s.provenanceComplete+" · legacy/incomplete="+s.legacyIncomplete+" · malformed="+s.malformed+
            " · dashboard-loaded="+s.dashboardLoadedRecords+" · excluded="+s.excludedFromDashboard+
            " · over-cap="+s.overCapRecords+" · unique targets="+s.uniqueTargets+" · duplicate keys="+s.duplicates+
            (buckets?"\n  By market/contract: "+buckets:"");
        }).join("\n")+
          "\nCross-stream shared market/target ticks: "+result.crossStreamTargetOverlap+
          " · "+Object.entries(result.overlapByPair||{}).map(x=>x[0]+": "+x[1]).join(" · ")+
          "\n"+result.status;
      });
      const hero = main.querySelector(".hero");
      if (hero) hero.insertAdjacentElement("afterend", panel);
      else main.prepend(panel);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPanel, { once: true });
    else installPanel();
    if (typeof MutationObserver !== "undefined" && document.body) {
      const observer = new MutationObserver(() => {
        if (document.querySelector("main") && !document.getElementById("dspDataIntegrity")) {
          installPanel();
          if (document.getElementById("dspDataIntegrity")) observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 15000);
    }
  }

  return Object.freeze({ VERSION, DEFINITIONS, REQUIRED, createProvenance, validate, compatibility, compareSamples, audit, auditPersistentStorage, ingest, runtimeRecords });
});

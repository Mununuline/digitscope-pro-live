(() => {
  "use strict";

  // Persistent, independent rolling view of the same 100-tick / third-next-tick
  // validation protocol used by Signal Validation & Performance.
  const STORAGE_KEY = "digitscopePro.rollingValidation.v1";
  const LOOKBACK = 100;
  const HORIZON = 3;
  const BASELINE = 0.10;
  const MAX_OUTCOMES_PER_MARKET = 5000;
  const WINDOW_SIZES = [100, 250, 500];

  const memory = { version: 1, nextId: 1, markets: Object.create(null) };
  let storageAvailable = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.markets) return;
      memory.nextId = Number(parsed.nextId) || 1;
      Object.keys(parsed.markets).forEach(symbol => {
        const item = parsed.markets[symbol];
        if (!item || !Array.isArray(item.outcomes)) return;
        const outcomes = item.outcomes.filter(x => x && typeof x.hit === "boolean")
          .slice(-MAX_OUTCOMES_PER_MARKET);
        // Migrate pre-ID records in their stored per-market order. Their exact
        // cross-market chronology cannot be recovered because older records
        // did not persist a global sequence ID.
        outcomes.forEach(outcome => {
          if (!Number.isSafeInteger(outcome.id) || outcome.id < 1) outcome.id = memory.nextId++;
          else memory.nextId = Math.max(memory.nextId, outcome.id + 1);
        });
        memory.markets[symbol] = {
          symbol,
          name: String(item.name || symbol),
          outcomes,
          seq: Number(item.seq) || 0,
          lastTotalTicks: Number(item.lastTotalTicks) || 0,
          digits: Array.isArray(item.digits) ? item.digits.slice(-LOOKBACK) : [],
          pending: Array.isArray(item.pending) ? item.pending : [],
          awaitingSnapshot: false
        };
      });
    } catch (_) {
      storageAvailable = false;
    }
  }

  function save() {
    if (!storageAvailable) return;
    try {
      const markets = {};
      Object.keys(memory.markets).forEach(symbol => {
        const r = memory.markets[symbol];
        markets[symbol] = {
          name: r.name,
          outcomes: r.outcomes.slice(-MAX_OUTCOMES_PER_MARKET),
          seq: r.seq,
          lastTotalTicks: r.lastTotalTicks,
          digits: r.digits.slice(-LOOKBACK),
          pending: r.pending
        };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, nextId: memory.nextId, markets }));
    } catch (_) {
      storageAvailable = false;
    }
  }

  function recordFor(symbol, name) {
    return memory.markets[symbol] || (memory.markets[symbol] = {
      symbol,
      name: String(name || symbol),
      outcomes: [],
      seq: 0,
      lastTotalTicks: 0,
      digits: [],
      pending: [],
      awaitingSnapshot: false
    });
  }

  function scoreDigit(record, digit, epoch) {
    record.seq += 1;
    const stillPending = [];
    record.pending.forEach(forecast => {
      if (forecast.dueAt > record.seq) {
        stillPending.push(forecast);
      } else {
        record.outcomes.push({
          id: memory.nextId++,
          hit: digit === forecast.target,
          epoch: Number(epoch) || 0
        });
        if (record.outcomes.length > MAX_OUTCOMES_PER_MARKET) {
          record.outcomes.shift();
        }
      }
    });
    record.pending = stillPending;

    record.digits.push(digit);
    if (record.digits.length > LOOKBACK) record.digits.shift();

    if (record.digits.length === LOOKBACK) {
      const counts = Array(10).fill(0);
      record.digits.forEach(value => { counts[value] += 1; });
      const target = counts.indexOf(Math.max(...counts));
      record.pending.push({ target, dueAt: record.seq + HORIZON });
    }
  }

  function onTick(event) {
    const data = event.detail || {};
    const symbol = String(data.symbol || "");
    const digit = Number(data.digit);
    const totalTicks = Number(data.totalTicks);
    if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9 ||
        !Number.isSafeInteger(totalTicks) || totalTicks < 1) return;

    const record = recordFor(symbol, data.name);
    record.name = String(data.name || record.name || symbol);

    // The scanner's sequence counter restarts after a page refresh. Preserve
    // scored history, but wait for its first snapshot to restore a fresh
    // training window; do not score the restart as if it were continuous.
    if (!record.awaitingSnapshot && record.lastTotalTicks > 0 &&
        totalTicks <= record.lastTotalTicks) {
      record.seq = 0;
      record.lastTotalTicks = 0;
      record.digits = [];
      record.pending = [];
      record.awaitingSnapshot = true;
      save();
      return;
    }
    if (record.awaitingSnapshot) return;
    if (totalTicks <= record.lastTotalTicks) return;
    if (record.lastTotalTicks && totalTicks !== record.lastTotalTicks + 1) {
      record.awaitingSnapshot = true;
      return;
    }

    scoreDigit(record, digit, data.epoch);
    record.lastTotalTicks = totalTicks;
    save();
    render();
  }

  function onSnapshot(event) {
    const rows = event.detail && Array.isArray(event.detail.rows)
      ? event.detail.rows : [];
    let changed = false;
    rows.forEach(row => {
      const symbol = String(row.symbol || "");
      const digits = Array.isArray(row.digits) ? row.digits.map(Number) : [];
      const totalTicks = Number(row.totalTicks);
      if (!symbol || !Number.isSafeInteger(totalTicks) || totalTicks < 1 ||
          !digits.length || digits.some(d => !Number.isInteger(d) || d < 0 || d > 9)) return;

      const record = recordFor(symbol, row.name);
      record.name = String(row.name || record.name || symbol);

      if (record.awaitingSnapshot || record.lastTotalTicks === 0) {
        record.digits = digits.slice(-LOOKBACK);
        record.seq = totalTicks;
        record.lastTotalTicks = totalTicks;
        record.pending = [];
        record.awaitingSnapshot = false;
        changed = true;
        return;
      }

      const gap = totalTicks - record.lastTotalTicks;
      if (gap <= 0) return;
      if (gap > digits.length) {
        // A gap larger than retained history cannot be reconstructed safely.
        // Restart training but keep every previously scored outcome.
        record.digits = digits.slice(-LOOKBACK);
        record.seq = totalTicks;
        record.lastTotalTicks = totalTicks;
        record.pending = [];
        changed = true;
        return;
      }

      digits.slice(-gap).forEach(digit => scoreDigit(record, digit, 0));
      record.lastTotalTicks = totalTicks;
      changed = true;
    });
    if (changed) {
      save();
      render();
    }
  }

  function wilson(hits, tested) {
    if (!tested) return null;
    const z = 1.96, p = hits / tested, z2 = z * z;
    const den = 1 + z2 / tested;
    const center = (p + z2 / (2 * tested)) / den;
    const margin = z * Math.sqrt(p * (1 - p) / tested + z2 / (4 * tested * tested)) / den;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  function summary(records, limit) {
    const outcomes = records.flatMap(record => record.outcomes)
      .sort((a, b) => (a.id || 0) - (b.id || 0));
    const sample = limit ? outcomes.slice(-limit) : outcomes;
    const hits = sample.reduce((sum, outcome) => sum + (outcome.hit ? 1 : 0), 0);
    const tested = sample.length;
    return { hits, tested, rate: tested ? hits / tested : null, interval: wilson(hits, tested) };
  }

  function formatRate(rate) {
    return rate === null ? "—" : (100 * rate).toFixed(1) + "%";
  }

  function formatDelta(rate) {
    if (rate === null) return "—";
    const delta = (rate - BASELINE) * 100;
    return (delta >= 0 ? "+" : "") + delta.toFixed(1) + " pp";
  }

  function safe(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function install() {
    const panel = document.createElement("section");
    panel.id = "dspRollingPerformance";
    panel.innerHTML = `
      <style>
        #dspRollingPerformance{margin:14px 0;padding:20px;background:#101d2d;border:1px solid #203249;border-radius:16px;color:#eaf2fb}
        #dspRollingPerformance h2{font-size:19px;margin:0}
        #dspRollingPerformance .dr-kicker{color:#52d6df;font-size:10px;letter-spacing:2px;font-weight:800}
        #dspRollingPerformance .dr-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
        #dspRollingPerformance .dr-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:12px;min-width:0}
        #dspRollingPerformance .dr-card span{display:block;color:#91a4b9;font-size:11px}
        #dspRollingPerformance .dr-card strong{display:block;font-size:21px;margin-top:4px}
        #dspRollingPerformance .dr-card small{display:block;color:#91a4b9;margin-top:4px}
        #dspRollingPerformance .dr-table-wrap{overflow-x:auto}
        #dspRollingPerformance table{width:100%;min-width:760px;border-collapse:collapse;font-size:12px}
        #dspRollingPerformance th,#dspRollingPerformance td{padding:9px 8px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
        #dspRollingPerformance th{color:#91a4b9;font-size:10px}
        #dspRollingPerformance small{display:block;color:#91a4b9}
        #dspRollingPerformance .dr-positive{color:#67e0ad}
        #dspRollingPerformance .dr-negative{color:#f4b86a}
        #dspRollingPerformance .dr-note{color:#91a4b9;font-size:11px;margin-top:12px;line-height:1.5}
        @media(max-width:700px){#dspRollingPerformance{padding:15px}#dspRollingPerformance .dr-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      </style>
      <p class="dr-kicker">PHASE 2 · ROLLING VALIDATION</p>
      <h2>Rolling Performance Tracker</h2>
      <p id="drStatus">Restoring saved validation history…</p>
      <div class="dr-summary">
        <div class="dr-card"><span>Last 100 scored outcomes</span><strong id="dr100">—</strong><small id="dr100Meta">Waiting for tests</small></div>
        <div class="dr-card"><span>Last 250 scored outcomes</span><strong id="dr250">—</strong><small id="dr250Meta">Waiting for tests</small></div>
        <div class="dr-card"><span>Last 500 scored outcomes</span><strong id="dr500">—</strong><small id="dr500Meta">Waiting for tests</small></div>
        <div class="dr-card"><span>All saved outcomes</span><strong id="drAll">—</strong><small id="drAllMeta">10.0% random baseline</small></div>
      </div>
      <div class="dr-table-wrap">
        <table>
          <thead><tr><th>Market</th><th>All trials</th><th>Last 100</th><th>Last 250</th><th>Last 500</th><th>Last-500 95% interval</th><th>Trend</th></tr></thead>
          <tbody id="drRows"><tr><td colspan="7">Waiting for scored third-tick outcomes…</td></tr></tbody>
        </table>
      </div>
      <p class="dr-note">Every trial uses the preceding 100 live digits to select the most frequent digit and scores only the third subsequent live tick. The 100-tick warm-up is excluded. Saved results survive page refreshes in this browser on this device. Rolling windows overlap, and markets are tested repeatedly; confidence intervals are descriptive and do not correct for dependence or multiple comparisons. This is research evidence, not proof of a profitable trading edge.</p>
    `;
    const existing = document.getElementById("dspValidation");
    if (existing) existing.insertAdjacentElement("afterend", panel);
    else document.querySelector("main")?.appendChild(panel);
  }

  function render() {
    const records = Object.values(memory.markets);
    const totals = {};
    WINDOW_SIZES.forEach(size => { totals[size] = summary(records, size); });
    const all = summary(records, 0);

    [100, 250, 500].forEach(size => {
      const s = totals[size];
      document.getElementById("dr" + size).textContent = formatRate(s.rate);
      document.getElementById("dr" + size + "Meta").textContent =
        s.tested.toLocaleString() + " trials · " + formatDelta(s.rate) + " vs 10%";
    });
    document.getElementById("drAll").textContent = formatRate(all.rate);
    document.getElementById("drAllMeta").textContent =
      all.tested.toLocaleString() + " saved trials · " + formatDelta(all.rate) + " vs 10%";

    const active = records.filter(r => r.outcomes.length);
    const totalSaved = active.reduce((sum, r) => sum + r.outcomes.length, 0);
    document.getElementById("drStatus").textContent =
      active.length + " markets with saved scored outcomes · " +
      totalSaved.toLocaleString() + " retained trials · " +
      (storageAvailable ? "browser storage active" : "browser storage unavailable");

    const rows = records.filter(r => r.outcomes.length).sort((a,b) => {
      const ar = summary([a], 100).rate ?? -1;
      const br = summary([b], 100).rate ?? -1;
      return br - ar;
    }).map(record => {
      const s100 = summary([record], 100);
      const s250 = summary([record], 250);
      const s500 = summary([record], 500);
      const older = record.outcomes.slice(-200, -100);
      const olderRate = older.length
        ? older.filter(x => x.hit).length / older.length : null;
      let trend = "Building history";
      if (s100.rate !== null && olderRate !== null) {
        const change = (s100.rate - olderRate) * 100;
        trend = (change > 1 ? "Improving" : change < -1 ? "Cooling" : "Stable") +
          " (" + (change >= 0 ? "+" : "") + change.toFixed(1) + " pp)";
      }
      const ci = s500.interval
        ? (100*s500.interval[0]).toFixed(1) + "–" + (100*s500.interval[1]).toFixed(1) + "%"
        : "—";
      const cls = s100.rate === null ? "" : s100.rate >= BASELINE ? "dr-positive" : "dr-negative";
      return "<tr><td>" + safe(record.name) + "<small>" + safe(record.symbol) + "</small></td>" +
        "<td>" + record.outcomes.length.toLocaleString() + "</td>" +
        "<td class=\"" + cls + "\">" + formatRate(s100.rate) + "</td>" +
        "<td>" + formatRate(s250.rate) + "</td><td>" + formatRate(s500.rate) + "</td>" +
        "<td>" + ci + "</td><td>" + trend + "</td></tr>";
    });
    document.getElementById("drRows").innerHTML = rows.length ? rows.join("") :
      '<tr><td colspan="7">No scored outcomes yet. The 100-tick training window is excluded.</td></tr>';
    adaptiveRender();
  }


  function installAdaptive() {
    const panel = document.createElement("section");
    panel.id = "dspAdaptiveIntelligence";
    panel.innerHTML = `
      <style>
        #dspAdaptiveIntelligence{margin:14px 0;padding:20px;background:#101d2d;border:1px solid #203249;border-radius:16px;color:#eaf2fb}
        #dspAdaptiveIntelligence h2{font-size:19px;margin:0}
        #dspAdaptiveIntelligence .da-kicker{color:#52d6df;font-size:10px;letter-spacing:2px;font-weight:800}
        #dspAdaptiveIntelligence .da-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
        #dspAdaptiveIntelligence .da-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:12px}
        #dspAdaptiveIntelligence .da-card span{display:block;color:#91a4b9;font-size:11px}
        #dspAdaptiveIntelligence .da-card strong{display:block;font-size:20px;margin-top:4px}
        #dspAdaptiveIntelligence .da-wrap{overflow-x:auto}
        #dspAdaptiveIntelligence table{width:100%;min-width:850px;border-collapse:collapse;font-size:12px}
        #dspAdaptiveIntelligence th,#dspAdaptiveIntelligence td{padding:9px 8px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
        #dspAdaptiveIntelligence th{color:#91a4b9;font-size:10px}
        #dspAdaptiveIntelligence small{display:block;color:#91a4b9}
        #dspAdaptiveIntelligence .da-good{color:#67e0ad}
        #dspAdaptiveIntelligence .da-watch{color:#f4b86a}
        #dspAdaptiveIntelligence .da-muted{color:#91a4b9}
        #dspAdaptiveIntelligence .da-note{color:#91a4b9;font-size:11px;line-height:1.5;margin-top:12px}
        @media(max-width:650px){#dspAdaptiveIntelligence{padding:15px}#dspAdaptiveIntelligence .da-summary{grid-template-columns:1fr}}
      </style>
      <p class="da-kicker">PHASE 3 · ADAPTIVE MARKET INTELLIGENCE</p>
      <h2>Market Evidence &amp; Holdout Validation</h2>
      <p id="daStatus">Evaluating saved outcomes…</p>
      <div class="da-summary">
        <div class="da-card"><span>Markets evaluated</span><strong id="daMarkets">0</strong></div>
        <div class="da-card"><span>Independent holdout passes</span><strong id="daPasses">0</strong></div>
        <div class="da-card"><span>Deterioration watches</span><strong id="daAlerts">0</strong></div>
      </div>
      <div class="da-wrap"><table>
        <thead><tr><th>Discovery rank</th><th>Market</th><th>Discovery sample</th><th>Discovery rate</th><th>Forward holdout</th><th>Holdout 95% interval</th><th>Classification</th><th>Monitor</th></tr></thead>
        <tbody id="daRows"><tr><td colspan="8">Waiting for saved outcomes…</td></tr></tbody>
      </table></div>
      <p class="da-note">Method: each market's earlier 60% of retained scored outcomes is the discovery segment; its later 40% is a forward holdout. Markets are ranked using the discovery segment only. A holdout pass requires at least 100 holdout trials and a 95% Wilson lower bound above the 10% reference. “Strong candidate” requires both segments to clear that threshold. Fewer samples are labelled insufficient. A deterioration watch compares the latest 100 outcomes with the preceding 100. Legacy outcomes created before global IDs were introduced are migrated in stored per-market order; their exact cross-market chronology is unavailable. This is research monitoring, not a trade instruction or proof of a profitable edge.</p>
    `;
    const rolling = document.getElementById("dspRollingPerformance");
    if (rolling) rolling.insertAdjacentElement("afterend", panel);
    else document.querySelector("main")?.appendChild(panel);
  }

  function adaptiveStats(items) {
    const n = items.length;
    const hits = items.reduce((sum, x) => sum + (x.hit ? 1 : 0), 0);
    return { n, hits, rate: n ? hits / n : null, interval: wilson(hits, n) };
  }

  function adaptiveRender() {
    const records = Object.values(memory.markets).filter(r => r.outcomes.length);
    const rows = records.map(record => {
      const ordered = record.outcomes.slice().sort((a,b) => (a.id || 0) - (b.id || 0));
      const split = Math.floor(ordered.length * 0.6);
      const discovery = adaptiveStats(ordered.slice(0, split));
      const holdoutItems = ordered.slice(split);
      const holdout = adaptiveStats(holdoutItems);
      const prior = adaptiveStats(ordered.slice(-200, -100));
      const recent = adaptiveStats(ordered.slice(-100));
      const enoughDiscovery = discovery.n >= 100;
      const enoughHoldout = holdout.n >= 100;
      const discoveryPass = enoughDiscovery && discovery.interval[0] > BASELINE;
      const holdoutPass = enoughHoldout && holdout.interval[0] > BASELINE;
      let classification = "Insufficient evidence";
      let cls = "da-muted";
      if (discoveryPass && holdoutPass) { classification = "Strong candidate · replicated"; cls = "da-good"; }
      else if (enoughHoldout && holdout.interval[1] < BASELINE) { classification = "Weak · below reference"; cls = "da-watch"; }
      else if (enoughDiscovery && enoughHoldout && recent.rate !== null && prior.rate !== null &&
          recent.rate - prior.rate >= 0.03) { classification = "Improving · not confirmed"; cls = "da-good"; }
      else if (enoughDiscovery && enoughHoldout) { classification = "Neutral · unconfirmed"; cls = "da-muted"; }
      const deterioration = prior.n >= 50 && recent.n >= 50 &&
        prior.rate - recent.rate >= 0.05;
      const discoveryLower = discovery.interval ? discovery.interval[0] : -1;
      const holdoutCI = holdout.interval
        ? (100*holdout.interval[0]).toFixed(1) + "–" + (100*holdout.interval[1]).toFixed(1) + "%"
        : "—";
      return { record, discovery, holdout, discoveryLower, holdoutCI, classification, cls,
        monitor: deterioration ? "Deterioration watch" : (prior.n >= 50 && recent.n >= 50 ? "No alert" : "Building trend") };
    }).sort((a,b) => b.discoveryLower - a.discoveryLower);

    const passes = rows.filter(r => r.discovery.n >= 100 && r.holdout.n >= 100 &&
      r.discovery.interval[0] > BASELINE && r.holdout.interval[0] > BASELINE).length;
    const alerts = rows.filter(r => r.monitor === "Deterioration watch").length;
    document.getElementById("daMarkets").textContent = rows.length;
    document.getElementById("daPasses").textContent = passes;
    document.getElementById("daAlerts").textContent = alerts;
    document.getElementById("daStatus").textContent =
      "Discovery/holdout split is chronological within each market · 10.0% reference · " +
      (storageAvailable ? "saved local history available" : "local storage unavailable");
    document.getElementById("daRows").innerHTML = rows.length ? rows.map((r,i) => {
      const rate = r.discovery.rate === null ? "—" : (100*r.discovery.rate).toFixed(1)+"%";
      const monitorClass = r.monitor === "Deterioration watch" ? "da-watch" : "da-muted";
      return "<tr><td>"+(i+1)+"</td><td>"+safe(r.record.name)+"<small>"+safe(r.record.symbol)+"</small></td>"+
        "<td>"+r.discovery.n+"</td><td>"+rate+"</td><td>"+r.holdout.n+" trials · "+
        (r.holdout.rate === null ? "—" : (100*r.holdout.rate).toFixed(1)+"%")+"</td>"+
        "<td>"+r.holdoutCI+"</td><td class=\""+r.cls+"\">"+r.classification+"</td>"+
        "<td class=\""+monitorClass+"\">"+r.monitor+"</td></tr>";
    }).join("") : '<tr><td colspan="8">No saved scored outcomes yet.</td></tr>';
  }

  load();
  install();
  installAdaptive();
  window.addEventListener("dsp:tick-observation", onTick);
  window.addEventListener("dsp:market-snapshot", onSnapshot);
  render();
})();
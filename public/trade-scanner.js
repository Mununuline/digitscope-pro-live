(() => {
  "use strict";

  if (window.__dspTradeScannerLoaded) return;
  window.__dspTradeScannerLoaded = true;

  const TRAINING_TICKS = 100;
  const FORECAST_HORIZON = 3;
  const HISTORY_LIMIT = 250;
  const CONTRACTS = [
    ...Array.from({ length: 8 }, (_, i) => ({ key: "over_" + (i + 1), type: "OVER", barrier: i + 1, label: "OVER " + (i + 1), baseline: (9 - (i + 1)) / 10, test: d => d > i + 1 })),
    ...Array.from({ length: 8 }, (_, i) => ({ key: "under_" + (i + 1), type: "UNDER", barrier: i + 1, label: "UNDER " + (i + 1), baseline: (i + 1) / 10, test: d => d < i + 1 })),
    { key: "even", type: "EVEN", label: "EVEN", baseline: 0.5, test: d => d % 2 === 0 },
    { key: "odd", type: "ODD", label: "ODD", baseline: 0.5, test: d => d % 2 === 1 }
  ];

  const markets = new Map();
  const stats = new Map();
  let filter = "ALL";

  const style = document.createElement("style");
  style.textContent = `
    #dspTradeScanner{margin:14px 0;padding:20px;background:linear-gradient(145deg,rgba(17,31,47,.98),rgba(12,24,38,.98));border:1px solid #203249;border-radius:16px;color:#eaf2fb;box-shadow:0 12px 35px #0002}
    #dspTradeScanner .dts-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    #dspTradeScanner .dts-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
    #dspTradeScanner h2{font-size:19px;margin:0}
    #dspTradeScanner .dts-badge{font-size:10px;color:#f4b86a;border:1px solid #76552b;border-radius:20px;padding:5px 9px}
    #dspTradeScanner .dts-controls{display:flex;align-items:center;gap:10px;margin:14px 0;flex-wrap:wrap}
    #dspTradeScanner label{font-size:11px;color:#91a4b9}
    #dspTradeScanner select{margin-left:6px;padding:8px;background:#091523;color:#eaf2fb;border:1px solid #2b4058;border-radius:8px}
    #dspTradeScanner .dts-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}
    #dspTradeScanner .dts-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:11px;min-width:0}
    #dspTradeScanner .dts-card span{display:block;color:#91a4b9;font-size:10px}
    #dspTradeScanner .dts-card strong{display:block;font-size:17px;margin-top:5px;overflow-wrap:anywhere}
    #dspTradeScanner .dts-table-wrap{overflow-x:auto}
    #dspTradeScanner table{width:100%;border-collapse:collapse;min-width:820px;font-size:11px}
    #dspTradeScanner th,#dspTradeScanner td{padding:10px 8px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
    #dspTradeScanner th{font-size:10px;color:#91a4b9;text-transform:uppercase;letter-spacing:.5px}
    #dspTradeScanner td small{display:block;color:#91a4b9;margin-top:3px}
    #dspTradeScanner .dts-positive{color:#67e0ad}
    #dspTradeScanner .dts-negative{color:#f4b86a}
    #dspTradeScanner .dts-note{font-size:11px;line-height:1.55;color:#91a4b9;margin:12px 0 0}
    @media(max-width:650px){#dspTradeScanner{padding:15px}#dspTradeScanner .dts-summary{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspTradeScanner";
  panel.innerHTML = `
    <div class="dts-head">
      <div><p class="dts-kicker">VOLATILITY-AWARE · WALK-FORWARD RESEARCH</p><h2>Unified DIGIT Trade Scanner</h2></div>
      <span class="dts-badge">READ-ONLY · NO AUTO TRADES</span>
    </div>
    <p id="dtsStatus" class="dts-note">Waiting for live tick observations…</p>
    <div class="dts-summary">
      <div class="dts-card"><span>Markets monitored</span><strong id="dtsMarkets">0 / 13</strong></div>
      <div class="dts-card"><span>Contract models</span><strong>18 per market</strong></div>
      <div class="dts-card"><span>Forecast horizon</span><strong>3 subsequent ticks</strong></div>
      <div class="dts-card"><span>Validation records</span><strong id="dtsScored">0</strong></div>
    </div>
    <div class="dts-controls">
      <label>Show trade type
        <select id="dtsFilter">
          <option value="ALL">All types</option><option value="OVER">Over</option><option value="UNDER">Under</option>
          <option value="EVEN">Even</option><option value="ODD">Odd</option>
        </select>
      </label>
      <span id="dtsMethod" class="dts-note">Training window: 100 prior ticks · outcome scored on tick +3</span>
    </div>
    <div class="dts-table-wrap">
      <table>
        <thead><tr><th>Market</th><th>Tick volatility</th><th>Best watch contract</th><th>Estimated chance</th><th>Fair baseline</th><th>3-tick tests</th><th>OOS Brier skill</th><th>Evidence</th></tr></thead>
        <tbody id="dtsRows"><tr><td colspan="8">Collecting 100 live ticks per market…</td></tr></tbody>
      </table>
    </div>
    <p class="dts-note">The scanner evaluates OVER/UNDER barriers 1–8 plus EVEN and ODD separately. Each probability is estimated only from the preceding 100 digits; it is scored against the actual third subsequent tick. Brier skill compares probability forecasts with the fair-digit baseline (positive is better, zero is equal, negative is worse). Tick volatility is mean absolute quote movement, not a direction forecast. Overlapping forecasts and repeated market/barrier comparisons are dependent; this is exploratory evidence, not proof of an edge or a trade recommendation.</p>
  `;

  const scanner = document.getElementById("dspScannerPanel");
  const validation = document.getElementById("dspValidation");
  if (validation) validation.insertAdjacentElement("afterend", panel);
  else if (scanner) scanner.insertAdjacentElement("afterend", panel);
  else document.querySelector("main")?.appendChild(panel);

  const $ = id => document.getElementById(id);
  const pct = value => (value * 100).toFixed(1) + "%";
  const signedPp = value => (value >= 0 ? "+" : "") + (value * 100).toFixed(1) + " pp";
  const signedPercent = value => (value >= 0 ? "+" : "") + (value * 100).toFixed(1) + "%";
  const safe = value => String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function getMarket(symbol, name) {
    if (!markets.has(symbol)) {
      markets.set(symbol, { symbol, name, seq: 0, digits: [], quotes: [], pending: [], volatility: null, volatilityTrend: "—" });
    }
    const item = markets.get(symbol);
    item.name = name || item.name;
    return item;
  }

  function getStats(symbol, contract) {
    const key = symbol + "|" + contract.key;
    if (!stats.has(key)) stats.set(key, { tested: 0, events: 0, brier: 0, baselineBrier: 0, outcomes: [] });
    return stats.get(key);
  }

  function probability(digits, contract) {
    let events = 0;
    for (const digit of digits) if (contract.test(digit)) events += 1;
    return events / digits.length;
  }

  function updateVolatility(item, quote) {
    if (Number.isFinite(quote)) item.quotes.push(quote);
    if (item.quotes.length > 60) item.quotes.shift();
    if (item.quotes.length < 3) return;
    const moves = [];
    for (let i = 1; i < item.quotes.length; i += 1) moves.push(Math.abs(item.quotes[i] - item.quotes[i - 1]));
    item.volatility = moves.reduce((sum, value) => sum + value, 0) / moves.length;
    if (moves.length >= 40) {
      const old = moves.slice(-50, -25);
      const recent = moves.slice(-25);
      const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const before = mean(old), now = mean(recent);
      const ratio = before > 0 ? now / before : 1;
      item.volatilityTrend = ratio > 1.15 ? "Rising" : ratio < 0.85 ? "Cooling" : "Steady";
    }
  }

  function scoreDueForecasts(item, digit, tickId) {
    const remaining = [];
    for (const forecast of item.pending) {
      if (forecast.dueAt > item.seq) {
        remaining.push(forecast);
        continue;
      }
      const observed = forecast.contract.test(digit) ? 1 : 0;
      const score = Math.pow(forecast.p - observed, 2);
      const baseScore = Math.pow(forecast.contract.baseline - observed, 2);
      const record = getStats(item.symbol, forecast.contract);
      record.tested += 1;
      record.events += observed;
      record.brier += score;
      record.baselineBrier += baseScore;
      record.outcomes.push({dataset_id:"DS-03",methodology_version:"1.0.0",market:item.symbol,contract:forecast.contract.key,model_id:"empirical-frequency-100-v1",selected_digit:null,forecast_origin_tick_id:forecast.originTickId||null,target_tick_id:tickId||null,training_window:TRAINING_TICKS,forecast_horizon:FORECAST_HORIZON,observed_digit:digit,hit:observed===1,scored_at_utc:new Date().toISOString()});
      if(window.DigitScopeDatasetRegistry)window.DigitScopeDatasetRegistry.ingest(record.outcomes[record.outcomes.length-1]);
      if(record.outcomes.length>5000)record.outcomes.shift();
    }
    item.pending = remaining;
  }

  function createForecasts(item) {
    if (item.digits.length < TRAINING_TICKS) return;
    const training = item.digits.slice(-TRAINING_TICKS);
    for (const contract of CONTRACTS) {
      item.pending.push({
        dueAt: item.seq + FORECAST_HORIZON,
        originTickId: item.currentTickId || null,
        contract,
        p: probability(training, contract)
      });
    }
  }

  function onTick(event) {
    const data = event.detail || {};
    const digit = Number(data.digit);
    const quote = Number(data.quote);
    const symbol = String(data.symbol || "");
    if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9) return;

    const item = getMarket(symbol, data.name || symbol);
    item.seq += 1;
    item.currentTickId = data.tickId || null;
    scoreDueForecasts(item, digit, data.tickId);
    // Include the just-observed tick in the 100-tick training window. Since
    // the forecast is issued now, seq + 3 is the third subsequent tick.
    item.digits.push(digit);
    if (item.digits.length > HISTORY_LIMIT) item.digits.shift();
    createForecasts(item);
    updateVolatility(item, quote);
    if (item.seq % 5 === 0) render();
  }

  function bestContract(item) {
    if (item.digits.length < TRAINING_TICKS) return null;
    const training = item.digits.slice(-TRAINING_TICKS);
    const candidates = CONTRACTS.filter(contract => filter === "ALL" || contract.type === filter)
      .map(contract => {
        const p = probability(training, contract);
        return { contract, p, delta: p - contract.baseline };
      });
    candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return candidates[0] || null;
  }

  function brierSkill(record) {
    if (!record || !record.tested || record.baselineBrier === 0) return null;
    return 1 - record.brier / record.baselineBrier;
  }

  function render() {
    const items = Array.from(markets.values()).sort((a, b) => a.name.localeCompare(b.name));
    $("dtsMarkets").textContent = items.length + " / 13";
    let totalScored = 0;
    stats.forEach(record => { totalScored += record.tested; });
    $("dtsScored").textContent = totalScored.toLocaleString();
    $("dtsStatus").textContent = items.length
      ? "Live observations received · " + items.filter(item => item.digits.length >= TRAINING_TICKS).length +
        "/" + items.length + " markets have a full training window · session results reset on page refresh."
      : "Waiting for live tick observations…";

    const rows = items.map(item => {
      const best = bestContract(item);
      if (!best) return '<tr><td>' + safe(item.name) + '<small>' + safe(item.symbol) + '</small></td><td>Warming up</td><td>—</td><td>—</td><td>—</td><td>0</td><td>—</td><td>Need ' + (TRAINING_TICKS - item.digits.length) + ' ticks</td></tr>';
      const record = getStats(item.symbol, best.contract);
      const skill = brierSkill(record);
      const evidence = Math.abs(best.delta) >= 0.10 ? "Watch · " + signedPp(best.delta) : "Near baseline";
      const evidenceClass = Math.abs(best.delta) >= 0.10 ? "dts-negative" : "";
      return '<tr><td>' + safe(item.name) + '<small>' + safe(item.symbol) + '</small></td>' +
        '<td>' + (item.volatility === null ? "Collecting" : item.volatility.toFixed(5) + '<small>' + item.volatilityTrend + '</small>') + '</td>' +
        '<td><b>' + best.contract.label + '</b></td><td>' + pct(best.p) + '</td><td>' + pct(best.contract.baseline) + '</td>' +
        '<td>' + record.tested.toLocaleString() + '</td><td class="' + (skill !== null && skill > 0 ? "dts-positive" : "dts-negative") + '">' +
        (skill === null ? "Collecting" : signedPercent(skill)) + '</td><td class="' + evidenceClass + '">' + evidence + '</td></tr>';
    });
    $("dtsRows").innerHTML = rows.length ? rows.join("") : '<tr><td colspan="8">Waiting for scanner markets…</td></tr>';
  }

  $("dtsFilter").addEventListener("change", event => {
    filter = event.target.value;
    render();
  });
  window.addEventListener("dsp:tick-observation", onTick);
  window.addEventListener("dsp:market-snapshot", event => {
    const rows = event.detail?.rows || [];
    rows.forEach(row => getMarket(String(row.symbol || ""), row.name || row.symbol));
    render();
  });
  render();
})();
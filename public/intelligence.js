
(() => {
  "use strict";

  if (window.__dspIntelligenceLoaded) return;
  window.__dspIntelligenceLoaded = true;

  const MIN_SAMPLE = 100;
  const WATCH_Z = 1.96;
  const STRONG_Z = 2.58;
  let latestRows = [];
  const validationBySymbol = Object.create(null);
  const VALIDATION_LOOKBACK = 100;
  const VALIDATION_HORIZON = 3;
  let validationRenderCounter = 0;
  let validationSnapshotCount = 0;
  let validationSnapshotMarketCount = 0;

  const style = document.createElement("style");
  style.textContent = `
    #dspIntelligence {
      margin: 14px 0;
      padding: 20px;
      background: #101d2d;
      border: 1px solid #203249;
      border-radius: 16px;
      color: #eaf2fb;
    }
    #dspIntelligence h2 { font-size: 19px; margin: 0; }
    #dspIntelligence .di-kicker {
      color: #52d6df;
      font-size: 10px;
      letter-spacing: 2px;
      font-weight: 800;
    }
    #dspIntelligence .di-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 16px 0;
    }
    #dspIntelligence label {
      color: #91a4b9;
      font-size: 11px;
    }
    #dspIntelligence select {
      display: block;
      margin-top: 5px;
      padding: 9px;
      background: #091523;
      color: white;
      border: 1px solid #2b4058;
      border-radius: 8px;
    }
    #dspIntelligence .di-table-wrap { overflow-x: auto; }
    #dspIntelligence table {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
      font-size: 12px;
    }
    #dspIntelligence th,
    #dspIntelligence td {
      padding: 10px 8px;
      border-bottom: 1px solid #203249;
      text-align: left;
      white-space: nowrap;
    }
    #dspIntelligence th {
      color: #91a4b9;
      font-size: 10px;
    }
    #dspIntelligence small {
      display: block;
      color: #91a4b9;
    }
    #dspIntelligence .strong { color: #67e0ad; }
    #dspIntelligence .watch { color: #f4b86a; }
    #dspIntelligence .weak { color: #91a4b9; }
    #dspValidation {
      margin: 14px 0;
      padding: 20px;
      background: #101d2d;
      border: 1px solid #203249;
      border-radius: 16px;
      color: #eaf2fb;
    }
    #dspValidation h2 { font-size: 19px; margin: 0; }
    #dspValidation .dv-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:14px 0; }
    #dspValidation .dv-card { background:#0a1725; border:1px solid #203249; border-radius:10px; padding:12px; }
    #dspValidation .dv-card span { display:block; color:#91a4b9; font-size:11px; }
    #dspValidation .dv-card strong { display:block; font-size:21px; margin-top:4px; }
    #dspValidation .dv-table-wrap { overflow-x:auto; }
    #dspValidation table { width:100%; min-width:620px; border-collapse:collapse; font-size:12px; }
    #dspValidation th,#dspValidation td { padding:9px 8px; border-bottom:1px solid #203249; text-align:left; white-space:nowrap; }
    #dspValidation th { color:#91a4b9; font-size:10px; }
    #dspValidation small { display:block; color:#91a4b9; }
    #dspValidation .dv-note { color:#91a4b9; font-size:11px; margin-top:12px; }
    #dspValidation .dv-positive { color:#67e0ad; }
    #dspValidation .dv-negative { color:#f4b86a; }
    @media(max-width:600px){#dspValidation{padding:15px}#dspValidation .dv-summary{grid-template-columns:1fr}}
    #dspIntelligence .di-note {
      color: #91a4b9;
      font-size: 11px;
      margin-top: 14px;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspIntelligence";
  panel.innerHTML = `
    <p class="di-kicker">UNIFIED MARKET INTELLIGENCE</p>
    <h2>Live Signal Leaderboard</h2>
    <p id="diStatus">Waiting for live market samples…</p>

    <div class="di-controls">
      <label>Over/Under barrier
        <select id="diBarrier">
          ${[1,2,3,4,5,6,7,8].map(n =>
            `<option value="${n}" ${n === 4 ? "selected" : ""}>${n}</option>`
          ).join("")}
        </select>
      </label>

      <label>Match digit
        <select id="diDigit">
          ${Array.from({length:10},(_,n) =>
            `<option value="${n}" ${n === 4 ? "selected" : ""}>${n}</option>`
          ).join("")}
        </select>
      </label>

      <label>Show
        <select id="diFilter">
          <option value="elevated">Elevated evidence only</option>
          <option value="all">All signals</option>
        </select>
      </label>
    </div>

    <div class="di-table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Market</th><th>Contract</th>
            <th>Observed</th><th>Baseline</th><th>Edge</th>
            <th>95% interval</th><th>Evidence</th><th>Ticks</th>
          </tr>
        </thead>
        <tbody id="diRows">
          <tr><td colspan="9">Waiting for market data…</td></tr>
        </tbody>
      </table>
    </div>

    <p class="di-note">
      These are statistical deviations in recent samples, not guaranteed
      predictions of the next tick. Multiple market comparisons can produce
      false signals. Further out-of-sample testing is necessary.
    </p>
  `;

  const scanner = document.getElementById("dspScannerPanel");
  const hero = document.querySelector(".hero");

  if (scanner) scanner.insertAdjacentElement("afterend", panel);
  else if (hero) hero.insertAdjacentElement("afterend", panel);
  else document.body.appendChild(panel);


  const validationPanel = document.createElement("section");
  validationPanel.id = "dspValidation";
  validationPanel.innerHTML = `
    <p class="di-kicker">OUT-OF-SAMPLE TRACKER</p>
    <h2>Signal Validation &amp; Performance</h2>
    <p id="dvStatus">Waiting for live ticks to begin validation…</p>
    <div class="dv-summary">
      <div class="dv-card"><span>Future ticks tested</span><strong id="dvTrials">0</strong></div>
      <div class="dv-card"><span>Walk-forward hit rate</span><strong id="dvRate">—</strong></div>
      <div class="dv-card"><span>Random-digit baseline</span><strong>10.0%</strong></div>
    </div>
    <div class="dv-table-wrap">
      <table><thead><tr><th>Market</th><th>Tested</th><th>Hits</th><th>Hit rate</th><th>vs 10% baseline</th><th>95% interval</th></tr></thead>
      <tbody id="dvRows"><tr><td colspan="6">Collecting a 100-tick starting window…</td></tr></tbody></table>
    </div>
    <p class="dv-note">Method: after a 100-tick warm-up, each forecast selects the most frequent digit from the preceding 100 ticks, then scores only the third subsequent live tick. Historical warm-up data is never counted as a test result. Results are session-only and reset when this page is refreshed. This simple benchmark is not a trade signal; repeated testing and multiple markets can produce misleading results.</p>
  `;
  panel.insertAdjacentElement("afterend", validationPanel);

  const $ = id => document.getElementById(id);

  function wilson(p, n) {
    const z = 1.96;
    const z2 = z * z;
    const den = 1 + z2 / n;
    const center = (p + z2 / (2*n)) / den;
    const margin = z * Math.sqrt(
      p*(1-p)/n + z2/(4*n*n)
    ) / den;

    return [
      Math.max(0, center-margin),
      Math.min(1, center+margin)
    ];
  }

  function makeSignal(market, contract, hits, n, baseline) {
    if (!n || baseline <= 0 || baseline >= 1) return null;

    const p = hits / n;
    const se = Math.sqrt(baseline*(1-baseline)/n);
    const z = se ? (p-baseline)/se : 0;
    const [low,high] = wilson(p,n);

    return {
      market: market.name,
      symbol: market.symbol,
      contract,
      p,
      baseline,
      edge: (p-baseline)*100,
      z,
      low,
      high,
      n
    };
  }

  function buildSignals(market) {
    const c = market.counts;
    const n = market.n;

    if (n < MIN_SAMPLE || !Array.isArray(c) || c.length !== 10) {
      return [];
    }

    const signals = [];

    const even = c[0]+c[2]+c[4]+c[6]+c[8];
    const evenRate = even/n;

    signals.push(makeSignal(
      market,
      evenRate >= 0.5 ? "Even" : "Odd",
      evenRate >= 0.5 ? even : n-even,
      n,
      0.5
    ));

    const barrier = Number($("diBarrier").value);
    const over = c.slice(barrier+1).reduce((a,b)=>a+b,0);
    const under = c.slice(0,barrier).reduce((a,b)=>a+b,0);
    const eligible = over+under;

    if (eligible) {
      const overBaseline = (9-barrier)/9;
      const isOver = over/eligible >= overBaseline;

      signals.push(makeSignal(
        market,
        isOver ? "Over "+barrier : "Under "+barrier,
        isOver ? over : under,
        eligible,
        isOver ? overBaseline : 1-overBaseline
      ));
    }

    const digit = Number($("diDigit").value);
    const matches = c[digit];
    const isMatch = matches/n >= 0.1;

    signals.push(makeSignal(
      market,
      isMatch ? "Matches "+digit : "Differs "+digit,
      isMatch ? matches : n-matches,
      n,
      isMatch ? 0.1 : 0.9
    ));

    return signals.filter(Boolean);
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",
      '"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function render() {
    const signals = latestRows
      .flatMap(buildSignals)
      .sort((a,b)=>Math.abs(b.z)-Math.abs(a.z));

    const ready = latestRows.filter(r=>r.n>=MIN_SAMPLE).length;
    $("diStatus").textContent =
      ready+"/"+latestRows.length+" markets have at least "+MIN_SAMPLE+" ticks";

    const visible = $("diFilter").value === "all"
      ? signals
      : signals.filter(s => Math.abs(s.z) >= WATCH_Z);

    if (!visible.length) {
      $("diRows").innerHTML =
        `<tr><td colspan="9">No elevated signals currently. Markets may still be warming up.</td></tr>`;
      return;
    }

    $("diRows").innerHTML = visible.slice(0,30).map((s,i)=>{
      const strength = Math.abs(s.z);
const strong = strength >= STRONG_Z;
const watch = strength >= WATCH_Z;
const direction = s.z >= 0 ? "Above baseline" : "Below baseline";
const label = (strong ? "Strong deviation" : watch ? "Watch" : "Weak") + " · " + direction;
      const cls = strong ? "strong" : watch ? "watch" : "weak";
      return `<tr>
        <td>${i+1}</td>
        <td>${escapeText(s.market)}<small>${escapeText(s.symbol)}</small></td>
        <td>${escapeText(s.contract)}</td>
        <td>${(s.p*100).toFixed(1)}%</td>
        <td>${(s.baseline*100).toFixed(1)}%</td>
        <td>${s.edge>=0?"+":""}${s.edge.toFixed(1)} pp</td>
        <td>${(s.low*100).toFixed(1)}–${(s.high*100).toFixed(1)}%</td>
        <td class="${cls}">${label}<small>z = ${s.z.toFixed(2)}</small></td>
        <td>${s.n}</td>
      </tr>`;
    }).join("");
  }


  function validationWilson(hits, tested) {
    if (!tested) return [0, 0];
    const z = 1.96, p = hits / tested, z2 = z * z;
    const den = 1 + z2 / tested;
    const center = (p + z2 / (2 * tested)) / den;
    const margin = z * Math.sqrt(p * (1-p) / tested + z2 / (4 * tested * tested)) / den;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  function renderValidation() {
    const records = Object.values(validationBySymbol);
    const total = records.reduce((sum, record) => sum + record.tested, 0);
    const hits = records.reduce((sum, record) => sum + record.hits, 0);
    $("dvTrials").textContent = total.toLocaleString();
    $("dvRate").textContent = total ? (100 * hits / total).toFixed(1) + "%" : "—";
    $("dvStatus").textContent = records.length === 0
      ? (validationSnapshotCount === 0
          ? "Waiting for scanner tick events and snapshots · no market observations received yet"
          : "Scanner snapshots received · waiting for valid tick observations")
      : records.length + " markets observed · " +
        total.toLocaleString() + " third-tick outcomes scored · " +
        (total >= 1000 ? "1,000-test milestone reached" : (1000 - total).toLocaleString() + " more tests to reach 1,000") +
        " · snapshots " + validationSnapshotCount + " / markets " + validationSnapshotMarketCount;
    const rows = records
      .filter(record => record.tested > 0)
      .sort((a, b) => b.tested - a.tested)
      .map(record => {
        const rate = record.hits / record.tested;
        const interval = validationWilson(record.hits, record.tested);
        const delta = (rate - 0.1) * 100;
        return "<tr><td>" + escapeText(record.name) + "<small>" + escapeText(record.symbol) + "</small></td>" +
          "<td>" + record.tested.toLocaleString() + "</td><td>" + record.hits.toLocaleString() + "</td>" +
          "<td>" + (100 * rate).toFixed(1) + "%</td><td>" + (delta >= 0 ? "+" : "") + delta.toFixed(1) + " pp</td>" +
          "<td>" + (100 * interval[0]).toFixed(1) + "–" + (100 * interval[1]).toFixed(1) + "%</td></tr>";
      });
    $("dvRows").innerHTML = rows.length ? rows.join("") :
      '<tr><td colspan="6">Collecting the first 100 live training ticks per market…</td></tr>';
  }

  function applyValidationDigit(record, digit) {
    record.seq += 1;

    const remaining = [];
    for (const forecast of record.pending) {
      if (forecast.dueAt > record.seq) {
        remaining.push(forecast);
      } else {
        record.tested += 1;
        if (digit === forecast.target) record.hits += 1;
      }
    }
    record.pending = remaining;

    // The current observation is included in training. A forecast made now
    // is scored only when the third subsequent observation arrives.
    record.digits.push(digit);
    if (record.digits.length > VALIDATION_LOOKBACK) record.digits.shift();

    if (record.digits.length === VALIDATION_LOOKBACK) {
      const counts = Array(10).fill(0);
      record.digits.forEach(value => { counts[value] += 1; });
      const maxCount = Math.max(...counts);
      const target = counts.indexOf(maxCount);
      record.pending.push({ target, dueAt: record.seq + VALIDATION_HORIZON });
    }
    validationRenderCounter += 1;
  }

  function getValidationRecord(symbol, name) {
    return validationBySymbol[symbol] || (validationBySymbol[symbol] = {
      symbol, name: String(name || symbol), seq: 0, lastTotalTicks: 0,
      digits: [], pending: [], tested: 0, hits: 0
    });
  }

  function onValidationTick(event) {
    const data = event.detail || {};
    const symbol = String(data.symbol || "");
    const digit = Number(data.digit);
    if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9) return;

    const record = getValidationRecord(symbol, data.name);
    record.name = String(data.name || record.name || symbol);
    const totalTicks = Number(data.totalTicks);

    // totalTicks is the scanner's per-market sequence number. Ignore a
    // duplicate observation and leave gaps for the snapshot recovery path.
    if (Number.isSafeInteger(totalTicks) && totalTicks > 0) {
      if (totalTicks <= record.lastTotalTicks) return;
      if (record.lastTotalTicks && totalTicks !== record.lastTotalTicks + 1) return;
      record.lastTotalTicks = totalTicks;
    }
    applyValidationDigit(record, digit);
    if (validationRenderCounter % 5 === 0 || record.tested === 1) renderValidation();
  }

  function onValidationSnapshot(event) {
    const rows = event.detail?.rows || [];
    validationSnapshotCount += 1;
    validationSnapshotMarketCount = rows.length;
    rows.forEach(row => {
      const symbol = String(row.symbol || "");
      const digits = Array.isArray(row.digits) ? row.digits.map(Number) : [];
      const totalTicks = Number(row.totalTicks);
      if (!symbol || !Number.isSafeInteger(totalTicks) || totalTicks < 1 ||
          !digits.length || digits.some(d => !Number.isInteger(d) || d < 0 || d > 9)) return;

      const record = getValidationRecord(symbol, row.name);
      record.name = String(row.name || record.name || symbol);

      // Bootstrap from the latest 100 observations if this tracker started
      // after the scanner, e.g. after a script refresh or partial deployment.
      // These are training observations only and are never counted as tests.
      // A tick event can arrive before the first snapshot and create the
      // record. If no forecasts have been scored or queued yet, still seed
      // the training window from the snapshot's retained history. This avoids
      // needlessly waiting for 100 new ticks after the tracker starts.
      if (record.tested === 0 && record.pending.length === 0 &&
          record.digits.length < VALIDATION_LOOKBACK) {
        record.digits = digits.slice(-VALIDATION_LOOKBACK);
        record.seq = totalTicks;
        record.lastTotalTicks = totalTicks;
        return;
      }

      const gap = totalTicks - record.lastTotalTicks;
      if (gap <= 0) return;

      // Snapshots carry the scanner's rolling digit buffer. Recover only the
      // missing observations in order; if the gap exceeds retained history,
      // restart the warm-up rather than inventing third-tick outcomes.
      if (gap > digits.length) {
        record.digits = digits.slice(-VALIDATION_LOOKBACK);
        record.seq = totalTicks;
        record.lastTotalTicks = totalTicks;
        record.pending = [];
        return;
      }

      const missingDigits = digits.slice(-gap);
      missingDigits.forEach(digit => applyValidationDigit(record, digit));
      record.lastTotalTicks = totalTicks;
    });
    renderValidation();
  }

  // Use scanner snapshots as the authoritative validation input. Each snapshot
  // carries the ordered digit buffer and total tick sequence, allowing this
  // tracker to recover every unseen tick without racing the separate tick event.
  // This also keeps validation working when a browser misses individual events.
  // Score individual tick events immediately. Sequence checks prevent duplicates;
  // snapshots below recover events missed during browser pauses or interruptions.
  window.addEventListener("dsp:tick-observation", onValidationTick);

  // Snapshots carry the ordered digit buffer and total sequence for gap recovery.
  window.addEventListener("dsp:market-snapshot", onValidationSnapshot);

  window.addEventListener("dsp:market-snapshot", event => {
    latestRows = event.detail?.rows || [];
    render();
  });

  $("diBarrier").addEventListener("change",render);
  $("diDigit").addEventListener("change",render);
  $("diFilter").addEventListener("change",render);
})();

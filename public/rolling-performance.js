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

  const memory = { version: 1, markets: Object.create(null) };
  let storageAvailable = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.markets) return;
      Object.keys(parsed.markets).forEach(symbol => {
        const item = parsed.markets[symbol];
        if (!item || !Array.isArray(item.outcomes)) return;
        memory.markets[symbol] = {
          symbol,
          name: String(item.name || symbol),
          outcomes: item.outcomes.filter(x => x && typeof x.hit === "boolean")
            .slice(-MAX_OUTCOMES_PER_MARKET),
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, markets }));
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
    const outcomes = records.flatMap(record => record.outcomes);
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
  }

  load();
  install();
  window.addEventListener("dsp:tick-observation", onTick);
  window.addEventListener("dsp:market-snapshot", onSnapshot);
  render();
})();
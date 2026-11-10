
(() => {
  "use strict";

  if (window.__dspIntelligenceLoaded) return;
  window.__dspIntelligenceLoaded = true;

  const MIN_SAMPLE = 100;
  const WATCH_Z = 1.96;
  const STRONG_Z = 2.58;
  let latestRows = [];

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

    const visible = $("diFilter").value === "all" ? signals : signals.filter(s=>Math.abs(s.z)>=WATCH_Z);

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

  window.addEventListener("dsp:market-snapshot", event => {
    latestRows = event.detail?.rows || [];
    render();
  });

  $("diBarrier").addEventListener("change",render);
  $("diDigit").addEventListener("change",render);
  $("diFilter").addEventListener("change",render);
})();

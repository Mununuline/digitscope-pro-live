(() => {
  "use strict";
  if (window.__dspAdvancedIntelligenceLoaded) return;
  window.__dspAdvancedIntelligenceLoaded = true;

  const WINDOWS = [25, 50, 100, 250, 500];
  const MIN_SAMPLE = 50;
  let latestRows = [];
  let selectedSymbol = "";

  const style = document.createElement("style");
  style.textContent = `
    #dspAdvanced{margin:14px 0;padding:20px;background:linear-gradient(145deg,#12243a,#0c1929);border:1px solid #29415b;border-radius:16px;color:#eaf2fb}
    #dspAdvanced .da-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    #dspAdvanced .da-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
    #dspAdvanced h2{font-size:19px;margin:0}
    #dspAdvanced .da-muted{color:#91a4b9;font-size:11px}
    #dspAdvanced .da-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:16px 0}
    #dspAdvanced label{font-size:11px;color:#91a4b9}
    #dspAdvanced select{display:block;margin-top:5px;padding:9px;background:#091523;color:#fff;border:1px solid #2b4058;border-radius:8px}
    #dspAdvanced .da-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
    #dspAdvanced .da-card{background:#091827;border:1px solid #20364c;border-radius:11px;padding:12px;min-width:0}
    #dspAdvanced .da-card span{display:block;color:#91a4b9;font-size:10px}
    #dspAdvanced .da-card strong{display:block;font-size:19px;margin-top:5px;overflow-wrap:anywhere}
    #dspAdvanced .da-table-wrap{overflow-x:auto}
    #dspAdvanced table{width:100%;min-width:850px;border-collapse:collapse;font-size:11px}
    #dspAdvanced th,#dspAdvanced td{padding:9px 7px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
    #dspAdvanced th{color:#91a4b9;font-size:9px;text-transform:uppercase;letter-spacing:.6px}
    #dspAdvanced tr.da-selected{background:#183047}
    #dspAdvanced .da-market{background:none;border:0;color:#52d6df;font:inherit;font-weight:700;padding:0;text-align:left;cursor:pointer}
    #dspAdvanced .da-up{color:#67e0ad}#dspAdvanced .da-down{color:#ff9a9f}#dspAdvanced .da-neutral{color:#f4b86a}
    #dspAdvanced .da-note{font-size:10px;line-height:1.5;color:#91a4b9;margin:14px 0 0}
    @media(max-width:700px){#dspAdvanced{padding:15px}#dspAdvanced .da-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspAdvanced";
  panel.innerHTML = `
    <div class="da-head"><div><p class="da-kicker">CUSTOM MARKET INTELLIGENCE</p><h2>Live Analysis Scanner</h2></div><span id="daFeed" class="da-muted">Waiting for live snapshots…</span></div>
    <div class="da-controls"><label>Focused market<select id="daMarket"><option value="">Waiting for markets…</option></select></label><span id="daSample" class="da-muted">No tick sample</span></div>
    <div class="da-grid">
      <div class="da-card"><span>Market regime</span><strong id="daRegime">Warming up</strong></div>
      <div class="da-card"><span>Price direction</span><strong id="daTrend">—</strong></div>
      <div class="da-card"><span>Momentum score</span><strong id="daMomentum">—</strong></div>
      <div class="da-card"><span>Volatility ratio</span><strong id="daVolatility">—</strong></div>
      <div class="da-card"><span>Digit distribution entropy</span><strong id="daEntropy">—</strong></div>
      <div class="da-card"><span>Hot digit / window consensus</span><strong id="daHot">—</strong></div>
      <div class="da-card"><span>Current digit streak</span><strong id="daStreak">—</strong></div>
      <div class="da-card"><span>Tick rate</span><strong id="daSpeed">—</strong></div>
    </div>
    <div class="da-head"><div><p class="da-kicker">CROSS-MARKET RADAR</p><h2>Condition leaderboard</h2></div><span class="da-muted">Ranked by measured market activity</span></div>
    <div class="da-table-wrap"><table><thead><tr><th>#</th><th>Market</th><th>Regime</th><th>Trend</th><th>Momentum</th><th>Volatility</th><th>Hot digit</th><th>Ticks</th><th>Condition score</th></tr></thead><tbody id="daRows"><tr><td colspan="9">Waiting for tick data…</td></tr></tbody></table></div>
    <p class="da-note">Momentum and regime labels describe recent price behaviour. Digit frequency, gaps and streaks are historical measurements, not forecasts. Condition score ranks activity for review, not the probability or profitability of a contract. Require out-of-sample validation before treating any pattern as an edge.</p>
  `;

  const scanner = document.getElementById("dspScannerPanel");
  const intelligence = document.getElementById("dspIntelligence");
  if (intelligence) intelligence.insertAdjacentElement("afterend", panel);
  else if (scanner) scanner.insertAdjacentElement("afterend", panel);
  else {
    const hero = document.querySelector(".hero");
    if (hero) hero.insertAdjacentElement("afterend", panel);
    else document.body.appendChild(panel);
  }

  const $ = id => document.getElementById(id);
  const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
  const std = values => {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(mean(values.map(v => (v-m)*(v-m))));
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  const tone = value => value === "Uptrend" ? "da-up" : value === "Downtrend" ? "da-down" : "da-neutral";

  function analyse(row) {
    const ticks = Array.isArray(row.ticks) ? row.ticks : [];
    const n = ticks.length;
    if (n < MIN_SAMPLE) return { ...row, regime:"Warming up", trend:"—", momentumScale:0, volRatio:0, hot:"—", entropy:0, streak:0, speed:0, condition:0, consensus:"—" };

    const changes = [];
    for (let i=1;i<n;i++) {
      const prev = Number(ticks[i-1].quote);
      const next = Number(ticks[i].quote);
      if (Number.isFinite(prev) && Number.isFinite(next) && prev !== 0) changes.push((next-prev)/Math.abs(prev)*100);
    }
    const recent = changes.slice(-20);
    const prior = changes.slice(-40,-20);
    const momentum = mean(recent);
    const baseVol = std(changes);
    const recentVol = std(recent);
    const volRatio = baseVol > 0 ? recentVol/baseVol : 0;
    const acceleration = mean(recent.slice(-10)) - mean(prior.slice(-10));
    const momentumScale = baseVol > 0 ? momentum/(baseVol/Math.sqrt(Math.max(1,recent.length))) : 0;
    const trend = momentumScale > 0.75 ? "Uptrend" : momentumScale < -0.75 ? "Downtrend" : "Sideways";
    let regime = "Balanced";
    if (n < 100) regime = "Building sample";
    else if (volRatio >= 1.5) regime = "High volatility";
    else if (volRatio <= 0.65 && baseVol > 0) regime = "Quiet";
    else if (Math.abs(momentumScale) >= 1.5) regime = "Trending";
    if (Math.abs(acceleration) > Math.max(baseVol,0.000001)*0.7 && Math.abs(momentumScale) > 0.5) regime = "Momentum shift";

    const counts = Array(10).fill(0);
    ticks.forEach(t => { const d=Number(t.digit); if (Number.isInteger(d)&&d>=0&&d<=9) counts[d]++; });
    const ranked = counts.map((count,digit)=>({count,digit})).sort((a,b)=>b.count-a.count||a.digit-b.digit);
    const probabilities = counts.map(c=>c/n).filter(p=>p>0);
    const entropy = probabilities.reduce((sum,p)=>sum-p*Math.log(p)/Math.log(10),0);
    let streak = 1;
    for (let i=n-1;i>0 && ticks[i].digit===ticks[i-1].digit;i--) streak++;
    const firstEpoch = Number(ticks[0]?.epoch);
    const lastEpoch = Number(ticks[n-1]?.epoch);
    const span = lastEpoch-firstEpoch;
    const speed = span>0 ? (n-1)*60/span : 0;
    const digitDeviation = Math.max(...counts.map(c=>Math.abs(c/n-0.1)));
    const windowLeaders = WINDOWS.filter(w=>n>=w).map(w=>{
      const local=Array(10).fill(0);
      ticks.slice(-w).forEach(t=>local[Number(t.digit)]++);
      return local.indexOf(Math.max(...local));
    });
    const consensusCount = windowLeaders.filter(d=>d===ranked[0].digit).length;
    const consensus = windowLeaders.length ? consensusCount+"/"+windowLeaders.length : "—";
    const condition = Math.min(100,Math.abs(momentumScale)*18 + Math.max(0,volRatio-1)*15 + Math.abs(acceleration)/(baseVol||1)*12 + digitDeviation*100);
    return { ...row, regime, trend, momentumScale, volRatio, hot:ranked[0].digit, entropy, streak, speed, condition, consensus };
  }

  function renderFocus(row) {
    if (!row) return;
    $("daSample").textContent = row.n + " live ticks · windows: " + WINDOWS.join("/");
    $("daRegime").textContent = row.regime;
    $("daTrend").textContent = row.trend;
    $("daTrend").className = tone(row.trend);
    $("daMomentum").textContent = Number.isFinite(row.momentumScale) ? row.momentumScale.toFixed(2) + "σ" : "—";
    $("daVolatility").textContent = row.volRatio ? row.volRatio.toFixed(2) + "×" : "—";
    $("daEntropy").textContent = Number.isFinite(row.entropy) ? (row.entropy*100).toFixed(0) + "% of max" : "—";
    $("daHot").textContent = row.hot + " · " + row.consensus;
    $("daStreak").textContent = row.streak;
    $("daSpeed").textContent = row.speed ? row.speed.toFixed(1) + " ticks/min" : "—";
  }

  function render() {
    const analysed = latestRows.map(analyse).sort((a,b)=>b.condition-a.condition);
    const select = $("daMarket");
    const current = selectedSymbol || select.value;
    const options = analysed.map(r=>({value:r.symbol,label:r.name+" ("+r.symbol+")"}));
    const signature = options.map(o=>o.value).join("|");
    if (select.dataset.signature !== signature) {
      select.replaceChildren();
      options.forEach(o=>select.add(new Option(o.label,o.value)));
      select.dataset.signature = signature;
    }
    if (!selectedSymbol && analysed.length) selectedSymbol = analysed[0].symbol;
    if (analysed.some(r=>r.symbol===current)) selectedSymbol=current;
    select.value = selectedSymbol;
    renderFocus(analysed.find(r=>r.symbol===selectedSymbol) || analysed[0]);

    $("daFeed").textContent = analysed.filter(r=>r.n>=MIN_SAMPLE).length + "/" + analysed.length + " markets analysed";
    const visible = analysed.filter(r=>r.n>0);
    $("daRows").innerHTML = visible.length ? visible.map((r,i)=>`
      <tr class="${r.symbol===selectedSymbol?"da-selected":""}">
        <td>${i+1}</td><td><button class="da-market" data-symbol="${escapeHtml(r.symbol)}">${escapeHtml(r.name)}</button><small>${escapeHtml(r.symbol)}</small></td>
        <td>${escapeHtml(r.regime)}</td><td class="${tone(r.trend)}">${escapeHtml(r.trend)}</td>
        <td>${Number.isFinite(r.momentumScale)?r.momentumScale.toFixed(2)+"σ":"—"}</td>
        <td>${r.volRatio?r.volRatio.toFixed(2)+"×":"—"}</td><td>${r.hot}</td><td>${r.n}</td><td>${r.condition.toFixed(1)}</td>
      </tr>`).join("") : '<tr><td colspan="9">Waiting for first ticks…</td></tr>';
  }

  $("daMarket").addEventListener("change",event=>{selectedSymbol=event.target.value;render();});
  $("daRows").addEventListener("click",event=>{
    const button=event.target.closest("[data-symbol]");
    if (!button) return;
    selectedSymbol=button.dataset.symbol;
    $("daMarket").value=selectedSymbol;
    render();
  });
  window.addEventListener("dsp:market-snapshot",event=>{
    latestRows=event.detail?.rows||[];
    render();
  });
})();
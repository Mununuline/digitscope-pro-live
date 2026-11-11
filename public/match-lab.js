(() => {
  "use strict";

  if (window.__dspMatchLabLoaded) return;
  window.__dspMatchLabLoaded = true;

  const LOOKBACK = 50;
  const OUTCOME_OFFSET = 2; // third tick after each forecast point
  const MAX_SAMPLE = 250;
  let rows = [];
  let selectedSymbol = "";

  const style = document.createElement("style");
  style.textContent = `
    #dspMatchLab{margin:14px 0;padding:20px;background:linear-gradient(145deg,rgba(17,31,47,.98),rgba(12,24,38,.98));border:1px solid #203249;border-radius:16px;color:#eaf2fb;box-shadow:0 12px 35px #0002}
    #dspMatchLab .dml-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
    #dspMatchLab h2{font-size:19px;margin:0}
    #dspMatchLab .dml-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
    #dspMatchLab .dml-badge{font-size:10px;color:#f4b86a;border:1px solid #76552b;border-radius:20px;padding:5px 9px;white-space:nowrap}
    #dspMatchLab .dml-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}
    #dspMatchLab label{display:block;color:#91a4b9;font-size:11px}
    #dspMatchLab select,#dspMatchLab input{display:block;width:100%;margin-top:5px;padding:10px;background:#091523;color:#eaf2fb;border:1px solid #2b4058;border-radius:8px;font:inherit;min-height:40px}
    #dspMatchLab .dml-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:7px;margin:14px 0}
    #dspMatchLab .dml-digit{background:#091523;border:1px solid #203249;border-radius:9px;padding:9px 3px;text-align:center}
    #dspMatchLab .dml-digit b{display:block;color:#52d6df;font-size:16px}
    #dspMatchLab .dml-digit span{display:block;color:#91a4b9;font-size:10px;margin-top:3px}
    #dspMatchLab .dml-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
    #dspMatchLab .dml-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:12px;min-width:0}
    #dspMatchLab .dml-card span{display:block;color:#91a4b9;font-size:10px}
    #dspMatchLab .dml-card strong{display:block;font-size:19px;margin-top:5px;overflow-wrap:anywhere}
    #dspMatchLab .dml-signal{padding:13px;background:#0a1725;border:1px solid #203249;border-radius:10px;margin:12px 0}
    #dspMatchLab .dml-signal strong{color:#67e0ad}
    #dspMatchLab .dml-risk{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #dspMatchLab .dml-note{font-size:11px;color:#91a4b9;line-height:1.55;margin:12px 0 0}
    #dspMatchLab .dml-divider{height:1px;background:#203249;margin:18px 0}
    @media(max-width:650px){#dspMatchLab{padding:15px}#dspMatchLab .dml-controls{grid-template-columns:1fr 1fr}#dspMatchLab .dml-summary{grid-template-columns:1fr 1fr}}
    @media(max-width:390px){#dspMatchLab .dml-grid{gap:3px}#dspMatchLab .dml-digit{padding:7px 1px}#dspMatchLab .dml-digit b{font-size:13px}#dspMatchLab .dml-digit span{font-size:8px}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspMatchLab";
  panel.innerHTML = `
    <div class="dml-head">
      <div><p class="dml-kicker">DERIV 3-TICK MATCH RESEARCH</p><h2>3-Tick Match Research Lab</h2></div>
      <span class="dml-badge">OBSERVATION ONLY</span>
    </div>
    <p id="dmlStatus" class="dml-note">Waiting for the scanner's live market samples…</p>
    <div class="dml-controls">
      <label>Market<select id="dmlMarket"><option value="">Waiting for markets…</option></select></label>
      <label>Research model<select id="dmlStrategy"><option value="cold">Mean reversion · coldest digit</option><option value="hot">Momentum · hottest digit</option></select></label>
      <label>Display window<select id="dmlWindow"><option value="50" selected>Last 50 ticks</option><option value="100">Last 100 ticks</option><option value="250">Last 250 ticks</option></select></label>
    </div>
    <p class="dml-kicker">LAST-DIGIT DISTRIBUTION</p>
    <div id="dmlDigits" class="dml-grid"></div>
    <div class="dml-summary">
      <div class="dml-card"><span>Latest 3 digits</span><strong id="dmlSequence">—</strong></div>
      <div class="dml-card"><span>Current model candidate</span><strong id="dmlCandidate">—</strong></div>
      <div class="dml-card"><span>3rd-tick hit rate</span><strong id="dmlRate">—</strong></div>
      <div class="dml-card"><span>95% Wilson interval</span><strong id="dmlInterval">—</strong></div>
    </div>
    <div class="dml-signal" id="dmlSignal">Collecting a 50-tick starting window…</div>
    <div class="dml-divider"></div>
    <p class="dml-kicker">3-TICK WALK-FORWARD REPLAY</p>
    <div class="dml-summary">
      <div class="dml-card"><span>Scored outcomes</span><strong id="dmlTested">0</strong></div>
      <div class="dml-card"><span>Hits</span><strong id="dmlHits">0</strong></div>
      <div class="dml-card"><span>Observed hit rate</span><strong id="dmlReplayRate">—</strong></div>
      <div class="dml-card"><span>10% random baseline</span><strong>10.0%</strong></div>
    </div>
    <p id="dmlReplayNote" class="dml-note">The replay waits for enough live observations. Each forecast uses the preceding 50 digits and is scored only against the third subsequent tick.</p>
    <div class="dml-divider"></div>
    <p class="dml-kicker">SESSION LOSS LIMIT CALCULATOR</p>
    <div class="dml-risk">
      <label>Reference bankroll<input id="dmlBankroll" type="number" min="0" step="0.01" value="500"></label>
      <label>Maximum loss (%)<input id="dmlStopPct" type="number" min="0" max="100" step="0.5" value="10"></label>
    </div>
    <div class="dml-card" style="margin-top:10px"><span>Maximum session loss budget (calculation only)</span><strong id="dmlLossBudget">$50.00</strong></div>
    <p class="dml-note">This panel does not connect a trading account, store API tokens, recommend a stake, submit orders, or execute trades. The loss-budget figure is arithmetic only, not a guarantee or a complete risk plan. The replay uses the scanner's rolling live sample (up to 250 ticks); overlapping forecasts and multiple markets can make results look more convincing than they are. This is descriptive research, not evidence of a profitable trading edge.</p>
  `;

  const scannerPanel = document.getElementById("dspScannerPanel");
  const intelligencePanel = document.getElementById("dspValidation");
  if (intelligencePanel) intelligencePanel.insertAdjacentElement("afterend", panel);
  else if (scannerPanel) scannerPanel.insertAdjacentElement("afterend", panel);
  else document.querySelector("main")?.appendChild(panel);

  const $ = id => document.getElementById(id);
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + "%" : "—";
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function wilson(hits, tested) {
    if (!tested) return null;
    const z = 1.96, p = hits / tested, z2 = z * z;
    const den = 1 + z2 / tested;
    const center = (p + z2 / (2 * tested)) / den;
    const margin = z * Math.sqrt(p * (1-p) / tested + z2 / (4 * tested * tested)) / den;
    return [Math.max(0, center-margin), Math.min(1, center+margin)];
  }

  function chooseDigit(digits, mode) {
    const counts = Array(10).fill(0);
    digits.forEach(d => { if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d] += 1; });
    const targetCount = mode === "cold" ? Math.min(...counts) : Math.max(...counts);
    return counts.indexOf(targetCount);
  }

  function replay(digits, mode) {
    let tested = 0, hits = 0;
    for (let i = LOOKBACK; i + OUTCOME_OFFSET < digits.length; i += 1) {
      const target = chooseDigit(digits.slice(i - LOOKBACK, i), mode);
      const outcome = digits[i + OUTCOME_OFFSET];
      tested += 1;
      if (target === outcome) hits += 1;
    }
    return { tested, hits };
  }

  function updateLossBudget() {
    const bankroll = Number($("dmlBankroll").value);
    const stopPct = Number($("dmlStopPct").value);
    const valid = Number.isFinite(bankroll) && bankroll >= 0 &&
      Number.isFinite(stopPct) && stopPct >= 0 && stopPct <= 100;
    $("dmlLossBudget").textContent = valid
      ? "$" + (bankroll * stopPct / 100).toFixed(2)
      : "Check inputs";
  }

  function populateMarkets() {
    const select = $("dmlMarket");
    const available = rows.filter(row => row.symbol);
    const old = selectedSymbol || select.value;
    select.replaceChildren();
    available.forEach(row => select.add(new Option(row.name + " (" + row.symbol + ")", row.symbol)));
    if (!available.length) {
      select.add(new Option("Waiting for markets…", ""));
      return;
    }
    selectedSymbol = available.some(row => row.symbol === old) ? old : available[0].symbol;
    select.value = selectedSymbol;
  }

  function render() {
    const market = rows.find(row => row.symbol === selectedSymbol);
    if (!market || !Array.isArray(market.digits)) {
      $("dmlStatus").textContent = "Waiting for the selected market's live digit samples…";
      return;
    }

    const digits = market.digits.filter(d => Number.isInteger(d) && d >= 0 && d <= 9).slice(-MAX_SAMPLE);
    const mode = $("dmlStrategy").value;
    const windowSize = Number($("dmlWindow").value);
    const visible = digits.slice(-windowSize);
    const counts = Array(10).fill(0);
    visible.forEach(d => counts[d] += 1);
    $("dmlDigits").innerHTML = counts.map((count, digit) =>
      '<div class="dml-digit"><b>' + digit + '</b><span>' + count + ' · ' + pct(count, visible.length) + '</span></div>'
    ).join("");

    $("dmlStatus").textContent = market.name + " · " + visible.length + " of " + windowSize +
      " displayed ticks · live sample " + digits.length + "/" + MAX_SAMPLE;
    $("dmlSequence").textContent = digits.length >= 3 ? digits.slice(-3).join(" · ") : "Collecting";
    const candidate = digits.length >= LOOKBACK
      ? chooseDigit(digits.slice(-LOOKBACK), mode) : null;
    $("dmlCandidate").textContent = candidate === null ? "Warming up" : String(candidate);

    if (candidate === null) {
      $("dmlSignal").textContent = "Collecting a 50-tick starting window before displaying a research candidate.";
    } else {
      const recentCounts = Array(10).fill(0);
      digits.slice(-LOOKBACK).forEach(d => recentCounts[d] += 1);
      const frequency = recentCounts[candidate] / LOOKBACK * 100;
      const thresholdMet = mode === "cold" ? frequency < 7 : frequency > 18;
      const label = mode === "cold" ? "Coldest digit" : "Hottest digit";
      $("dmlSignal").innerHTML = "<strong>" + label + " to observe: " + candidate + "</strong> · " +
        frequency.toFixed(1) + "% of the preceding " + LOOKBACK + " ticks. " +
        (thresholdMet ? "The selected descriptive threshold is met." : "The selected descriptive threshold is not met; continue observing.") +
        " This is not a next-tick prediction or a trade instruction.";
    }

    const result = replay(digits, mode);
    const interval = wilson(result.hits, result.tested);
    $("dmlTested").textContent = result.tested.toLocaleString();
    $("dmlHits").textContent = result.hits.toLocaleString();
    $("dmlReplayRate").textContent = pct(result.hits, result.tested);
    $("dmlRate").textContent = pct(result.hits, result.tested);
    $("dmlInterval").textContent = interval
      ? (interval[0] * 100).toFixed(1) + "–" + (interval[1] * 100).toFixed(1) + "%"
      : "—";
    $("dmlReplayNote").textContent = result.tested
      ? "Rolling-sample replay: " + result.tested + " forecasts scored on the third subsequent tick; " +
        result.hits + " matched. 10% is the nominal random-digit baseline. The 95% Wilson interval describes sampling uncertainty, not model validity."
      : "At least 53 live digits are needed before the first third-tick outcome can be scored.";
    updateLossBudget();
  }

  window.addEventListener("dsp:market-snapshot", event => {
    rows = event.detail?.rows || [];
    const prior = selectedSymbol;
    populateMarkets();
    if (prior && rows.some(row => row.symbol === prior)) selectedSymbol = prior;
    $("dmlMarket").value = selectedSymbol;
    render();
  });

  $("dmlMarket").addEventListener("change", event => {
    selectedSymbol = event.target.value;
    render();
  });
  $("dmlStrategy").addEventListener("change", render);
  $("dmlWindow").addEventListener("change", render);
  $("dmlBankroll").addEventListener("input", updateLossBudget);
  $("dmlStopPct").addEventListener("input", updateLossBudget);
  updateLossBudget();
})();
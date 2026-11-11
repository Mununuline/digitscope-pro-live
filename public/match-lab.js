(() => {
  "use strict";

  if (window.__dspMatchLabLoaded) return;
  window.__dspMatchLabLoaded = true;

  const HORIZON = 3;
  const MAX_SAMPLE = 250;
  let rows = [];
  let selectedSymbol = "";

  const style = document.createElement("style");
  style.textContent = `
    #dspMatchLab{margin:14px 0;padding:20px;background:linear-gradient(145deg,rgba(17,31,47,.98),rgba(12,24,38,.98));border:1px solid #203249;border-radius:16px;color:#eaf2fb;box-shadow:0 12px 35px #0002}
    #dspMatchLab .dml-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
    #dspMatchLab h2{font-size:19px;margin:0}
    #dspMatchLab .dml-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    #dspMatchLab .dml-badge{font-size:10px;color:#f4b86a;border:1px solid #76552b;border-radius:20px;padding:5px 9px;white-space:nowrap}
    #dspMatchLab .dml-controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
    #dspMatchLab label{display:block;color:#91a4b9;font-size:11px}
    #dspMatchLab select{display:block;width:100%;margin-top:5px;padding:10px;background:#091523;color:#eaf2fb;border:1px solid #2b4058;border-radius:8px;font:inherit;min-height:40px}
    #dspMatchLab .dml-grid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:7px;margin:14px 0}
    #dspMatchLab .dml-digit{background:#091523;border:1px solid #203249;border-radius:9px;padding:9px 3px;text-align:center}
    #dspMatchLab .dml-digit b{display:block;color:#52d6df;font-size:16px}
    #dspMatchLab .dml-digit span{display:block;color:#91a4b9;font-size:10px;margin-top:3px}
    #dspMatchLab .dml-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
    #dspMatchLab .dml-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:12px;min-width:0}
    #dspMatchLab .dml-card span{display:block;color:#91a4b9;font-size:10px}
    #dspMatchLab .dml-card strong{display:block;font-size:19px;margin-top:5px;overflow-wrap:anywhere}
    #dspMatchLab .dml-signal{padding:13px;background:#0a1725;border:1px solid #203249;border-radius:10px;margin:12px 0;line-height:1.55}
    #dspMatchLab .dml-signal strong{color:#67e0ad}
    #dspMatchLab .dml-note{font-size:11px;color:#91a4b9;line-height:1.55;margin:12px 0 0}
    #dspMatchLab .dml-divider{height:1px;background:#203249;margin:18px 0}
    #dspMatchLab .dml-positive{color:#67e0ad}#dspMatchLab .dml-caution{color:#f4b86a}
    @media(max-width:720px){#dspMatchLab{padding:15px}#dspMatchLab .dml-controls{grid-template-columns:1fr 1fr}#dspMatchLab .dml-summary{grid-template-columns:1fr 1fr}}
    @media(max-width:390px){#dspMatchLab .dml-grid{gap:3px}#dspMatchLab .dml-digit{padding:7px 1px}#dspMatchLab .dml-digit b{font-size:13px}#dspMatchLab .dml-digit span{font-size:8px}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspMatchLab";
  panel.innerHTML = `
    <div class="dml-head">
      <div><p class="dml-kicker">DERIV EXACT-DIGIT · THIRD-TICK RESEARCH</p><h2>3-Tick MATCH / DIFFERS Analyzer</h2></div>
      <span class="dml-badge">READ-ONLY · NO ORDERS</span>
    </div>
    <p id="dmlStatus" class="dml-note">Waiting for the scanner's live market samples…</p>
    <div class="dml-controls">
      <label>Market<select id="dmlMarket"><option value="">Waiting for markets…</option></select></label>
      <label>Contract<select id="dmlContract"><option value="MATCH">DIGIT MATCH</option><option value="DIFFERS">DIGIT DIFFERS</option></select></label>
      <label>Digit model<select id="dmlStrategy"><option value="cold">Coldest digit</option><option value="hot">Hottest digit</option></select></label>
      <label>Training window<select id="dmlWindow"><option value="50">Previous 50 ticks</option><option value="100" selected>Previous 100 ticks</option><option value="250">Previous 250 ticks</option></select></label>
    </div>
    <p class="dml-kicker">LIVE DIGIT DISTRIBUTION</p>
    <div id="dmlDigits" class="dml-grid"></div>
    <div class="dml-summary">
      <div class="dml-card"><span>Latest 3 digits</span><strong id="dmlSequence">—</strong></div>
      <div class="dml-card"><span>Selected barrier digit</span><strong id="dmlCandidate">—</strong></div>
      <div class="dml-card"><span>Estimated contract chance</span><strong id="dmlProbability">—</strong></div>
      <div class="dml-card"><span>Fair baseline</span><strong id="dmlBaseline">—</strong></div>
    </div>
    <div class="dml-signal" id="dmlSignal">Collecting enough live ticks for a training window…</div>
    <div class="dml-divider"></div>
    <p class="dml-kicker">THIRD-SUBSEQUENT-TICK WALK-FORWARD VALIDATION</p>
    <div class="dml-summary">
      <div class="dml-card"><span>Settled forecasts</span><strong id="dmlTested">0</strong></div>
      <div class="dml-card"><span>Winning outcomes</span><strong id="dmlHits">0</strong></div>
      <div class="dml-card"><span>Observed win rate</span><strong id="dmlReplayRate">—</strong></div>
      <div class="dml-card"><span>Brier skill vs fair baseline</span><strong id="dmlBrierSkill">—</strong></div>
    </div>
    <p id="dmlReplayNote" class="dml-note">Each historical forecast uses only the selected number of preceding ticks and is scored on the third subsequent tick. No training-window tick is counted as an outcome.</p>
    <p class="dml-note">MATCH baseline: 10%. DIFFERS baseline: 90%, assuming independent uniform digits. Brier skill compares the probability estimates with the corresponding fair baseline; positive is better, zero is equal, and negative is worse. The 95% Wilson interval is descriptive and does not correct for overlapping forecasts or repeated model selection.</p>
    <p class="dml-note">This is a research analyzer, not a prediction guarantee or trading instruction. Historical digit imbalance can occur by chance. Results are session-only, depend on the scanner's rolling sample, and reset when the page is refreshed. No account connection, API token, proposal, or buy request is used.</p>
  `;

  const scannerPanel = document.getElementById("dspScannerPanel");
  const intelligencePanel = document.getElementById("dspValidation");
  if (intelligencePanel) intelligencePanel.insertAdjacentElement("afterend", panel);
  else if (scannerPanel) scannerPanel.insertAdjacentElement("afterend", panel);
  else document.querySelector("main")?.appendChild(panel);

  const $ = id => document.getElementById(id);
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + "%" : "—";
  const safe = value => String(value).replace(/[&<>"']/g, ch => ({
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

  function countDigits(digits) {
    const counts = Array(10).fill(0);
    digits.forEach(digit => { if (Number.isInteger(digit) && digit >= 0 && digit <= 9) counts[digit] += 1; });
    return counts;
  }

  function chooseDigit(digits, mode) {
    const counts = countDigits(digits);
    const target = mode === "cold" ? Math.min(...counts) : Math.max(...counts);
    const tied = counts.map((count, digit) => ({ count, digit })).filter(item => item.count === target);
    // Deterministic tie-break: most recently observed tied digit.
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      const found = tied.find(item => item.digit === digits[i]);
      if (found) return found.digit;
    }
    return tied.length ? tied[0].digit : null;
  }

  function eventProbability(digits, target, contract) {
    const counts = countDigits(digits);
    const matchProbability = digits.length ? counts[target] / digits.length : 0.1;
    return contract === "MATCH" ? matchProbability : 1 - matchProbability;
  }

  function replay(digits, windowSize, mode, contract) {
    let tested = 0, hits = 0, brier = 0, baselineBrier = 0, probabilityTotal = 0;
    const baseline = contract === "MATCH" ? 0.1 : 0.9;
    for (let i = windowSize; i + (HORIZON - 1) < digits.length; i += 1) {
      const training = digits.slice(i - windowSize, i);
      const target = chooseDigit(training, mode);
      const p = eventProbability(training, target, contract);
      const outcomeDigit = digits[i + HORIZON - 1];
      const won = contract === "MATCH" ? outcomeDigit === target : outcomeDigit !== target;
      const actual = won ? 1 : 0;
      tested += 1;
      if (won) hits += 1;
      probabilityTotal += p;
      brier += Math.pow(p - actual, 2);
      baselineBrier += Math.pow(baseline - actual, 2);
    }
    return { tested, hits, brier, baselineBrier, probabilityTotal, baseline };
  }

  function populateMarkets() {
    const select = $("dmlMarket");
    const available = rows.filter(row => row.symbol);
    const previous = selectedSymbol || select.value;
    select.replaceChildren();
    available.forEach(row => select.add(new Option(row.name + " (" + row.symbol + ")", row.symbol)));
    if (!available.length) {
      select.add(new Option("Waiting for markets…", ""));
      selectedSymbol = "";
      return;
    }
    selectedSymbol = available.some(row => row.symbol === previous) ? previous : available[0].symbol;
    select.value = selectedSymbol;
  }

  function render() {
    const market = rows.find(row => row.symbol === selectedSymbol);
    if (!market || !Array.isArray(market.digits)) {
      $("dmlStatus").textContent = "Waiting for the selected market's live digit samples…";
      return;
    }

    const digits = market.digits.filter(d => Number.isInteger(d) && d >= 0 && d <= 9).slice(-MAX_SAMPLE);
    const windowSize = Number($("dmlWindow").value);
    const mode = $("dmlStrategy").value;
    const contract = $("dmlContract").value;
    const baseline = contract === "MATCH" ? 0.1 : 0.9;
    const visible = digits.slice(-windowSize);
    const counts = countDigits(visible);
    $("dmlDigits").innerHTML = counts.map((count, digit) =>
      '<div class="dml-digit"><b>' + digit + '</b><span>' + count + ' · ' + pct(count, visible.length) + '</span></div>'
    ).join("");

    $("dmlStatus").textContent = market.name + " · " + visible.length + " / " + windowSize +
      " training ticks · live rolling sample " + digits.length + " / " + MAX_SAMPLE;
    $("dmlSequence").textContent = digits.length >= 3 ? digits.slice(-3).join(" · ") : "Collecting";

    const training = digits.slice(-windowSize);
    const ready = training.length === windowSize;
    const target = ready ? chooseDigit(training, mode) : null;
    const probability = ready ? eventProbability(training, target, contract) : null;
    $("dmlCandidate").textContent = target === null ? "Warming up" : String(target);
    $("dmlProbability").textContent = probability === null ? "—" : pct(probability, 1);
    $("dmlBaseline").textContent = pct(baseline, 1);

    if (target === null) {
      $("dmlSignal").textContent = "Collecting " + windowSize + " live ticks before generating a research candidate.";
    } else {
      const targetRate = counts[target] / windowSize;
      const contractLabel = contract === "MATCH" ? "MATCH " + target : "DIFFERS " + target;
      $("dmlSignal").innerHTML = "<strong>Research candidate: " + contractLabel + "</strong> · " +
        "Selected by the " + (mode === "cold" ? "coldest-digit" : "hottest-digit") + " model. " +
        "The selected digit appeared in " + (100 * targetRate).toFixed(1) + "% of the preceding " +
        windowSize + " ticks. Estimated event chance: " + pct(probability, 1) +
        " versus a " + pct(baseline, 1) + " fair baseline. This is a historical-frequency estimate, not a calibrated forecast.";
    }

    const result = replay(digits, windowSize, mode, contract);
    const interval = wilson(result.hits, result.tested);
    const skill = result.tested && result.baselineBrier > 0
      ? 1 - result.brier / result.baselineBrier : null;
    $("dmlTested").textContent = result.tested.toLocaleString();
    $("dmlHits").textContent = result.hits.toLocaleString();
    $("dmlReplayRate").textContent = pct(result.hits, result.tested);
    $("dmlBrierSkill").textContent = skill === null ? "—" : (skill >= 0 ? "+" : "") + (100 * skill).toFixed(1) + "%";
    $("dmlBrierSkill").className = skill !== null && skill > 0 ? "dml-positive" : "dml-caution";
    $("dmlReplayNote").textContent = result.tested
      ? result.tested + " walk-forward forecasts · " + result.hits + " wins · average estimated chance " +
        pct(result.probabilityTotal, result.tested) + " · observed " + pct(result.hits, result.tested) +
        " · 95% Wilson interval " + (interval[0] * 100).toFixed(1) + "–" + (interval[1] * 100).toFixed(1) +
        "%. Each outcome is exactly the third tick after its forecast origin."
      : "Need at least " + (windowSize + HORIZON) + " live observations to score the first forecast at this training-window size.";
  }

  window.addEventListener("dsp:market-snapshot", event => {
    rows = event.detail?.rows || [];
    populateMarkets();
    $("dmlMarket").value = selectedSymbol;
    render();
  });

  $("dmlMarket").addEventListener("change", event => { selectedSymbol = event.target.value; render(); });
  $("dmlContract").addEventListener("change", render);
  $("dmlStrategy").addEventListener("change", render);
  $("dmlWindow").addEventListener("change", render);
})();

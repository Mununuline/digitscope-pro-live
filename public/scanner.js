(() => {
  "use strict";
  if (window.__digitScopeScannerLoaded) return;
  window.__digitScopeScannerLoaded = true;

  const WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
  const MAX_TICKS = 1000;
  const MIN_SAMPLE = 300;
  let ws = null;
  let markets = [];
  let samples = Object.create(null);
  let subscriptionIds = new Set();
  let reconnectTimer = null;
  let renderTimer = null;
  let requestId = 700;

  const nextId = () => ++requestId;
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  function installPanel() {
    if (document.getElementById("dspScannerPanel")) return;
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const style = document.createElement("style");
    style.textContent = `
      #dspScannerPanel{margin:14px 0;padding:20px;background:linear-gradient(145deg,rgba(17,31,47,.98),rgba(12,24,38,.98));border:1px solid #203249;border-radius:16px;box-shadow:0 12px 35px #0002;color:#eaf2fb}
      #dspScannerPanel .dsp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
      #dspScannerPanel .dsp-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
      #dspScannerPanel h2{font-size:19px;margin:0}
      #dspScannerPanel .dsp-tag{font-size:10px;color:#f4b86a;border:1px solid #76552b;border-radius:20px;padding:5px 9px;white-space:nowrap}
      #dspScannerStatus{font-size:12px;color:#91a4b9;margin:10px 0 14px}
      #dspScannerPanel .dsp-table-wrap{width:100%;overflow-x:auto}
      #dspScannerPanel table{width:100%;border-collapse:collapse;min-width:760px;font-size:12px}
      #dspScannerPanel th,#dspScannerPanel td{padding:10px 9px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
      #dspScannerPanel th{color:#91a4b9;font-size:10px;text-transform:uppercase;letter-spacing:.7px}
      #dspScannerPanel td small{display:block;color:#91a4b9;font-size:10px}
      #dspScannerPanel .dsp-market{border:0;background:none;color:#52d6df;font:inherit;font-weight:700;padding:0;text-align:left;cursor:pointer}
      #dspScannerPanel .dsp-market:hover{text-decoration:underline}
      #dspScannerPanel .dsp-note{font-size:11px;color:#91a4b9;margin:14px 0 0}
      #dspScannerPanel .dsp-good{color:#67e0ad}
      @media(max-width:600px){#dspScannerPanel{padding:15px;margin:12px 0}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "dspScannerPanel";
    panel.innerHTML = `
      <div class="dsp-head">
        <div><p class="dsp-kicker">MULTI-MARKET RADAR</p><h2>DigitScope Pro Scanner</h2></div>
        <span class="dsp-tag">LIVE RANKING</span>
      </div>
      <p id="dspScannerStatus">Connecting to Deriv market feed…</p>
      <div class="dsp-table-wrap">
        <table>
          <thead><tr><th>#</th><th>Market</th><th>Last</th><th>Hot</th><th>Cold</th><th>Ticks</th><th>Deviation</th><th>State</th></tr></thead>
          <tbody id="dspScannerRows"><tr><td colspan="8">Waiting for market list…</td></tr></tbody>
        </table>
      </div>
      <p class="dsp-note">Ranking uses the chi-square deviation of the latest 1,000 digits from an even 0–9 distribution. A higher score means a more uneven recent sample, not a prediction or proven trading edge. Markets enter the ranking after 300 live ticks.</p>
    `;
    hero.insertAdjacentElement("afterend", panel);
  }

  function status(message, good = false) {
    const el = document.getElementById("dspScannerStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("dsp-good", good);
  }

  function isVolatility(item) {
    const name = String(item.display_name || item.underlying_symbol_name || item.name || "");
    const symbol = String(item.symbol || item.underlying_symbol || "");
    return /volatility/i.test(name) || /^R_\d+$/i.test(symbol) || /^1HZ\d+V$/i.test(symbol);
  }

  function openConnection() {
    clearTimeout(reconnectTimer);
    try {
      ws = new WebSocket(WS_URL);
    } catch (error) {
      status("Could not open scanner connection. Retrying…");
      reconnectTimer = setTimeout(openConnection, 4000);
      return;
    }

    ws.onopen = () => {
      status("Connected. Discovering all Volatility indices…", true);
      ws.send(JSON.stringify({ active_symbols: "brief", req_id: nextId() }));
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.error) {
        status("Deriv scanner error: " + (data.error.message || data.error.code || "Unknown error"));
        return;
      }

      if (data.msg_type === "active_symbols" || Array.isArray(data.active_symbols)) {
        const list = Array.isArray(data.active_symbols) ? data.active_symbols : [];
        markets = list.filter(isVolatility).map(item => ({
          symbol: item.symbol || item.underlying_symbol,
          name: item.display_name || item.underlying_symbol_name || item.name || item.symbol
        })).filter(item => item.symbol);

        markets.sort((a,b) => a.name.localeCompare(b.name));
        samples = Object.create(null);
        draw();

        if (!markets.length) {
          status("No Volatility indices were returned by Deriv. Check the active-symbol response.");
          return;
        }

        status("Found " + markets.length + " Volatility markets. Subscribing to each market…", true);
        // Subscribe separately so ticks without tick.symbol can be routed by echo_req.ticks.
        markets.forEach(item => {
          ws.send(JSON.stringify({ ticks: item.symbol, subscribe: 1, req_id: nextId() }));
        });
        return;
      }

      if (data.msg_type === "tick" || data.tick) {
        receiveTick(data.tick, data.subscription, data.echo_req);
      }
    };

    ws.onerror = () => status("Scanner connection error. Retrying…");
    ws.onclose = () => {
      subscriptionIds.clear();
      status("Scanner disconnected. Reconnecting…");
      reconnectTimer = setTimeout(openConnection, 3000);
    };
  }

  function receiveTick(tick, subscription, echoReq) {
    if (!tick || !Number.isFinite(Number(tick.quote))) return;
    if (subscription && subscription.id) subscriptionIds.add(subscription.id);

    const routedSymbol = tick.symbol || (typeof echoReq?.ticks === "string" ? echoReq.ticks : "");
    if (!routedSymbol) return;
    const symbol = String(routedSymbol);
    if (!markets.some(item => item.symbol === symbol)) return;

    const precision = Number.isInteger(Number(tick.pip_size)) ? Number(tick.pip_size) : 2;
    const fixed = Number(tick.quote).toFixed(Math.max(0, Math.min(10, precision)));
    const last = fixed.replace(".", "").replace("-", "").slice(-1);
    if (!/^\d$/.test(last)) return;

    const list = samples[symbol] || (samples[symbol] = []);
    const epoch = Number(tick.epoch) || 0;
    const quote = Number(tick.quote);
    const previous = list[list.length - 1];
    if (previous && previous.epoch === epoch && previous.quote === quote) return;
    list.push({ digit: Number(last), epoch, quote });
    if (list.length > MAX_TICKS) list.shift();

    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        draw();
      }, 350);
    }
  }

  function draw() {
    const rows = markets.map(market => {
      const ticks = samples[market.symbol] || [];
      const counts = Array(10).fill(0);
      ticks.forEach(tick => counts[tick.digit]++);
      const ranked = counts.map((count, digit) => ({ count, digit }))
        .sort((a,b) => b.count - a.count || a.digit - b.digit);
      const n = ticks.length;
      const expected = n / 10;
      const score = n >= MIN_SAMPLE
        ? counts.reduce((sum,count) => sum + Math.pow(count - expected, 2) / Math.max(expected, 0.001), 0)
        : null;
      return {
        ...market, n, counts: counts.slice(), last: n ? ticks[n-1].digit : "—",
        hot: n ? ranked[0].digit : "—",
        cold: n ? ranked[9].digit : "—",
        score
      };
    }).sort((a,b) => {
      if (a.score === null && b.score !== null) return 1;
      if (a.score !== null && b.score === null) return -1;
      return (b.score ?? -1) - (a.score ?? -1);
    });

    const qualified = rows.filter(row => row.score !== null).length;
    if (markets.length) {
      status(subscriptionIds.size
        ? "Live scanner running · " + qualified + "/" + rows.length + " markets ranked"
        : "Receiving market list · waiting for first live ticks", subscriptionIds.size > 0);
    }

    const tbody = document.getElementById("dspScannerRows");
    if (!tbody) return;
    tbody.innerHTML = rows.map((row,index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.name)}<small>${escapeHtml(row.symbol)}</small></td>
        <td>${row.last}</td><td>${row.hot}</td><td>${row.cold}</td>
        <td>${row.n}</td><td>${row.score === null ? "Warming up" : row.score.toFixed(1)}</td>
        <td>${row.score === null ? "Need " + (MIN_SAMPLE-row.n) + " ticks" : "Ranked"}</td>
      </tr>
    `).join("");
    window.dispatchEvent(new CustomEvent("dsp:market-snapshot", {
  detail: {
    rows: rows.map(row => ({
      symbol: row.symbol,
      name: row.name,
      n: row.n,
      counts: row.counts.slice(),
      lastDigit: row.last,
      lastEpoch: n ? ticks[n-1].epoch : 0,
      recentTicks: ticks.slice(-5).map(tick => ({ digit: tick.digit, epoch: tick.epoch }))
    }))
  }
}));
  }

  installPanel();
  openConnection();
})();

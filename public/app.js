(() => {
  "use strict";

  const WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
  const $ = (id) => document.getElementById(id);
  const state = {
    ws: null, symbols: [], ticks: [], currentSymbol: "", pipSize: 2,
    reconnectTimer: null, intentionalClose: false, requestId: 10,
    historyRequestId: null, tickSubscriptionId: null, evalHits: 0,
    evalCount: 0, lastTickEpoch: null, connectAttempts: 0,
    symbolsRequestId: null
  };

  const numberOf = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  // Deriv pip_size represents decimal places, e.g. 2 means two decimals.
  function precisionOf(value, fallback = 2) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 10 ? n : fallback;
  }

  function setConnection(status, message) {
    $("connectionDot").classList.toggle("online", status === "online");
    $("connectionDot").classList.toggle("offline", status === "offline");
    $("connectionText").textContent = message;
    $("feedStatus").textContent =
      status === "online" ? "Live" : status === "connecting" ? "Connecting" : "Offline";
  }

  function showError(message) {
    const box = $("errorBox");
    box.hidden = false;
    box.textContent = message;
  }

  function clearError() {
    $("errorBox").hidden = true;
    $("errorBox").textContent = "";
  }

  function send(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function nextRequestId() {
    state.requestId += 1;
    return state.requestId;
  }

  function requestSymbols() {
    if (state.symbolsRequestId !== null) return;
    state.symbolsRequestId = nextRequestId();
    if (!send({
      active_symbols: "brief",
      product_type: "basic",
      req_id: state.symbolsRequestId
    })) {
      state.symbolsRequestId = null;
    }
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    state.intentionalClose = false;
    setConnection("connecting", "Connecting to Deriv public market data…");

    try {
      state.ws = new WebSocket(WS_URL);
    } catch {
      showError("Could not start the market connection. Check your browser and internet connection.");
      scheduleReconnect();
      return;
    }

    state.ws.onopen = () => {
      state.connectAttempts = 0;
      state.symbolsRequestId = null;
      clearError();
      setConnection("online", "Connected to Deriv public feed");
      requestSymbols();
    };

    state.ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.error) {
        const message = data.error.message || data.error.code || "Deriv returned an API error.";
        showError(`Deriv API error: ${message}`);
        if (data.echo_req?.active_symbols) {
          state.symbolsRequestId = null;
          $("marketCount").textContent = "Market list request failed";
        }
        if (data.echo_req?.ticks_history) $("sampleNote").textContent = "History request failed";
        return;
      }

      if (data.msg_type === "active_symbols" || Array.isArray(data.active_symbols)) {
        state.symbolsRequestId = null;
        handleSymbols(Array.isArray(data.active_symbols) ? data.active_symbols : []);
      } else if (data.msg_type === "history" || data.history?.prices) {
        handleHistory(data);
      } else if (data.msg_type === "tick" || data.tick) {
        handleTick(data.tick, data.subscription, data.echo_req);
      }
    };

    state.ws.onerror = () => {
      setConnection("offline", "Market feed connection error");
      showError("The Deriv feed connection encountered an error. The dashboard will try to reconnect.");
    };

    state.ws.onclose = () => {
      setConnection("offline", "Disconnected. Reconnecting…");
      state.symbolsRequestId = null;
      state.tickSubscriptionId = null;
      if (!state.intentionalClose) scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (state.intentionalClose || state.reconnectTimer) return;
    state.connectAttempts += 1;
    const delay = Math.min(15000, 1500 * Math.pow(1.6, Math.min(state.connectAttempts, 6)));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  // Support both legacy and newer Deriv symbol field names.
  function normalizeSymbol(item) {
    const symbol = item.symbol || item.underlying_symbol || "";
    const displayName = item.display_name || item.underlying_symbol_name ||
      item.name || symbol;
    return { ...item, symbol, display_name: displayName };
  }

  function isSyntheticSymbol(raw) {
    const item = normalizeSymbol(raw);
    const name = String(item.display_name || "");
    const market = String(item.market || "");
    const submarket = String(item.submarket || "");
    const subgroup = String(item.subgroup || "");
    const symbol = String(item.symbol || "");
    return /synthetic|derived/i.test(`${market} ${submarket} ${subgroup}`) ||
      /volatility|crash|boom|step|jump|range break|drift/i.test(name) ||
      /^(R_|1HZ|JD|CRASH|BOOM|STPRNG)/i.test(symbol);
  }

  function handleSymbols(list) {
    const normalized = list.map(normalizeSymbol).filter((item) => item.symbol);
    const synthetic = normalized.filter(isSyntheticSymbol);
    // If category metadata is absent, don't leave the selector blank.
    state.symbols = (synthetic.length ? synthetic : normalized).sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    );

    const select = $("symbolSelect");
    const previous = state.currentSymbol;
    select.replaceChildren();

    if (!state.symbols.length) {
      select.add(new Option("No markets returned", ""));
      $("marketCount").textContent = "0 markets returned";
      showError("Deriv replied with an empty active-symbol list. Check the API response or try again shortly.");
      return;
    }

    state.symbols.forEach((item) => {
      select.add(new Option(item.display_name, item.symbol));
    });

    const preferred = state.symbols.find((item) => item.symbol === previous) ||
      state.symbols.find((item) => /volatility 100/i.test(item.display_name)) ||
      state.symbols.find((item) => /volatility 75/i.test(item.display_name)) ||
      state.symbols[0];

    select.value = preferred.symbol;
    $("marketCount").textContent = `${state.symbols.length} markets available`;
    clearError();
    chooseSymbol(preferred.symbol);
  }

  function forgetCurrentSubscription() {
    if (state.tickSubscriptionId) {
      send({ forget: state.tickSubscriptionId, req_id: nextRequestId() });
      state.tickSubscriptionId = null;
    }
  }

  function chooseSymbol(symbol) {
    if (!symbol) return;
    state.currentSymbol = symbol;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      $("sampleNote").textContent = "Waiting for Deriv connection…";
      return;
    }

    forgetCurrentSubscription();
    state.ticks = [];
    state.evalHits = 0;
    state.evalCount = 0;
    state.lastTickEpoch = null;
    state.historyRequestId = nextRequestId();

    $("latestQuote").textContent = "—";
    $("latestDigit").textContent = "—";
    $("latestTime").textContent = "Waiting for first tick";
    $("sampleNote").textContent = "Loading historical ticks…";
    $("digitBars").replaceChildren();
    $("marketLabel").textContent = $("symbolSelect").selectedOptions[0]?.text || symbol;
    renderEmpty();

    const historySent = send({
      ticks_history: symbol,
      count: Number($("windowSelect").value),
      end: "latest",
      style: "ticks",
      req_id: state.historyRequestId
    });
    const ticksSent = send({ ticks: symbol, subscribe: 1, req_id: nextRequestId() });
    if (!historySent || !ticksSent) {
      showError("The market was selected, but its data request could not be sent. Reconnecting…");
    }
  }

  function getDigit(quote, precision) {
    const places = precisionOf(precision, 2);
    const fixed = numberOf(quote).toFixed(places);
    const last = fixed.replace(".", "").replace("-", "").slice(-1);
    return /^\d$/.test(last) ? Number(last) : null;
  }

  function makeTick(quote, epoch, precision) {
    const value = numberOf(quote, NaN);
    if (!Number.isFinite(value)) return null;
    const digit = getDigit(value, precision);
    if (digit === null) return null;
    return { quote: value, epoch: numberOf(epoch, 0), digit };
  }

  function sortedUniqueTicks(items) {
    const byKey = new Map();
    items.forEach((item) => {
      if (!item) return;
      const key = item.epoch ? `${item.epoch}:${item.quote}` : `noepoch:${item.quote}`;
      byKey.set(key, item);
    });
    return Array.from(byKey.values()).sort((a, b) => a.epoch - b.epoch);
  }

  function handleHistory(data) {
    if (!data.history || !Array.isArray(data.history.prices)) return;
    if (data.echo_req?.ticks_history &&
        data.echo_req.ticks_history !== state.currentSymbol) return;

    state.pipSize = precisionOf(data.pip_size ?? data.history.pip_size, state.pipSize);
    const historical = data.history.prices.map((price, index) =>
      makeTick(price, data.history.times?.[index], state.pipSize)
    ).filter(Boolean);

    state.ticks = sortedUniqueTicks([...historical, ...state.ticks])
      .slice(-Math.max(1000, Number($("windowSelect").value)));
    evaluateHistory(state.ticks);
    render();

    $("sampleNote").textContent = `${state.ticks.length.toLocaleString()} historical ticks loaded`;
    if (state.ticks.length) updateLatest(state.ticks[state.ticks.length - 1]);
  }

  function evaluateHistory(items) {
    state.evalHits = 0;
    state.evalCount = 0;
    const lookback = Math.min(100, Math.max(30, Math.floor(items.length / 5)));
    for (let i = lookback; i < items.length; i += 1) {
      const counts = Array(10).fill(0);
      for (let j = i - lookback; j < i; j += 1) counts[items[j].digit] += 1;
      const predicted = counts.indexOf(Math.max(...counts));
      state.evalCount += 1;
      if (predicted === items[i].digit) state.evalHits += 1;
    }
  }

  function predictFromRecent(items) {
    const lookback = Math.min(100, items.length);
    if (!lookback) return null;
    const counts = Array(10).fill(0);
    items.slice(-lookback).forEach((item) => { counts[item.digit] += 1; });
    return counts.indexOf(Math.max(...counts));
  }

  function handleTick(tick, subscription, echoReq) {
    const symbol = tick?.symbol || echoReq?.ticks;
    if (!tick || (symbol && symbol !== state.currentSymbol)) return;
    if (subscription?.id) state.tickSubscriptionId = subscription.id;

    state.pipSize = precisionOf(tick.pip_size, state.pipSize);
    const item = makeTick(tick.quote, tick.epoch, state.pipSize);
    if (!item) return;

    if (item.epoch && state.lastTickEpoch && item.epoch === state.lastTickEpoch) {
      const last = state.ticks[state.ticks.length - 1];
      if (last && last.quote === item.quote) return;
    }

    if (state.ticks.length >= 30) {
      const predicted = predictFromRecent(state.ticks);
      state.evalCount += 1;
      if (predicted === item.digit) state.evalHits += 1;
    }

    state.ticks.push(item);
    state.ticks = sortedUniqueTicks(state.ticks)
      .slice(-Math.max(1000, Number($("windowSelect").value)));
    state.lastTickEpoch = item.epoch || state.lastTickEpoch;
    updateLatest(item);
    render();
    $("sampleNote").textContent = `${state.ticks.length.toLocaleString()} ticks in memory · live updates`;
  }

  function updateLatest(item) {
    $("latestQuote").textContent = item.quote.toFixed(state.pipSize);
    $("latestDigit").textContent = String(item.digit);
    $("latestTime").textContent = item.epoch
      ? new Date(item.epoch * 1000).toLocaleTimeString()
      : "Live tick received";
  }

  function pct(n, d) {
    return d > 0 ? `${(100 * n / d).toFixed(1)}%` : "—";
  }

  function renderEmpty() {
    ["evenPct", "oddPct", "overPct", "underPct", "equalPct",
      "matchPct", "diffPct", "overUnderN"].forEach((id) => $(id).textContent = "—");
    $("tickCount").textContent = "0";
    $("accuracy").textContent = "Collecting data";
    $("topDigits").textContent = "Waiting for data";
    $("evenMeter").style.width = "0%";
    $("matchMeter").style.width = "0%";
    $("overMeter").style.width = "0%";
  }

  function render() {
    const sample = state.ticks.slice(-Number($("windowSelect").value));
    if (!sample.length) { renderEmpty(); return; }

    const counts = Array(10).fill(0);
    sample.forEach((item) => { counts[item.digit] += 1; });
    const max = Math.max(...counts, 1);

    $("digitBars").innerHTML = counts.map((count, digit) => `
      <div class="digit">
        <div class="bar-track"><div class="bar" style="height:${(count / max) * 100}%"></div></div>
        <b>${digit}</b><small>${pct(count, sample.length)}</small>
      </div>`).join("");

    const even = counts[0] + counts[2] + counts[4] + counts[6] + counts[8];
    const odd = sample.length - even;
    $("evenPct").textContent = pct(even, sample.length);
    $("oddPct").textContent = pct(odd, sample.length);
    $("evenMeter").style.width = `${100 * even / sample.length}%`;

    const barrier = Number($("barrierSelect").value);
    const over = counts.slice(barrier + 1).reduce((a, b) => a + b, 0);
    const under = counts.slice(0, barrier).reduce((a, b) => a + b, 0);
    const equal = counts[barrier];
    const eligible = over + under;
    $("overPct").textContent = pct(over, eligible);
    $("underPct").textContent = pct(under, eligible);
    $("equalPct").textContent = pct(equal, sample.length);
    $("overUnderN").textContent = String(eligible);
    $("overMeter").style.width = eligible ? `${100 * over / eligible}%` : "0%";

    const selectedDigit = Number($("matchDigit").value);
    const matches = counts[selectedDigit];
    $("matchPct").textContent = pct(matches, sample.length);
    $("diffPct").textContent = pct(sample.length - matches, sample.length);
    $("matchMeter").style.width = `${100 * matches / sample.length}%`;

    const ranked = counts.map((count, digit) => ({ digit, count }))
      .sort((a, b) => b.count - a.count || a.digit - b.digit);
    $("topDigits").textContent = ranked.slice(0, 3)
      .map((item) => `${item.digit} (${pct(item.count, sample.length)})`).join(" · ");

    $("tickCount").textContent = sample.length.toLocaleString();
    $("windowLabel").textContent =
      $("symbolSelect").selectedOptions[0]?.text || state.currentSymbol;
    $("accuracy").textContent = state.evalCount
      ? `${pct(state.evalHits, state.evalCount)} · ${state.evalCount.toLocaleString()} test ticks`
      : "Collecting out-of-sample ticks";
    $("modelStatus").textContent = "Rolling frequency baseline · experimental";
  }

  function initializeControls() {
    for (let digit = 0; digit <= 9; digit += 1) {
      $("matchDigit").add(new Option(String(digit), String(digit)));
    }
    $("symbolSelect").addEventListener("change", (event) => chooseSymbol(event.target.value));
    $("windowSelect").addEventListener("change", () => {
      if (state.currentSymbol) chooseSymbol(state.currentSymbol);
    });
    $("refreshBtn").addEventListener("click", () => {
      if (state.currentSymbol) chooseSymbol(state.currentSymbol);
      else requestSymbols();
    });
    $("barrierSelect").addEventListener("change", render);
    $("matchDigit").addEventListener("change", render);
  }

  window.addEventListener("beforeunload", () => {
    state.intentionalClose = true;
    clearTimeout(state.reconnectTimer);
    if (state.ws) state.ws.close();
  });

  initializeControls();
  connect();
})();

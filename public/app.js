(() => {
  "use strict";

  const WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
  const $ = (id) => document.getElementById(id);
  const state = {
    ws: null,
    symbols: [],
    ticks: [],
    currentSymbol: "",
    pipSize: 2,
    reconnectTimer: null,
    intentionalClose: false,
    requestId: 10,
    historyRequestId: null,
    tickSubscriptionId: null,
    evalHits: 0,
    evalCount: 0,
    lastTickEpoch: null,
    connectAttempts: 0
  };

  const numberOf = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

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

  function connect() {
    clearTimeout(state.reconnectTimer);
    state.intentionalClose = false;
    setConnection("connecting", "Connecting to Deriv public market data…");

    try {
      state.ws = new WebSocket(WS_URL);
    } catch (error) {
      showError("Could not start the market connection. Check your browser and internet connection.");
      scheduleReconnect();
      return;
    }

    state.ws.onopen = () => {
      state.connectAttempts = 0;
      clearError();
      setConnection("online", "Connected to Deriv public feed");
      send({ active_symbols: "brief", req_id: nextRequestId() });
    };

    state.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        const message = data.error.message || "Deriv returned an API error.";
        showError(message);
        if (data.echo_req && data.echo_req.ticks_history) {
          $("sampleNote").textContent = "History request failed";
        }
        return;
      }

      if (data.msg_type === "active_symbols") {
        handleSymbols(Array.isArray(data.active_symbols) ? data.active_symbols : []);
      } else if (data.msg_type === "history") {
        handleHistory(data);
      } else if (data.msg_type === "tick") {
        handleTick(data.tick, data.subscription);
      }
    };

    state.ws.onerror = () => {
      setConnection("offline", "Market feed connection error");
      showError("The Deriv feed connection encountered an error. The dashboard will try to reconnect.");
    };

    state.ws.onclose = () => {
      setConnection("offline", "Disconnected. Reconnecting…");
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

  function isSyntheticSymbol(item) {
    const name = String(item.display_name || "");
    const market = String(item.market || "");
    const submarket = String(item.submarket || "");
    return /volatility|crash|boom|step|jump|range break|drift/i.test(name) ||
      /synthetic/i.test(market) || /synthetic/i.test(submarket);
  }

  function handleSymbols(list) {
    state.symbols = list.filter(isSyntheticSymbol).sort((a, b) =>
      String(a.display_name || a.symbol).localeCompare(String(b.display_name || b.symbol))
    );

    const select = $("symbolSelect");
    const previous = state.currentSymbol;
    select.replaceChildren();

    if (!state.symbols.length) {
      select.add(new Option("No synthetic markets returned", ""));
      showError("Deriv did not return any synthetic indices. Refresh the page or check Deriv market availability.");
      return;
    }

    state.symbols.forEach((item) => {
      select.add(new Option(item.display_name || item.symbol, item.symbol));
    });

    const stillAvailable = state.symbols.find((item) => item.symbol === previous);
    const preferred =
      stillAvailable ||
      state.symbols.find((item) => /volatility 100/i.test(item.display_name || "")) ||
      state.symbols.find((item) => /volatility 75/i.test(item.display_name || "")) ||
      state.symbols[0];

    select.value = preferred.symbol;
    chooseSymbol(preferred.symbol);
    $("marketCount").textContent = `${state.symbols.length} synthetic markets available`;
  }

  function forgetCurrentSubscription() {
    if (state.tickSubscriptionId) {
      send({ forget: state.tickSubscriptionId, req_id: nextRequestId() });
      state.tickSubscriptionId = null;
    }
  }

  function chooseSymbol(symbol) {
    if (!symbol || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
      if (symbol) $("sampleNote").textContent = "Waiting for Deriv connection…";
      return;
    }

    forgetCurrentSubscription();
    state.currentSymbol = symbol;
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

    send({
      ticks_history: symbol,
      count: Number($("windowSelect").value),
      end: "latest",
      style: "ticks",
      req_id: state.historyRequestId
    });

    send({ ticks: symbol, subscribe: 1, req_id: nextRequestId() });
  }

  function getDigit(quote, precision) {
    const places = Math.max(0, Math.min(10, numberOf(precision, 2)));
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
    if (data.echo_req && data.echo_req.ticks_history &&
        data.echo_req.ticks_history !== state.currentSymbol) return;

    state.pipSize = numberOf(data.pip_size ?? data.history.pip_size, state.pipSize);
    const historical = data.history.prices.map((price, index) =>
      makeTick(price, data.history.times?.[index], state.pipSize)
    ).filter(Boolean);

    // Keep live ticks that may have arrived while the history request was in flight.
    state.ticks = sortedUniqueTicks([...historical, ...state.ticks])
      .slice(-Math.max(1000, Number($("windowSelect").value)));

    evaluateHistory(state.ticks);
    render();

    const count = state.ticks.length;
    $("sampleNote").textContent = `${count.toLocaleString()} historical ticks loaded`;
    if (state.ticks.length) {
      const latest = state.ticks[state.ticks.length - 1];
      updateLatest(latest);
    }
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

  function handleTick(tick, subscription) {
    if (!tick || tick.symbol !== state.currentSymbol) return;
    if (subscription && subscription.id) state.tickSubscriptionId = subscription.id;

    state.pipSize = numberOf(tick.pip_size, state.pipSize);
    const item = makeTick(tick.quote, tick.epoch, state.pipSize);
    if (!item) return;

    if (item.epoch && state.lastTickEpoch && item.epoch === state.lastTickEpoch) {
      const last = state.ticks[state.ticks.length - 1];
      if (last && last.quote === item.quote) return;
    }

    // Score a simple rolling-frequency baseline before adding the new observation.
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
    if (!sample.length) {
      renderEmpty();
      return;
    }

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
    $("windowLabel").textContent = `${$("symbolSelect").selectedOptions[0]?.text || state.currentSymbol}`;
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

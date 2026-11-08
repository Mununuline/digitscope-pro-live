const WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
const $ = (id) => document.getElementById(id);
let ws, symbols = [], ticks = [], pipSize = 2, currentSymbol = "";
let reconnectTimer, intentionalClose = false;

for (let d = 0; d <= 9; d++) $("matchDigit").add(new Option(String(d), String(d)));

function setConnection(ok, message) {
  $("connectionDot").classList.toggle("online", ok);
  $("connectionText").textContent = message;
  $("feedStatus").textContent = ok ? "Connected" : "Offline";
}
function showError(message) { const box=$("errorBox"); box.hidden=false; box.textContent=message; }
function clearError(){ $("errorBox").hidden=true; }

function connect() {
  intentionalClose = false;
  clearTimeout(reconnectTimer);
  setConnection(false, "Connecting to Deriv…");
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setConnection(true, "Connected to Deriv public feed");
    ws.send(JSON.stringify({ active_symbols: "brief", req_id: 1 }));
  };
  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.error) { showError(data.error.message || "Deriv API error"); return; }
    if (data.msg_type === "active_symbols") handleSymbols(data.active_symbols || []);
    if (data.msg_type === "history") handleHistory(data);
    if (data.msg_type === "tick") handleTick(data.tick);
  };
  ws.onerror = () => showError("The market feed reported a connection error. Check your internet connection.");
  ws.onclose = () => {
    setConnection(false, "Disconnected");
    if (!intentionalClose) reconnectTimer = setTimeout(connect, 3000);
  };
}
function handleSymbols(list) {
  symbols = list.filter(s => /volatility|crash|boom|step|jump|range break/i.test(s.display_name || ""));
  const select = $("symbolSelect");
  select.innerHTML = "";
  symbols.sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
  symbols.forEach(s => select.add(new Option(s.display_name, s.symbol)));
  const preferred = symbols.find(s => /volatility 100 index/i.test(s.display_name)) ||
                    symbols.find(s => /volatility 75 index/i.test(s.display_name)) || symbols[0];
  if (preferred) { select.value = preferred.symbol; chooseSymbol(preferred.symbol); }
  else showError("No synthetic indices were returned by Deriv. Try refreshing the page.");
}
function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function chooseSymbol(symbol) {
  if (!symbol) return;
  currentSymbol = symbol;
  ticks = [];
  $("latestQuote").textContent = "—";
  $("latestDigit").textContent = "—";
  $("sampleNote").textContent = "Loading history…";
  send({ ticks_history: symbol, count: Number($("windowSelect").value), end: "latest", style: "ticks", req_id: 2 });
  send({ ticks: symbol, subscribe: 1, req_id: 3 });
}
function getDigit(quote, precision) {
  const fixed = Number(quote).toFixed(Math.max(0, Math.min(10, precision)));
  const digits = fixed.replace(".", "").replace("-", "");
  return Number(digits.slice(-1));
}
function handleHistory(data) {
  if (!data.history || !data.history.prices) return;
  pipSize = Number(data.pip_size ?? data.history.pip_size ?? pipSize);
  ticks = data.history.prices.map((price, i) => ({
    quote: Number(price),
    epoch: data.history.times?.[i] || null,
    digit: getDigit(price, pipSize)
  }));
  const max = Number($("windowSelect").value);
  ticks = ticks.slice(-max);
  render();
  $("sampleNote").textContent = `${ticks.length} historical ticks loaded`;
}
function handleTick(tick) {
  if (!tick || tick.symbol !== currentSymbol) return;
  pipSize = Number(tick.pip_size ?? pipSize);
  const item = { quote: Number(tick.quote), epoch: tick.epoch, digit: getDigit(tick.quote, pipSize) };
  ticks.push(item);
  ticks = ticks.slice(-Math.max(1000, Number($("windowSelect").value)));
  $("latestQuote").textContent = item.quote.toFixed(pipSize);
  $("latestDigit").textContent = item.digit;
  $("latestTime").textContent = tick.epoch ? new Date(tick.epoch*1000).toLocaleTimeString() : "Live tick";
  render();
}
function pct(n,d){ return d ? (100*n/d).toFixed(1)+"%" : "—"; }
function render() {
  const sample = ticks.slice(-Number($("windowSelect").value));
  if (!sample.length) return;
  const counts = Array(10).fill(0);
  sample.forEach(t => counts[t.digit]++);
  const max = Math.max(...counts, 1);
  $("digitBars").innerHTML = counts.map((n,d)=>`<div class="digit"><div class="bar-track"><div class="bar" style="height:${(n/max)*100}%"></div></div><b>${d}</b><small>${pct(n,sample.length)}</small></div>`).join("");
  const even = counts[0]+counts[2]+counts[4]+counts[6]+counts[8];
  const odd = sample.length-even;
  $("evenPct").textContent=pct(even,sample.length); $("oddPct").textContent=pct(odd,sample.length);
  $("evenMeter").style.width=(100*even/sample.length)+"%";
  const barrier=Number($("barrierSelect").value);
  const over=counts.slice(barrier+1).reduce((a,b)=>a+b,0);
  const under=counts.slice(0,barrier).reduce((a,b)=>a+b,0);
  const equal=counts[barrier];
  $("overPct").textContent=pct(over,over+under); $("underPct").textContent=pct(under,over+under);
  $("equalPct").textContent=pct(equal,sample.length); $("overUnderN").textContent=String(over+under);
  const digit=Number($("matchDigit").value), matches=counts[digit];
  $("matchPct").textContent=pct(matches,sample.length); $("diffPct").textContent=pct(sample.length-matches,sample.length);
  $("matchMeter").style.width=(100*matches/sample.length)+"%";
  $("tickCount").textContent=sample.length.toLocaleString();
  $("windowLabel").textContent=`${$("symbolSelect").selectedOptions[0]?.text || currentSymbol}`;
  $("accuracy").textContent="Not measured yet";
}
$("symbolSelect").addEventListener("change", e=>chooseSymbol(e.target.value));
$("windowSelect").addEventListener("change", ()=>chooseSymbol(currentSymbol));
$("refreshBtn").addEventListener("click", ()=>chooseSymbol(currentSymbol));
$("barrierSelect").addEventListener("change", render);
$("matchDigit").addEventListener("change", render);
window.addEventListener("beforeunload", ()=>{ intentionalClose=true; if(ws) ws.close(); });
connect();

(() => {
"use strict";
if(window.__dspAutoTraderLoaded)return;window.__dspAutoTraderLoaded=true;
const style=document.createElement("style");style.textContent=`
#dspAutoTrader{margin:16px 0;padding:20px;border:1px solid #27415b;border-radius:16px;background:linear-gradient(145deg,#111f30,#0b1725);color:#eaf2fb}
#dspAutoTrader h2{margin:0;font-size:20px}#dspAutoTrader .at-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800}
#dspAutoTrader .at-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:14px 0}
#dspAutoTrader label{display:block;color:#a6b8ca;font-size:11px}#dspAutoTrader input{box-sizing:border-box;width:100%;margin-top:5px;padding:10px;border-radius:8px;border:1px solid #304760;background:#081421;color:#fff}
#dspAutoTrader button{padding:10px 14px;border:0;border-radius:8px;background:#42c8d3;color:#06131f;font-weight:800;cursor:pointer;margin:4px 6px 4px 0}
#dspAutoTrader button.secondary{background:#263b51;color:#eaf2fb}#dspAutoTrader button:disabled{opacity:.45;cursor:not-allowed}
#dspAutoTrader .at-status{padding:11px;border-radius:8px;background:#0a1928;color:#9fb2c7;font-size:12px;margin:12px 0}
#dspAutoTrader .at-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px}
#dspAutoTrader .at-card{padding:12px;background:#0a1928;border:1px solid #20364c;border-radius:10px}
#dspAutoTrader .at-card small{display:block;color:#90a6bc;font-size:10px}#dspAutoTrader .at-card strong{font-size:18px}
#dspAutoTrader table{width:100%;border-collapse:collapse;min-width:640px;font-size:12px}#dspAutoTrader th,#dspAutoTrader td{padding:9px;border-bottom:1px solid #20364c;text-align:left}
#dspAutoTrader th{font-size:10px;color:#9fb2c7;text-transform:uppercase}#dspAutoTrader .at-scroll{overflow:auto}
#dspAutoTrader .at-note{font-size:11px;line-height:1.5;color:#91a4b9}#dspAutoTrader .at-danger{color:#ffc27a}#dspAutoTrader .at-safe{color:#67e0ad}`;
document.head.appendChild(style);
const panel=document.createElement("section");panel.id="dspAutoTrader";panel.innerHTML=`
<p class="at-kicker">AUTOMATED STRATEGY LAB</p><h2>DigitScope Pro AutoTrader</h2>
<div class="at-status at-danger">DEMO ONLY · Paper-trading preview · This build cannot place orders.</div>
<div class="at-grid">
<label>Deriv demo account ID<input id="atAccount" autocomplete="off" placeholder="VRTC1234567"></label>
<label>Deriv App ID<input id="atAppId" inputmode="numeric" autocomplete="off" placeholder="Your numeric App ID"></label>
<label>API token<input id="atToken" type="password" autocomplete="off" placeholder="Token with read scope"></label>
</div>
<button id="atConnect">Connect demo account</button><button id="atDisconnect" class="secondary">Disconnect</button>
<div id="atAuthStatus" class="at-status">Not connected. Your permanent token is sent to the server only to request a short-lived demo OTP; it is not stored.</div>
<div class="at-cards">
<div class="at-card"><small>Operating mode</small><strong>DEMO</strong></div><div class="at-card"><small>Execution</small><strong>Disabled</strong></div>
<div class="at-card"><small>Markets observed</small><strong id="atMarkets">0</strong></div><div class="at-card"><small>Markets with sample</small><strong id="atSignals">0</strong></div><div class="at-card"><small>3-tick forecast hit rate</small><strong id="atForecastRate">—</strong><small id="atForecastCount">0 settled</small></div>
</div>
<h3>Live market candidates</h3><div class="at-scroll"><table><thead><tr><th>Market</th><th>Ticks</th><th>Top digit</th><th>Even</th><th>Odd</th><th>Observed bias</th><th>Decision</th></tr></thead><tbody id="atRows"><tr><td colspan="7">Waiting for scanner data…</td></tr></tbody></table></div>
<p class="at-note">Risk controls planned before demo execution: fixed-fractional sizing, no martingale, one open position maximum, 0.5% risk per trade, 3% daily loss stop and a three-loss pause. Controls will be enforced server-side before orders are enabled.</p>
<p class="at-note">Historical deviations are not proof of predictive edge. The three-tick score counts a forecast as a hit if its selected digit appears at least once in the next three ticks; under independent uniform digits, a fixed digit has a 27.1% chance of appearing in that window. This preview does not submit proposals or buy contracts. We must beat the appropriate baseline out of sample and account for actual contract payouts before considering execution.</p>`;
const hero=document.querySelector(".hero");if(hero)hero.insertAdjacentElement("afterend",panel);else document.body.prepend(panel);
const $=id=>document.getElementById(id);let tradingSocket=null;const forecastState=new Map();let forecastHits=0,forecastSettled=0;
function authStatus(msg,good=false){$("atAuthStatus").textContent=msg;$("atAuthStatus").className="at-status "+(good?"at-safe":"");}
$("atConnect").addEventListener("click",async()=>{
const token=$("atToken").value.trim(),appId=$("atAppId").value.trim(),accountId=$("atAccount").value.trim();
if(!token||!appId||!accountId){authStatus("Enter all three fields to connect a DEMO account.");return;}
$("atConnect").disabled=true;authStatus("Requesting a short-lived DEMO session from Deriv…");
try{
const response=await fetch("/api/autotrader/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,appId,accountId})});
const result=await response.json();if(!response.ok)throw new Error(result.error||"Authentication failed.");
$("atToken").value="";if(tradingSocket)tradingSocket.close();tradingSocket=new WebSocket(result.wsUrl);
tradingSocket.onopen=()=>{tradingSocket.send(JSON.stringify({balance:1,subscribe:1}));authStatus("Authenticated DEMO WebSocket connected. Loading account balance…");};
tradingSocket.onmessage=event=>{let data;try{data=JSON.parse(event.data)}catch{return}
if(data.error){authStatus("Deriv session error: "+(data.error.message||"Unknown error"));return}
if(data.msg_type==="balance"&&data.balance){const b=data.balance;authStatus("Connected to DEMO account "+result.accountId+" · "+b.currency+" "+Number(b.balance).toFixed(2)+". Order execution is disabled.",true);}
};
tradingSocket.onerror=()=>authStatus("Demo WebSocket connection failed. Check token read permission and retry.");
}catch(error){authStatus(error.message)}finally{$("atConnect").disabled=false}
});
$("atDisconnect").addEventListener("click",async()=>{if(tradingSocket){tradingSocket.close();tradingSocket=null}await fetch("/api/autotrader/logout",{method:"POST"}).catch(()=>{});authStatus("Disconnected. Temporary server session cleared.");});
function updateForecast(row){
let state=forecastState.get(row.symbol);
if(!state){const recent=row.recentTicks||[];const last=recent.reduce((max,t)=>Math.max(max,Number(t.epoch)||0),0);forecastState.set(row.symbol,{lastEpoch:last,pending:[]});return;}
const fresh=(row.recentTicks||[]).filter(t=>Number(t.epoch)>state.lastEpoch).sort((a,b)=>a.epoch-b.epoch);
for(const tick of fresh){
for(const item of state.pending){
if(tick.digit===item.digit){item.hit=true;item.remaining=0;}
else item.remaining-=1;
}
const settled=state.pending.filter(item=>item.hit||item.remaining<=0);
settled.forEach(item=>{forecastSettled++;if(item.hit)forecastHits++;});
state.pending=state.pending.filter(item=>!item.hit&&item.remaining>0);
const counts=row.counts||[];
if(counts.length===10&&row.n>=100){
const max=Math.max(...counts),prediction=counts.indexOf(max);
state.pending.push({digit:prediction,remaining:3});
}
state.lastEpoch=Number(tick.epoch)||state.lastEpoch;
}
forecastState.set(row.symbol,state);
}
window.addEventListener("dsp:market-snapshot",event=>{
const rows=event.detail?.rows||[];rows.forEach(updateForecast);
$("atMarkets").textContent=String(rows.length);const ready=rows.filter(r=>r.n>=300);$("atSignals").textContent=String(ready.length);
$("atForecastRate").textContent=forecastSettled?(100*forecastHits/forecastSettled).toFixed(1)+"%":"—";
$("atForecastCount").textContent=forecastSettled+" settled · "+forecastHits+" hits";
const ranked=ready.map(r=>{const c=r.counts||[],n=r.n||0,even=c.reduce((s,v,d)=>s+(d%2===0?v:0),0),p=n?even/n:.5,top=c.indexOf(Math.max(...c));return {...r,p,top,bias:Math.abs(p-.5)};}).sort((a,b)=>b.bias-a.bias);
$("atRows").innerHTML=ranked.slice(0,13).map(r=>{const bias=r.bias>=.03?(r.p>.5?"Even above baseline":"Odd above baseline"):"No material parity deviation";return `<tr><td>${String(r.name||r.symbol).replace(/[&<>"]/g,"")}</td><td>${r.n}</td><td>${r.top}</td><td>${(100*r.p).toFixed(1)}%</td><td>${(100*(1-r.p)).toFixed(1)}%</td><td>${bias}</td><td>Observe only</td></tr>`;}).join("")||'<tr><td colspan="7">No scanner samples received yet.</td></tr>';
});
fetch("/api/autotrader/status").then(r=>r.json()).then(s=>{if(s.connected)authStatus("A temporary demo session exists for "+s.accountId+". Reconnect to obtain a fresh short-lived WebSocket OTP.",true)}).catch(()=>{});
})();
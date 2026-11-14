(() => {
  "use strict";

  // Phase 4: non-overlapping target ticks + HAC inference + Holm correction.
  // Separate storage key; does not alter Phase 2/3 history.
  const KEY = "digitscopePro.statisticalReliability.v1";
  const BASELINE = 0.10, LOOKBACK = 100, HORIZON = 3, LAG = 5;
  const MAX = 5000;
  const state = { nextId: 1, markets: Object.create(null) };
  let storageOK = true;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.markets) return;
      state.nextId = Math.max(1, Number(parsed.nextId) || 1);
      Object.keys(parsed.markets).forEach(symbol => {
        const x = parsed.markets[symbol];
        if (!x || !Array.isArray(x.outcomes)) return;
        const outcomes = x.outcomes.filter(o => o && typeof o.hit === "boolean")
          .slice(-MAX).map(o => {
            if (!Number.isSafeInteger(o.id) || o.id < 1) o.id = state.nextId++;
            else state.nextId = Math.max(state.nextId, o.id + 1);
            return o;
          });
        state.markets[symbol] = {
          symbol, name: String(x.name || symbol), outcomes,
          seq: Number(x.seq) || 0, lastTotalTicks: Number(x.lastTotalTicks) || 0,
          digits: Array.isArray(x.digits) ? x.digits.slice(-LOOKBACK) : [],
          pending: Array.isArray(x.pending) ? x.pending : [],
          awaitingSnapshot: false
        };
      });
    } catch (_) { storageOK = false; }
  }

  function save() {
    if (!storageOK) return;
    try {
      const markets = {};
      Object.keys(state.markets).forEach(k => {
        const r = state.markets[k];
        markets[k] = { name:r.name, outcomes:r.outcomes.slice(-MAX), seq:r.seq,
          lastTotalTicks:r.lastTotalTicks, digits:r.digits.slice(-LOOKBACK), pending:r.pending };
      });
      localStorage.setItem(KEY, JSON.stringify({version:1,nextId:state.nextId,markets}));
    } catch (_) { storageOK = false; }
  }

  function get(symbol, name) {
    return state.markets[symbol] || (state.markets[symbol] = {
      symbol, name:String(name || symbol), outcomes:[], seq:0, lastTotalTicks:0,
      digits:[], pending:[], awaitingSnapshot:false
    });
  }

  function consume(r, digit, tickId) {
    r.seq++;
    const remain = [];
    r.pending.forEach(p => {
      if (p.dueAt > r.seq) remain.push(p);
      else {
        r.outcomes.push({id:state.nextId++,hit:digit === p.target,dataset_id:"DS-07",methodology_version:"1.0.0",market:r.symbol,contract:"DIGIT_MATCH",model_id:"rolling-most-frequent-v1",selected_digit:p.target,forecast_origin_tick_id:p.originTickId||null,target_tick_id:tickId||null,training_window:LOOKBACK,forecast_horizon:HORIZON,observed_digit:digit,scored_at_utc:new Date().toISOString()});
        if (r.outcomes.length > MAX) r.outcomes.shift();
      }
    });
    r.pending = remain;
    r.digits.push(digit);
    if (r.digits.length > LOOKBACK) r.digits.shift();

    // Forecast only once every three ticks. Each scored target tick is unique.
    if (r.digits.length === LOOKBACK && r.seq % HORIZON === 0) {
      const counts = Array(10).fill(0);
      r.digits.forEach(d => counts[d]++);
      r.pending.push({target:counts.indexOf(Math.max(...counts)),dueAt:r.seq+HORIZON,originTickId:tickId||null});
    }
  }

  function onTick(event) {
    const d = event.detail || {}, symbol = String(d.symbol || "");
    const digit = Number(d.digit), total = Number(d.totalTicks);
    if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9 ||
        !Number.isSafeInteger(total) || total < 1) return;
    const r = get(symbol,d.name); r.name = String(d.name || r.name);
    if (!r.awaitingSnapshot && r.lastTotalTicks > 0 && total <= r.lastTotalTicks) {
      r.seq=0; r.lastTotalTicks=0; r.digits=[]; r.pending=[]; r.awaitingSnapshot=true; save(); return;
    }
    if (r.awaitingSnapshot || total <= r.lastTotalTicks) return;
    if (r.lastTotalTicks && total !== r.lastTotalTicks+1) {
      r.awaitingSnapshot=true; r.pending=[]; save(); return;
    }
    consume(r,digit,d.tickId); r.lastTotalTicks=total; save(); render();
  }

  function onSnapshot(event) {
    const rows = event.detail && Array.isArray(event.detail.rows) ? event.detail.rows : [];
    let changed=false;
    rows.forEach(row => {
      const symbol=String(row.symbol||""), total=Number(row.totalTicks);
      const digits=Array.isArray(row.digits)?row.digits.map(Number):[];
      if (!symbol || !Number.isSafeInteger(total) || total<1 || !digits.length ||
          digits.some(d=>!Number.isInteger(d)||d<0||d>9)) return;
      const r=get(symbol,row.name); r.name=String(row.name||r.name);
      if (r.awaitingSnapshot || r.lastTotalTicks===0) {
        r.digits=digits.slice(-LOOKBACK); r.seq=total; r.lastTotalTicks=total;
        r.pending=[]; r.awaitingSnapshot=false; changed=true; return;
      }
      const gap=total-r.lastTotalTicks;
      if (gap<=0) return;
      if (gap>digits.length) {
        r.digits=digits.slice(-LOOKBACK); r.seq=total; r.lastTotalTicks=total;
        r.pending=[]; changed=true; return;
      }
      digits.slice(-gap).forEach(d=>consume(r,d));
      r.lastTotalTicks=total; changed=true;
    });
    if(changed){save();render();}
  }

  function normalSF(z) {
    // Abramowitz-Stegun approximation to the standard normal upper tail.
    const x=Math.abs(z), t=1/(1+0.2316419*x);
    const poly=t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    const density=0.3989422804014327*Math.exp(-x*x/2);
    const tail=density*poly;
    return z>=0?tail:1-tail;
  }

  function stats(outcomes) {
    const n=outcomes.length, hits=outcomes.reduce((s,o)=>s+(o.hit?1:0),0);
    const rate=n?hits/n:null;
    if(n<2) return {n,hits,rate,se:null,p:null,lower:null};
    const residuals=outcomes.map(o=>(o.hit?1:0)-BASELINE);
    let longRun=0;
    for(let lag=0;lag<=Math.min(LAG,n-1);lag++){
      let covariance=0;
      for(let i=lag;i<n;i++) covariance+=residuals[i]*residuals[i-lag];
      covariance/=n;
      longRun+=(lag===0?1:2*(1-lag/(LAG+1)))*covariance;
    }
    const variance=Math.max(0,longRun/n), se=Math.sqrt(variance);
    const z=se>0?(rate-BASELINE)/se:(rate>BASELINE?Infinity:0);
    return {n,hits,rate,se,p:normalSF(z),lower:rate-1.645*se};
  }

  function holm(rows) {
    const eligible=rows.filter(r=>r.s.n>=100 && Number.isFinite(r.s.p)).sort((a,b)=>a.s.p-b.s.p);
    let running=0;
    eligible.forEach((r,i)=>{
      running=Math.max(running,Math.min(1,(eligible.length-i)*r.s.p));
      r.adjusted=running;
    });
    rows.forEach(r=>{if(r.adjusted===undefined)r.adjusted=null;});
  }

  function pct(x){return x===null||!Number.isFinite(x)?"—":(100*x).toFixed(1)+"%";}
  function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  function install() {
    const panel=document.createElement("section"); panel.id="dspStatisticalReliability";
    panel.innerHTML=`
      <style>
      #dspStatisticalReliability{margin:14px 0;padding:20px;background:#101d2d;border:1px solid #31506a;border-radius:16px;color:#eaf2fb}
      #dspStatisticalReliability h2{font-size:19px;margin:0}
      #dspStatisticalReliability .d4-kicker{color:#52d6df;font-size:10px;letter-spacing:2px;font-weight:800}
      #dspStatisticalReliability .d4-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
      #dspStatisticalReliability .d4-card{background:#0a1725;border:1px solid #203249;border-radius:10px;padding:12px}
      #dspStatisticalReliability .d4-card span{display:block;color:#91a4b9;font-size:11px}
      #dspStatisticalReliability .d4-card strong{display:block;font-size:21px;margin-top:4px}
      #dspStatisticalReliability .d4-wrap{overflow-x:auto}
      #dspStatisticalReliability table{width:100%;min-width:850px;border-collapse:collapse;font-size:12px}
      #dspStatisticalReliability th,#dspStatisticalReliability td{padding:9px 8px;border-bottom:1px solid #203249;text-align:left;white-space:nowrap}
      #dspStatisticalReliability th{color:#91a4b9;font-size:10px}
      #dspStatisticalReliability small{display:block;color:#91a4b9}
      #dspStatisticalReliability .good{color:#67e0ad}#dspStatisticalReliability .watch{color:#f4b86a}
      #dspStatisticalReliability .note{color:#91a4b9;font-size:11px;line-height:1.55;margin-top:12px}
      @media(max-width:650px){#dspStatisticalReliability{padding:15px}#dspStatisticalReliability .d4-cards{grid-template-columns:1fr}}
      </style>
      <p class="d4-kicker">PHASE 4 · STATISTICAL RELIABILITY ENGINE</p>
      <h2>Non-overlapping Validation &amp; Reliability</h2>
      <p id="d4Status">Starting independent validation stream…</p>
      <div class="d4-cards">
        <div class="d4-card"><span>Markets with 100+ trials</span><strong id="d4Markets">0</strong></div>
        <div class="d4-card"><span>Holm-adjusted passes</span><strong id="d4Passes">0</strong></div>
        <div class="d4-card"><span>Non-overlapping outcomes</span><strong id="d4Trials">0</strong></div>
      </div>
      <div class="d4-wrap"><table><thead><tr><th>Market</th><th>Trials</th><th>Hit rate</th><th>HAC 95% lower bound</th><th>Holm-adjusted p</th><th>Stability</th><th>Reliability</th></tr></thead>
      <tbody id="d4Rows"><tr><td colspan="7">Waiting for non-overlapping third-tick outcomes…</td></tr></tbody></table></div>
      <p class="note">Protocol: after a 100-live-tick warm-up, a forecast is issued only every third tick and scored exactly three ticks later, so scored target ticks do not overlap. The 5-lag Newey–West/HAC estimate allows for residual serial dependence; Holm step-down correction controls family-wise false positives across eligible markets. A candidate requires at least 100 outcomes, adjusted p &lt; 0.05, and a positive lower bound above the 10% reference. Stability compares first and second halves. This is stricter research validation, not proof of independence or a profitable edge. Results are stored separately in this browser and device.</p>
    `;
    const anchor=document.getElementById("dspAdaptiveIntelligence")||document.getElementById("dspRollingPerformance");
    if(anchor)anchor.insertAdjacentElement("afterend",panel);else document.querySelector("main")?.appendChild(panel);
  }

  function render() {
    const rows=Object.values(state.markets).map(r=>{
      const s=stats(r.outcomes), mid=Math.floor(r.outcomes.length/2);
      const first=stats(r.outcomes.slice(0,mid)), second=stats(r.outcomes.slice(mid));
      let stability="Building sample", cls="";
      if(first.n>=30&&second.n>=30){
        const diff=second.rate-first.rate;
        stability=Math.abs(diff)<0.03?"Stable":(diff>0?"Improving ":"Cooling ")+(diff>=0?"+":"")+(100*diff).toFixed(1)+" pp";
      }
      return {r,s,stability,cls,adjusted:null};
    });
    holm(rows);
    const eligible=rows.filter(x=>x.s.n>=100);
    const passes=eligible.filter(x=>x.adjusted!==null&&x.adjusted<0.05&&x.s.lower>BASELINE&&x.stability==="Stable").length;
    const total=rows.reduce((n,x)=>n+x.s.n,0);
    document.getElementById("d4Markets").textContent=eligible.length;
    document.getElementById("d4Passes").textContent=passes;
    document.getElementById("d4Trials").textContent=total.toLocaleString();
    document.getElementById("d4Status").textContent=
      "Separate validation stream · every 3rd tick forecast · "+(storageOK?"local persistence active":"local storage unavailable");
    rows.sort((a,b)=>(b.s.rate??-1)-(a.s.rate??-1));
    document.getElementById("d4Rows").innerHTML=rows.length?rows.map(x=>{
      const pass=x.adjusted!==null&&x.adjusted<0.05&&x.s.lower>BASELINE&&x.stability==="Stable";
      let label=x.s.n<100?"Insufficient sample":pass?"Reliable candidate · provisional":
        x.s.n>=100&&x.s.lower>BASELINE?"Promising · not corrected/unstable":
        x.s.n>=100&&x.s.rate<BASELINE?"Below reference":"Not confirmed";
      const cls=pass?"good":(x.s.n>=100&&x.s.rate<BASELINE?"watch":"");
      return "<tr><td>"+esc(x.r.name)+"<small>"+esc(x.r.symbol)+"</small></td><td>"+x.s.n+
        "</td><td>"+pct(x.s.rate)+"</td><td>"+pct(x.s.lower)+"</td><td>"+
        (x.adjusted===null?"—":x.adjusted.toFixed(4))+"</td><td>"+x.stability+"</td>"+
        "<td class=\""+cls+"\">"+label+"</td></tr>";
    }).join(""):'<tr><td colspan="7">Waiting for live market observations.</td></tr>';
  }

  load(); install();
  window.addEventListener("dsp:tick-observation",onTick);
  window.addEventListener("dsp:market-snapshot",onSnapshot);
  render();
})();
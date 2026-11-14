(() => {
  "use strict";
  if (window.__dspMatchDecisionLoaded) return;
  window.__dspMatchDecisionLoaded = true;

  const KEY = "digitscopePro.matchDecision.v1";
  const TRAIN = 100, HORIZON = 3, MIN_TESTS = 500, MAX = 5000, BASE = 0.10;
  const state = Object.create(null);
  let storageOK = true, selectedSymbol = "", quoteMultiple = null;

  const style = document.createElement("style");
  style.textContent = `
    #dspMatchDecision{margin:14px 0;padding:20px;background:linear-gradient(145deg,#172333,#0b1928);border:1px solid #426078;border-radius:16px;color:#eaf2fb}
    #dspMatchDecision .md-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    #dspMatchDecision .md-kicker{font-size:10px;letter-spacing:2px;color:#52d6df;font-weight:800;margin:0 0 6px}
    #dspMatchDecision h2{font-size:20px;margin:0}
    #dspMatchDecision .md-badge{font-size:10px;color:#f4b86a;border:1px solid #76552b;border-radius:20px;padding:6px 9px}
    #dspMatchDecision .md-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}
    #dspMatchDecision label{display:block;color:#9db0c4;font-size:11px}
    #dspMatchDecision select,#dspMatchDecision input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;background:#081522;color:#eaf2fb;border:1px solid #35506a;border-radius:8px;min-height:40px}
    #dspMatchDecision .md-decision{padding:16px;border:1px solid #76552b;background:#251d13;border-radius:12px;margin:12px 0}
    #dspMatchDecision .md-decision strong{display:block;font-size:22px;color:#ffc477;margin-bottom:5px}
    #dspMatchDecision .md-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}
    #dspMatchDecision .md-card{background:#091725;border:1px solid #263c52;border-radius:9px;padding:11px;min-width:0}
    #dspMatchDecision .md-card span{display:block;color:#9db0c4;font-size:10px}
    #dspMatchDecision .md-card b{display:block;font-size:17px;margin-top:5px;overflow-wrap:anywhere}
    #dspMatchDecision .md-table{overflow-x:auto}
    #dspMatchDecision table{width:100%;min-width:900px;border-collapse:collapse;font-size:11px}
    #dspMatchDecision th,#dspMatchDecision td{padding:9px 7px;text-align:left;border-bottom:1px solid #263c52;white-space:nowrap}
    #dspMatchDecision th{font-size:10px;color:#9db0c4}
    #dspMatchDecision small{display:block;color:#9db0c4;margin-top:3px}
    #dspMatchDecision .md-note{font-size:11px;line-height:1.55;color:#9db0c4;margin:12px 0 0}
    #dspMatchDecision .md-good{color:#67e0ad}#dspMatchDecision .md-warn{color:#ffc477}
    @media(max-width:650px){#dspMatchDecision{padding:14px}#dspMatchDecision .md-controls{grid-template-columns:1fr 1fr}#dspMatchDecision .md-cards{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "dspMatchDecision";
  panel.innerHTML = `
    <div class="md-head"><div><p class="md-kicker">PHASE 5 · SPECIALISED MATCH / DIFFERS DECISION ENGINE</p><h2>3-Tick MATCH / DIFFERS Trade Decision</h2></div><span class="md-badge">READ-ONLY · NO ORDERS</span></div>
    <p id="mdStatus" class="md-note">Starting separate MATCH / DIFFERS validation stream…</p>
    <div class="md-controls">
      <label>Market<select id="mdMarket"><option value="">Waiting for live markets…</option></select></label>
      <label>Contract<select id="mdContract"><option value="MATCH">DIGIT MATCH</option><option value="DIFFERS">DIGIT DIFFERS</option></select></label>
      <label>Quoted total payout ÷ stake<input id="mdPayout" type="number" min="1.01" max="1000" step="0.01" placeholder="Enter Deriv quote, e.g. 9.50"></label>
    </div>
    <div id="mdDecision" class="md-decision"><strong>DON'T TRADE</strong>Waiting for live validation and a payout quote.</div>
    <div class="md-cards">
      <div class="md-card"><span>Selected digit</span><b id="mdDigit">—</b></div>
      <div class="md-card"><span>Estimated event chance</span><b id="mdChance">—</b></div>
      <div class="md-card"><span>Break-even probability</span><b id="mdBreakEven">—</b></div>
      <div class="md-card"><span>Validation outcomes</span><b id="mdTrials">0</b></div>
    </div>
    <p class="md-note" id="mdReason">A live Deriv payout quote is required. Enter total payout divided by stake (not net profit). For example, 9.50 means a 1-unit stake returns 9.50 units in total if successful.</p>
    <div class="md-table"><table><thead><tr><th>Market</th><th>Contract</th><th>Digit</th><th>Current chance</th><th>OOS trials</th><th>Observed win</th><th>95% lower bound</th><th>Holm p</th><th>Evidence</th></tr></thead><tbody id="mdRows"><tr><td colspan="9">Waiting for live observations…</td></tr></tbody></table></div>
    <p class="md-note">Separate walk-forward stream: 100 prior digits, forecast once every three ticks, score exactly the third subsequent tick. MATCH tests the coldest digit; DIFFERS tests the hottest digit. Outcomes are saved locally on this browser/device. A trade candidate requires at least 500 outcomes, Holm-adjusted p &lt; 0.05 against the 10% MATCH / 90% DIFFERS fair reference, a 95% Wilson lower bound at least 2 percentage points above the entered payout break-even, and positive Brier skill. The multiple-test adjustment covers 26 market/model combinations. Residual dependence and changing payout quotes can still invalidate apparent advantages. This tool is research-only and never places orders.</p>
  `;

  const anchor = document.getElementById("dspMatchLab") || document.getElementById("dspStatisticalReliability") || document.querySelector("main");
  if (anchor) anchor.insertAdjacentElement("afterend", panel);
  const $ = id => document.getElementById(id);
  const pct = x => Number.isFinite(x) ? (100*x).toFixed(1)+"%" : "—";
  const escape = x => String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(KEY)||"null");
      if(!parsed||parsed.version!==1||!parsed.markets)return;
      Object.keys(parsed.markets).forEach(symbol=>{
        const x=parsed.markets[symbol];
        if(!x)return;
        state[symbol]={symbol,name:String(x.name||symbol),seq:0,lastTotal:0,digits:[],pending:[],
          match:Array.isArray(x.match)?x.match.filter(Boolean).slice(-MAX):[],
          differs:Array.isArray(x.differs)?x.differs.filter(Boolean).slice(-MAX):[],awaiting:true};
      });
    }catch(_){storageOK=false;}
  }
  function save(){
    if(!storageOK)return;
    try{
      const markets={};
      Object.keys(state).forEach(k=>{const r=state[k];markets[k]={name:r.name,match:r.match.slice(-MAX),differs:r.differs.slice(-MAX)};});
      localStorage.setItem(KEY,JSON.stringify({version:1,markets}));
    }catch(_){storageOK=false;}
  }
  function get(symbol,name){
    return state[symbol]||(state[symbol]={symbol,name:String(name||symbol),seq:0,lastTotal:0,digits:[],pending:[],match:[],differs:[],awaiting:true});
  }
  function choose(digits,mode){
    const counts=Array(10).fill(0);digits.forEach(d=>counts[d]++);
    const extreme=mode==="cold"?Math.min(...counts):Math.max(...counts);
    for(let i=digits.length-1;i>=0;i--)if(counts[digits[i]]===extreme)return digits[i];
    return 0;
  }
  function probability(digits,digit,contract){
    const hits=digits.filter(d=>d===digit).length/digits.length;
    return contract==="MATCH"?hits:1-hits;
  }
  function consume(r,digit,tickId){
    r.seq++;
    const remain=[];
    r.pending.forEach(p=>{
      if(p.due>r.seq){remain.push(p);return;}
      const won=p.contract==="MATCH"?digit===p.digit:digit!==p.digit;
      const arr=p.contract==="MATCH"?r.match:r.differs;
      arr.push({hit:won?1:0,p:p.p,dataset_id:"DS-05",methodology_version:"1.0.0",market:r.symbol,contract:p.contract,model_id:p.contract==="MATCH"?"coldest-digit-v1":"hottest-digit-v1",selected_digit:p.digit,forecast_origin_tick_id:p.originTickId||null,target_tick_id:tickId||null,training_window:TRAIN,forecast_horizon:HORIZON,observed_digit:digit,scored_at_utc:new Date().toISOString()});
      if(window.DigitScopeDatasetRegistry)window.DigitScopeDatasetRegistry.ingest(arr[arr.length-1]);
      if(arr.length>MAX)arr.shift();
    });
    r.pending=remain;
    r.digits.push(digit);if(r.digits.length>TRAIN)r.digits.shift();
    if(r.digits.length===TRAIN&&r.seq%HORIZON===0){
      const cold=choose(r.digits,"cold"),hot=choose(r.digits,"hot");
      r.pending.push({contract:"MATCH",digit:cold,p:probability(r.digits,cold,"MATCH"),due:r.seq+HORIZON,originTickId:tickId||null});
      r.pending.push({contract:"DIFFERS",digit:hot,p:probability(r.digits,hot,"DIFFERS"),due:r.seq+HORIZON,originTickId:tickId||null});
    }
  }
  function onTick(event){
    const d=event.detail||{},symbol=String(d.symbol||""),digit=Number(d.digit),total=Number(d.totalTicks);
    if(!symbol||!Number.isInteger(digit)||digit<0||digit>9||!Number.isSafeInteger(total)||total<1)return;
    const r=get(symbol,d.name);r.name=String(d.name||r.name);
    if(r.awaiting||!r.lastTotal){return;}
    if(total<=r.lastTotal)return;
    if(total!==r.lastTotal+1){r.awaiting=true;r.pending=[];r.digits=[];r.lastTotal=0;save();return;}
    consume(r,digit,d.tickId);r.lastTotal=total;save();render();
  }
  function onSnapshot(event){
    const rows=event.detail&&Array.isArray(event.detail.rows)?event.detail.rows:[];
    let changed=false;
    rows.forEach(row=>{
      const symbol=String(row.symbol||""),total=Number(row.totalTicks),digits=Array.isArray(row.digits)?row.digits.map(Number):[];
      if(!symbol||!Number.isSafeInteger(total)||total<1||!digits.length||digits.some(d=>!Number.isInteger(d)||d<0||d>9))return;
      const r=get(symbol,row.name);r.name=String(row.name||r.name);
      if(r.awaiting||!r.lastTotal){
        r.digits=digits.slice(-TRAIN);r.seq=total;r.lastTotal=total;r.pending=[];r.awaiting=false;changed=true;return;
      }
      const gap=total-r.lastTotal;if(gap<=0)return;
      if(gap>digits.length){r.digits=digits.slice(-TRAIN);r.seq=total;r.lastTotal=total;r.pending=[];changed=true;return;}
      digits.slice(-gap).forEach(d=>consume(r,d));r.lastTotal=total;changed=true;
    });
    if(changed){save();populateMarkets();render();}
  }
  function wilson(h,n){
    if(!n)return null;const z=1.96,p=h/n,z2=z*z,den=1+z2/n;
    const c=(p+z2/(2*n))/den,m=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
    return [Math.max(0,c-m),Math.min(1,c+m)];
  }
  function brier(arr,base){
    if(!arr.length)return null;let model=0,reference=0;
    arr.forEach(o=>{model+=(o.p-o.hit)**2;reference+=(base-o.hit)**2;});
    return reference>0?1-model/reference:null;
  }
  function normalSF(z){
    if(!Number.isFinite(z))return z>0?0:1;
    const x=Math.abs(z),t=1/(1+0.2316419*x);
    const poly=t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    const tail=0.3989422804014327*Math.exp(-x*x/2)*poly;
    return z>=0?tail:1-tail;
  }
  function pValue(arr,base){
    const n=arr.length;if(n<2)return null;
    const hits=arr.reduce((s,o)=>s+o.hit,0),rate=hits/n,se=Math.sqrt(base*(1-base)/n);
    return se?normalSF((rate-base)/se):(rate>base?0:1);
  }
  function buildRows(){
    const result=[];
    Object.values(state).forEach(r=>{
      ["MATCH","DIFFERS"].forEach(contract=>{
        const arr=contract==="MATCH"?r.match:r.differs,mode=contract==="MATCH"?"cold":"hot";
        const digit=r.digits.length===TRAIN?choose(r.digits,mode):null;
        const p=digit===null?null:probability(r.digits,digit,contract);
        const base=contract==="MATCH"?BASE:1-BASE;
        const hits=arr.reduce((s,o)=>s+o.hit,0),ci=wilson(hits,arr.length),skill=brier(arr,base);
        result.push({r,contract,arr,digit,p,base,hits,ci,skill,pv:pValue(arr,base),adj:null});
      });
    });
    const eligible=result.filter(x=>x.arr.length>=MIN_TESTS&&x.pv!==null).sort((a,b)=>a.pv-b.pv);
    let running=0;eligible.forEach((x,i)=>{running=Math.max(running,Math.min(1,(eligible.length-i)*x.pv));x.adj=running;});
    return result;
  }
  function populateMarkets(){
    const select=$("mdMarket"),prev=selectedSymbol||select.value,keys=Object.keys(state).sort((a,b)=>state[a].name.localeCompare(state[b].name));
    select.replaceChildren();
    keys.forEach(k=>select.add(new Option(state[k].name+" ("+k+")",k)));
    selectedSymbol=keys.includes(prev)?prev:(keys[0]||"");select.value=selectedSymbol;
  }
  function render(){
    const rows=buildRows(),contract=$("mdContract").value;
    const current=rows.find(x=>x.r.symbol===selectedSymbol&&x.contract===contract);
    const payout=Number($("mdPayout").value),hasQuote=Number.isFinite(payout)&&payout>1;
    const breakEven=hasQuote?1/payout:null;
    $("mdStatus").textContent=Object.keys(state).length+" markets · independent MATCH/DIFFERS outcomes saved locally · "+(storageOK?"storage active":"storage unavailable");
    if(current){
      $("mdDigit").textContent=current.digit===null?"Warming up":String(current.digit);
      $("mdChance").textContent=pct(current.p);
      $("mdBreakEven").textContent=breakEven===null?"Enter payout":pct(breakEven);
      $("mdTrials").textContent=current.arr.length.toLocaleString();
      const reasons=[];
      if(!hasQuote)reasons.push("Enter the live total payout ÷ stake quote.");
      if(current.arr.length<MIN_TESTS)reasons.push("Need at least "+MIN_TESTS+" scored outcomes; currently "+current.arr.length+".");
      if(current.adj===null||current.adj>=0.05)reasons.push("The model has not passed Holm-adjusted significance against its fair reference.");
      if(breakEven===null||current.p===null||current.p<=breakEven+0.02)reasons.push("The current estimated chance does not clear payout break-even by 2 percentage points.");
      if(!current.ci||breakEven===null||current.ci[0]<=breakEven+0.02)reasons.push("The 95% lower confidence bound does not clear payout break-even by 2 percentage points.");
      if(current.skill===null||current.skill<=0)reasons.push("Out-of-sample Brier skill is not positive.");
      const trade=reasons.length===0;
      $("mdDecision").innerHTML="<strong>"+(trade?"TRADE CANDIDATE":"DON'T TRADE")+"</strong>"+(trade?"All current research gates passed. Independently verify the quote and contract terms before any decision.":reasons.join(" "));
      $("mdDecision").style.borderColor=trade?"#287a58":"#76552b";
      $("mdDecision").style.background=trade?"#10281f":"#251d13";
      $("mdDecision").querySelector("strong").style.color=trade?"#67e0ad":"#ffc477";
      $("mdReason").textContent=current.ci?"Observed "+pct(current.hits/current.arr.length)+" · 95% Wilson interval "+pct(current.ci[0])+"–"+pct(current.ci[1])+" · Brier skill "+(current.skill===null?"—":pct(current.skill))+" · Holm-adjusted p "+(current.adj===null?"not eligible":current.adj.toFixed(4))+".":"Collecting validation outcomes. No recommendation can be made yet.";
    }else{
      $("mdDigit").textContent="—";$("mdChance").textContent="—";$("mdBreakEven").textContent=breakEven===null?"Enter payout":pct(breakEven);$("mdTrials").textContent="0";
      $("mdDecision").innerHTML="<strong>DON'T TRADE</strong>Waiting for selected market observations.";
    }
    $("mdRows").innerHTML=rows.length?rows.sort((a,b)=>(b.arr.length-a.arr.length)||a.r.name.localeCompare(b.r.name)||a.contract.localeCompare(b.contract)).map(x=>{
      const label=x.arr.length<MIN_TESTS?"Building validation":x.adj!==null&&x.adj<0.05&&x.ci&&x.ci[0]>x.base&&x.skill>0?"Statistically promising":"Not confirmed";
      return "<tr><td>"+escape(x.r.name)+"<small>"+escape(x.r.symbol)+"</small></td><td>"+x.contract+"</td><td>"+(x.digit===null?"—":x.digit)+"</td><td>"+pct(x.p)+"</td><td>"+x.arr.length+"</td><td>"+pct(x.arr.length?x.hits/x.arr.length:NaN)+"</td><td>"+(x.ci?pct(x.ci[0]):"—")+"</td><td>"+(x.adj===null?"—":x.adj.toFixed(4))+"</td><td>"+label+"</td></tr>";
    }).join(""):'<tr><td colspan="9">Waiting for live observations…</td></tr>';
  }
  $("mdMarket").addEventListener("change",e=>{selectedSymbol=e.target.value;render();});
  $("mdContract").addEventListener("change",render);
  $("mdPayout").addEventListener("input",render);
  load();populateMarkets();
  window.addEventListener("dsp:tick-observation",onTick);
  window.addEventListener("dsp:market-snapshot",onSnapshot);
  render();
})();
const {useEffect,useMemo,useRef,useState}=React;

const MARKETS=[
  ["R_10","Volatility 10"],["R_25","Volatility 25"],["R_50","Volatility 50"],
  ["R_75","Volatility 75"],["R_100","Volatility 100"],
  ["1HZ10V","Volatility 10 (1s)"],["1HZ25V","Volatility 25 (1s)"],
  ["1HZ50V","Volatility 50 (1s)"],["1HZ75V","Volatility 75 (1s)"],
  ["1HZ100V","Volatility 100 (1s)"]
];
const WINDOWS=[50,100,250,500,1000];
const FEED_URL="wss://api.derivws.com/trading/v1/options/ws/public";

function App(){
  const [market,setMarket]=useState("R_100");
  const [windowSize,setWindowSize]=useState(100);
  const [digit,setDigit]=useState(7);
  const [ticksByMarket,setTicksByMarket]=useState({});
  const [precision,setPrecision]=useState({});
  const [connection,setConnection]=useState("CONNECTING");
  const [message,setMessage]=useState("Opening Deriv public market-data connection…");
  const [updatedAt,setUpdatedAt]=useState(null);
  const current=ticksByMarket[market]||[];
  const latest=current[current.length-1]||null;
  const analysis=useMemo(()=>window.DigitAnalysis.analyse(current,windowSize,digit),[current,windowSize,digit]);
  const distribution=analysis.distribution;
  const maxCount=Math.max(1,...distribution.map(x=>x.count));

  useEffect(()=>{
    let socket=null;
    let reconnectTimer=null;
    let pingTimer=null;
    let retry=1000;
    let disposed=false;
    let subscriptionId=null;
    let didSubscribe=false;
    setTicksByMarket(previous=>({...previous,[market]:[]}));
    setUpdatedAt(null);

    function cleanupSocket(){
      if(reconnectTimer)clearTimeout(reconnectTimer);
      if(pingTimer)clearInterval(pingTimer);
      reconnectTimer=null;
      pingTimer=null;
      if(socket){
        if(socket.readyState===WebSocket.OPEN&&subscriptionId){
          try{socket.send(JSON.stringify({forget:subscriptionId}))}catch(_error){}
        }
        socket.onopen=null;
        socket.onmessage=null;
        socket.onerror=null;
        socket.onclose=null;
        try{socket.close()}catch(_error){}
      }
      socket=null;
      subscriptionId=null;
      didSubscribe=false;
    }

    function connect(){
      if(disposed)return;
      setConnection("CONNECTING");
      setMessage("Connecting to the Deriv public feed for "+market+"…");
      try{socket=new WebSocket(FEED_URL)}
      catch(error){scheduleReconnect("Could not open WebSocket: "+error.message);return}

      socket.onopen=()=>{
        if(disposed)return;
        retry=1000;
        setMessage("Connected to transport. Confirming Deriv API response…");
        socket.send(JSON.stringify({ping:1}));
        pingTimer=setInterval(()=>{
          if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({ping:1}));
        },25000);
      };

      socket.onmessage=(event)=>{
        let payload;
        try{payload=JSON.parse(event.data)}catch(_error){return}
        if(payload.error){
          setConnection("ERROR");
          setMessage(payload.error.message||"Deriv returned a feed error.");
          return;
        }
        if(payload.msg_type==="pong"||payload.msg_type==="ping"){
          if(!didSubscribe&&socket&&socket.readyState===WebSocket.OPEN){
            didSubscribe=true;
            setConnection("LIVE");
            setMessage("Public feed is ready. Waiting for the first tick from "+market+"…");
            socket.send(JSON.stringify({ticks:market,subscribe:1}));
          }
          return;
        }
        if(payload.msg_type==="tick"&&payload.tick){
          const tick=payload.tick;
          if(tick.symbol!==market)return;
          const pip=window.DigitAnalysis.readPrecision(tick.pip_size);
          if(pip===null){
            setMessage("Waiting for valid quote precision from Deriv; this tick was not counted.");
            return;
          }
          const normalized=window.DigitAnalysis.normalizeTick(tick,pip);
          if(!normalized){
            setMessage("A quote could not be interpreted at the supplied precision; it was not counted.");
            return;
          }
          setPrecision(previous=>({...previous,[market]:pip}));
          setTicksByMarket(previous=>{
            const existing=previous[market]||[];
            return {...previous,[market]:[...existing,normalized].slice(-1000)};
          });
          setUpdatedAt(Date.now());
          setConnection("LIVE");
          setMessage("Receiving live ticks for "+market+". Counts include only unique received observations.");
          if(payload.subscription&&payload.subscription.id)subscriptionId=payload.subscription.id;
        }
      };

      socket.onerror=()=>{
        if(disposed)return;
        scheduleReconnect("The Deriv WebSocket reported a connection error. Reconnecting…");
      };
      socket.onclose=()=>{
        if(disposed)return;
        setConnection("RECONNECTING");
        scheduleReconnect("Feed connection closed. Reconnecting…");
      };
    }

    function scheduleReconnect(text){
      if(disposed)return;
      setConnection("RECONNECTING");
      setMessage(text);
      cleanupSocket();
      reconnectTimer=setTimeout(()=>{
        retry=Math.min(retry*2,15000);
        connect();
      },retry);
    }

    connect();
    return ()=>{
      disposed=true;
      cleanupSocket();
    };
  },[market]);

  const connectionTone=connection==="LIVE"?"bg-emerald-400":connection==="CONNECTING"||connection==="RECONNECTING"?"bg-amber-400":"bg-rose-400";
  const precisionText=precision[market]===undefined?"Waiting for feed":precision[market]+" decimal places";

  return <div className="min-h-screen bg-[#07111f] text-slate-100">
    <header className="border-b border-slate-800 bg-[#0a1727]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div><div className="text-xl font-black tracking-wide">DigitScope <span className="text-cyan-300">Pro</span></div><div className="text-[10px] tracking-[.24em] text-slate-500">DERIV LAST-DIGIT ANALYSIS</div></div>
        <div className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs"><span className={"h-2 w-2 rounded-full "+connectionTone}></span><span>{connection==="LIVE"?"LIVE PUBLIC FEED":connection}</span></div>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#13283c] to-[#0b1727] p-5 sm:p-7">
        <div className="text-[10px] font-bold tracking-[.24em] text-cyan-300">LIVE MARKET OBSERVATIONS</div>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Read the digits.<br/><span className="text-cyan-300">See the counts.</span></h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">A focused view of live Deriv last digits. Select a market, choose a sample window and inspect observed MATCHES and DIFFERS for any digit from 0 to 9.</p>
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-300">{message}</div>
      </section>

      <section className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <label className="rounded-xl border border-slate-800 bg-[#0d1b2c] p-4 text-xs text-slate-400">SELECT DERIV MARKET
          <select value={market} onChange={event=>setMarket(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white">
            {MARKETS.map(([symbol,label])=><option key={symbol} value={symbol}>{label} · {symbol}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="LATEST QUOTE" value={latest?latest.quoteText:"—"}/>
          <Metric label="LAST DIGIT" value={latest?latest.digit:"—"}/>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#0d1b2c] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] tracking-[.2em] text-cyan-300">LIVE DIGIT TAPE</div><h2 className="mt-1 text-lg font-bold">{market}</h2></div><div className="text-xs text-slate-500">{current.length} buffered ticks · {precisionText}</div></div>
        <div className="mt-4 flex min-h-12 gap-2 overflow-x-auto pb-2">{current.slice(-40).map((tick,index)=><span key={index} title={tick.quoteText} className={"grid h-10 min-w-10 place-items-center rounded-lg border text-sm font-bold "+(tick.digit===digit?"border-cyan-300 bg-cyan-300/15 text-cyan-200":"border-slate-700 bg-slate-950 text-slate-200")}>{tick.digit}</span>)}{current.length===0&&<div className="py-3 text-xs text-slate-500">Waiting for the first tick from this market…</div>}</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#0d1b2c] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] tracking-[.2em] text-cyan-300">SAMPLE WINDOW</div><h2 className="mt-1 text-lg font-bold">Choose how many recent ticks to analyse</h2></div><div className="text-xs text-slate-400">Available: {current.length.toLocaleString()} / 1,000</div></div>
        <div className="mt-4 flex flex-wrap gap-2">{WINDOWS.map(size=><button key={size} onClick={()=>setWindowSize(size)} className={"rounded-lg border px-4 py-2 text-sm "+(windowSize===size?"border-cyan-300 bg-cyan-300/10 text-cyan-200":"border-slate-700 text-slate-300 hover:border-slate-500")}>{size.toLocaleString()}</button>)}</div>
        <div className="mt-4 text-xs text-slate-500">The sample uses the most recent {Math.min(windowSize,current.length)} valid observations from the selected market. It grows as new live ticks arrive, up to the selected window size.</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#0d1b2c] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] tracking-[.2em] text-cyan-300">SELECTED DIGIT</div><h2 className="mt-1 text-lg font-bold">Choose a digit to compare</h2></div><div className="text-xs text-slate-400">Sample count: {analysis.sampleCount}</div></div>
        <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">{Array.from({length:10},(_,value)=><button key={value} onClick={()=>setDigit(value)} aria-pressed={digit===value} className={"rounded-xl border py-3 text-lg font-black "+(digit===value?"border-cyan-300 bg-cyan-300/15 text-cyan-200":"border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500")}>{value}</button>)}</div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#0d1b2c] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] tracking-[.2em] text-cyan-300">DIGIT DISTRIBUTION</div><h2 className="mt-1 text-lg font-bold">Observed frequency · digit 0–9</h2></div><div className="text-xs text-slate-400">N = {analysis.sampleCount} / {windowSize}</div></div>
        <div className="mt-5 grid grid-cols-5 gap-3 sm:grid-cols-10">{distribution.map(item=><div key={item.digit} className={"rounded-xl p-2 text-center "+(item.digit===digit?"bg-cyan-300/10 ring-1 ring-cyan-300/50":"bg-slate-950/70")}><div className="flex h-24 items-end"><div className="w-full rounded-t-md bg-cyan-500/80" style={{height:(item.count/maxCount*100)+"%"}}></div></div><div className="mt-2 text-sm font-bold">{item.digit}</div><div className="text-[11px] text-slate-300">{item.count}</div><div className="text-[10px] text-slate-500">{item.percentage.toFixed(1)}%</div></div>)}</div>
        <p className="mt-3 text-xs text-slate-500">Each bar shows the count and percentage of that digit in this exact sample. These are observations, not a forecast.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <ResultCard title="MATCHES" subtitle={"The next observed digit equals "+digit} count={analysis.matches.count} percentage={analysis.matches.percentage} sample={analysis.sampleCount} tone="green"/>
        <ResultCard title="DIFFERS" subtitle={"The next observed digit is not "+digit} count={analysis.differs.count} percentage={analysis.differs.percentage} sample={analysis.sampleCount} tone="cyan"/>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-6 text-slate-400">
        <div className="font-bold text-slate-200">HOW TO READ THESE RESULTS</div>
        <p>MATCHES counts observations equal to the selected digit. DIFFERS counts all other observations. Both use the same market, same recent sample and same denominator. Their counts add to the sample size and their percentages add to 100% when the sample is non-empty.</p>
        <p className="mt-2">The percentages describe only the selected historical/live sample. They do not guarantee the next tick, predict a winning contract or demonstrate a profitable trading strategy.</p>
        <p className="mt-2">Feed precision: {precisionText}. One live subscription is used for the selected market; historical replay is not merged into this sample. Repeated quotes are retained as separate observations because the feed does not provide a separate unique event ID for each tick. {updatedAt?"Last received tick: "+new Date(updatedAt).toLocaleTimeString():"No tick received yet."}</p>
      </section>
    </main>
    <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-[10px] text-slate-600">DigitScope Pro · Public Deriv market data · Observed frequencies only · No trade execution</footer>
  </div>;
}

function Metric({label,value}){return <div className="rounded-xl border border-slate-800 bg-[#0d1b2c] p-4"><div className="text-[10px] tracking-wider text-slate-500">{label}</div><div className="mt-2 truncate text-xl font-black text-cyan-200">{value}</div></div>}
function ResultCard({title,subtitle,count,percentage,sample,tone}){
  const accent=tone==="green"?"text-emerald-300 border-emerald-400/30":"text-cyan-200 border-cyan-400/30";
  return <div className={"rounded-2xl border bg-[#0d1b2c] p-5 "+accent}><div className="text-xs font-black tracking-[.2em]">{title}</div><div className="mt-2 text-sm text-slate-300">{subtitle}</div><div className="mt-5 flex items-end justify-between gap-2"><div><div className="text-3xl font-black">{count.toLocaleString()}</div><div className="mt-1 text-xs text-slate-500">observations</div></div><div className="text-right"><div className="text-3xl font-black">{percentage.toFixed(1)}%</div><div className="mt-1 text-xs text-slate-500">of {sample.toLocaleString()} ticks</div></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-900"><div className={"h-full rounded-full "+(tone==="green"?"bg-emerald-400":"bg-cyan-400")} style={{width:percentage+"%"}}></div></div></div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);

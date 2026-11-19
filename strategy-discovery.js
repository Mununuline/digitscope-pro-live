"use strict";

const ALLOWED_MARKETS = new Set(["R_10","R_25","R_50","R_75","R_100","1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"]);

function countsOf(digits) {
  const counts = Array(10).fill(0);
  for (const digit of digits) counts[digit]++;
  return counts;
}
function uniqueExtremeIndex(values,extreme){const target=extreme==="max"?Math.max(...values):Math.min(...values);const matches=[];values.forEach((v,i)=>{if(v===target)matches.push(i)});return matches.length===1?matches[0]:null;}
function chooseHot(digits) { return uniqueExtremeIndex(countsOf(digits),"max"); }
function chooseCold(digits) { return uniqueExtremeIndex(countsOf(digits),"min"); }
function chooseTransition(digits) {
  const matrix=Array.from({length:10},()=>Array(10).fill(0));
  for(let i=0;i<digits.length-1;i++) matrix[digits[i]][digits[i+1]]++;
  const row=matrix[digits[digits.length-1]];
  if(row.reduce((a,b)=>a+b,0)<5) return null;
  return uniqueExtremeIndex(row,"max");
}
function chooseRepeat(digits) { return digits.length>=2?digits[digits.length-1]:null; }
function chooseAlternate(digits) {
  if(digits.length<3) return null;
  return digits[digits.length-1]===digits[digits.length-2]?null:digits[digits.length-2];
}
const STRATEGIES=[
 {id:"rolling-hot-100-v1",label:"Rolling hot digit · 100",window:100,pick:chooseHot},
 {id:"rolling-cold-100-v1",label:"Rolling cold digit · 100",window:100,pick:chooseCold},
 {id:"rolling-hot-250-v1",label:"Rolling hot digit · 250",window:250,pick:chooseHot},
 {id:"rolling-cold-250-v1",label:"Rolling cold digit · 250",window:250,pick:chooseCold},
 {id:"conditional-transition-250-v1",label:"Conditional transition · 250",window:250,pick:chooseTransition},
 {id:"repeat-last-v1",label:"Repeat-last hypothesis",window:100,pick:chooseRepeat},
 {id:"alternate-last-v1",label:"Alternate-last hypothesis",window:100,pick:chooseAlternate}
];
function wilsonLowerBound(wins,trials,z=1.96){
 if(!trials)return 0;
 const p=wins/trials,z2=z*z;
 return (p+z2/(2*trials)-z*Math.sqrt((p*(1-p)+z2/(4*trials))/trials))/(1+z2/trials);
}
function regimeSnapshot(digits){
 const counts=countsOf(digits),n=digits.length;
 const rates=counts.map(x=>x/n);
 const entropy=-rates.reduce((sum,p)=>sum+(p? p*Math.log2(p):0),0);
 const matrix=Array.from({length:10},()=>Array(10).fill(0));
 for(let i=1;i<digits.length;i++)matrix[digits[i-1]][digits[i]]++;
 const lastRow=matrix[digits[n-1]],rowN=lastRow.reduce((a,b)=>a+b,0);
 const transitionEntropy=rowN?lastRow.reduce((sum,x)=>{const p=x/rowN;return sum+(p?-p*Math.log2(p):0)},0):null;
 const maxRate=Math.max(...rates),minRate=Math.min(...rates);
 return {label:maxRate-minRate<0.035?"BALANCED / LOW SKEW":entropy<3.0?"FREQUENCY SKEW":"MIXED / NO CLEAR REGIME",digitCounts:counts,digitEntropyBits:Number(entropy.toFixed(3)),maxDigitShare:Number(maxRate.toFixed(3)),minDigitShare:Number(minRate.toFixed(3)),lastDigit:digits[n-1],lastDigitTransitionSamples:rowN,conditionalTransitionEntropyBits:transitionEntropy===null?null:Number(transitionEntropy.toFixed(3))};
}
/**
 * Exploratory retrospective replay only. At every historical origin the
 * strategy sees preceding ticks only. This is NOT untouched shadow validation:
 * the same supplied series is used to compare candidates, so all rankings are
 * research hypotheses and never confer trade eligibility.
 */
function discoverStrategies(input){
 const market=String(input.market||"");
 if(!ALLOWED_MARKETS.has(market))throw new Error("Unsupported market.");
 if(!Array.isArray(input.digits)||input.digits.length>1000||input.digits.some(d=>!Number.isInteger(d)||d<0||d>9))
  throw new Error("Provide up to 1,000 valid last digits (0–9).");
 const digits=input.digits;
 if(digits.length<300)return {market,status:"WAIT",message:"Collect at least 300 sequential ticks before strategy discovery.",observations:digits.length,candidates:[],tradeEligible:false,decision:"WAIT"};
 const candidates=STRATEGIES.map(strategy=>{
  let trials=0,wins=0;
  for(let target= strategy.window;target<digits.length;target++){
   const prediction=strategy.pick(digits.slice(target-strategy.window,target));
   if(!Number.isInteger(prediction)||prediction<0||prediction>9)continue;
   trials++; if(prediction===digits[target])wins++;
  }
  const latestHistory=digits.slice(-strategy.window);
  const latestPrediction=strategy.pick(latestHistory);
  return {id:strategy.id,label:strategy.label,contract:"DIGIT_MATCH",targetDigit:Number.isInteger(latestPrediction)?latestPrediction:null,forecastHorizonTicks:1,trainingWindow:strategy.window,trials,wins,hitRate:trials?wins/trials:null,wilsonLowerBound:trials?wilsonLowerBound(wins,trials):null,status:trials>=100?"EXPLORATORY_CANDIDATE":"INSUFFICIENT_EVIDENCE"};
 }).sort((a,b)=>(b.hitRate??-1)-(a.hitRate??-1));
 const best=candidates.find(c=>Number.isInteger(c.targetDigit))||null;
 return {market,status:"RESEARCH_ONLY",observations:digits.length,regime:regimeSnapshot(digits),latestDigit:digits[digits.length-1],forecast:{targetDigit:best?.targetDigit??null,contract:"MATCHES",horizonTicks:1,strategyId:best?.id??null,strategyLabel:best?.label??null,reason:best?"Top retrospective candidate by exploratory hit rate; not independently validated.":"No candidate can currently issue a digit forecast."},methodology:"Chronological one-step retrospective replay: each historical prediction uses only preceding ticks. Candidate ranking is exploratory and affected by repeated hypothesis testing; it is not future shadow validation or proof of an edge.",baselineHitRate:0.10,candidates,tradeEligible:false,decision:"WAIT",execution:"DISABLED — research only; no order is placed."};
}
module.exports={discoverStrategies,wilsonLowerBound,regimeSnapshot};

(function(root){
  "use strict";

  function readPrecision(value){
    if(value===null||value===undefined||value==="")return null;
    const precision=Number(value);
    return Number.isInteger(precision)&&precision>=0&&precision<=10?precision:null;
  }

  function formatQuote(quote,precisionValue){
    const precision=readPrecision(precisionValue);
    const value=Number(quote);
    if(precision===null||!Number.isFinite(value))return null;
    return value.toFixed(precision);
  }

  function lastDigit(quote,precisionValue){
    const formatted=formatQuote(quote,precisionValue);
    if(formatted===null)return null;
    const digits=formatted.replace(/[^0-9]/g,"");
    if(!digits)return null;
    const character=readPrecision(precisionValue)===0?digits.slice(-1):formatted.split(".")[1].slice(-1);
    return /^\d$/.test(character)?Number(character):null;
  }

  function normalizeTick(tick,precisionValue){
    if(!tick||typeof tick!=="object")return null;
    const quoteText=formatQuote(tick.quote,precisionValue);
    const digit=lastDigit(tick.quote,precisionValue);
    if(quoteText===null||digit===null)return null;
    const epoch=Number(tick.epoch);
    return {
      id:null,
      quote:Number(tick.quote),
      quoteText,
      digit,
      epoch:Number.isFinite(epoch)?epoch:null
    };
  }

  function analyse(ticks,windowSize,selectedDigit){
    const size=Number(windowSize);
    const target=Number(selectedDigit);
    if(!Array.isArray(ticks))throw new TypeError("ticks must be an array");
    if(!Number.isInteger(size)||size<1)throw new RangeError("windowSize must be a positive integer");
    if(!Number.isInteger(target)||target<0||target>9)throw new RangeError("selectedDigit must be an integer from 0 to 9");
    const sample=ticks.filter(item=>item&&Number.isInteger(item.digit)&&item.digit>=0&&item.digit<=9).slice(-size);
    const total=sample.length;
    const counts=Array(10).fill(0);
    sample.forEach(item=>counts[item.digit]++);
    const matches=counts[target];
    const differs=total-matches;
    const percentage=(count)=>total?count/total*100:0;
    return {
      requestedWindow:size,
      sampleCount:total,
      selectedDigit:target,
      matches:{count:matches,percentage:percentage(matches)},
      differs:{count:differs,percentage:percentage(differs)},
      distribution:counts.map((count,digit)=>({digit,count,percentage:percentage(count)}))
    };
  }

  root.DigitAnalysis={readPrecision,formatQuote,lastDigit,normalizeTick,analyse};
  if(typeof module!=="undefined"&&module.exports)module.exports=root.DigitAnalysis;
})(typeof globalThis!=="undefined"?globalThis:this);

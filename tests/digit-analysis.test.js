const test=require("node:test");
const assert=require("node:assert/strict");
const analysis=require("../public/digit-analysis.js");

test("precision is accepted only as an integer from zero to ten",()=>{
  assert.equal(analysis.readPrecision(2),2);
  assert.equal(analysis.readPrecision("3"),3);
  for(const value of [null,undefined,"",1.5,-1,11,"unknown"])assert.equal(analysis.readPrecision(value),null);
});

test("last digit uses the quote precision, including trailing zeroes",()=>{
  assert.equal(analysis.formatQuote(123.4,2),"123.40");
  assert.equal(analysis.lastDigit(123.4,2),0);
  assert.equal(analysis.lastDigit(123.456,3),6);
  assert.equal(analysis.lastDigit(123.456,2),6);
  assert.equal(analysis.lastDigit(123,0),3);
  assert.equal(analysis.lastDigit(123,"0"),3);
  assert.equal(analysis.lastDigit(0.007,3),7);
});

test("quote precision does not silently default when missing or invalid",()=>{
  assert.equal(analysis.formatQuote(12.34,null),null);
  assert.equal(analysis.lastDigit(12.34,undefined),null);
  assert.equal(analysis.normalizeTick({quote:12.34,epoch:1},null),null);
});

test("normalization preserves quote and precision without treating subscription IDs as tick IDs",()=>{
  const item=analysis.normalizeTick({id:"subscription-1",quote:12.3,epoch:1700000000},2);
  assert.deepEqual(item,{id:null,quote:12.3,quoteText:"12.30",digit:0,epoch:1700000000});
});

test("distribution counts every digit in the selected recent window",()=>{
  const ticks=[0,1,1,2,9,1].map((digit)=>({digit}));
  const result=analysis.analyse(ticks,5,1);
  assert.equal(result.sampleCount,5);
  assert.deepEqual(result.distribution.map(x=>x.count),[0,3,1,0,0,0,0,0,0,1]);
  assert.equal(result.matches.count,3);
  assert.equal(result.differs.count,2);
  assert.equal(result.matches.percentage,60);
  assert.equal(result.differs.percentage,40);
});

test("MATCHES and DIFFERS partition the same sample for every selected digit",()=>{
  const ticks=[0,0,1,2,3,4,5,6,7,8,9].map(digit=>({digit}));
  for(let digit=0;digit<=9;digit++){
    const result=analysis.analyse(ticks,100,digit);
    assert.equal(result.matches.count+result.differs.count,result.sampleCount);
    assert.ok(Math.abs(result.matches.percentage+result.differs.percentage-100)<1e-10);
  }
});

test("incomplete samples report actual observations and empty samples return zero percentages",()=>{
  const partial=analysis.analyse([{digit:2},{digit:2}],100,2);
  assert.equal(partial.requestedWindow,100);
  assert.equal(partial.sampleCount,2);
  assert.equal(partial.matches.count,2);
  assert.equal(partial.matches.percentage,100);
  const empty=analysis.analyse([],100,2);
  assert.equal(empty.sampleCount,0);
  assert.equal(empty.matches.percentage,0);
  assert.equal(empty.differs.percentage,0);
});

test("invalid digit records are excluded rather than corrupting the denominator",()=>{
  const result=analysis.analyse([{digit:1},{digit:12},{digit:null},{digit:2}],10,1);
  assert.equal(result.sampleCount,2);
  assert.equal(result.matches.count,1);
  assert.equal(result.differs.count,1);
  const recent=analysis.analyse([{digit:1},{digit:12},{digit:2},{digit:3}],2,2);
  assert.equal(recent.sampleCount,2);
  assert.equal(recent.matches.count,1);
  assert.equal(recent.differs.count,1);
});

test("repeated quote and timestamp observations remain separate",()=>{
  const first=analysis.normalizeTick({quote:12.34,epoch:100},2);
  const second=analysis.normalizeTick({quote:12.34,epoch:100},2);
  assert.equal(first.id,null);
  assert.equal(second.id,null);
  assert.notEqual(first,second);
});

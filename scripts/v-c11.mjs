const toSlash=(y)=>`${y.slice(0,4)}/${y.slice(4,6)}/${y.slice(6,8)}`;
const num=(s)=>{const n=parseFloat(String(s).replace(/,/g,''));return isNaN(n)?null:n;};
async function close(ymd,code){const r=await fetch(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlash(ymd)}&type=EW&response=json`,{headers:{'User-Agent':'Mozilla/5.0'}});const j=await r.json();const row=j.tables?.[0]?.data?.find(x=>String(x[0]).trim()===code);return row?num(row[2]):null;}
const days=['20260519','20260520','20260521','20260522','20260525','20260526'];
const gap11=(p)=>70+Math.floor(p/300)*15;
const exp={'3131':535,'3211':110,'6138':87.5,'4760':92};
for(const [code,e] of Object.entries(exp)){const cs=[];for(const d of days)cs.push(await close(d,code));const cur=cs[cs.length-1],min=Math.min(...cs.filter(x=>x));const spread=cur-min;console.log(code,'spread',spread.toFixed(1),'expect',e,'gap',gap11(cur),spread>=gap11(cur)?'FIRES':'no');}

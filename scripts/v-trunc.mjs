const good = (x) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100; };
const r = (47.3 / 43.0 - 1) * 100;
console.log('raw', r, 'good', good(r));
if (good(r) !== 10) { console.error('FAIL good'); process.exit(1); }
const c = [43, 47.3, 52, 57.2, 62.9, 69.1, 68.1]; // 4127 天良 base 5/18=43 → 5/26
let s = 0; for (let i = 1; i < c.length; i++) s += good((c[i] / c[i-1] - 1) * 100);
console.log('4127 sum', +s.toFixed(2), '(expect 48.30)');
if (+s.toFixed(2) !== 48.30) { console.error('FAIL 4127'); process.exit(1); }
console.log('PASS');

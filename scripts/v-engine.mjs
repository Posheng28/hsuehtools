const PCT = { TPEx:{sbl11:70,sblStep:300,sblAdd:15}, TWSE:{sbl11:100,sblStep:500,sblAdd:25} };
const gap11 = (m,p)=>PCT[m].sbl11 + Math.floor(p/PCT[m].sblStep)*PCT[m].sblAdd;
const cases=[['TPEx',51.8,70],['TPEx',355.5,85],['TPEx',464,85],['TPEx',930,115],['TPEx',3425,235]];
let ok=true; for(const [m,p,e] of cases){ const g=gap11(m,p); if(g!==e){console.error('FAIL',p,g,'expect',e);ok=false;} }
console.log(ok?'gap11 PASS':'gap11 FAIL'); if(!ok)process.exit(1);

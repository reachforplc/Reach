// Reproducible fictional CSV fixtures, not derived from student records.
const fs=require('node:fs');
const keys=['B','A','A','B','B','C','A','A','C','A'];
let seed=20252026;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const headers=['Quiz Name','Class','Earned Points','Possible Points',...keys.flatMap((_,i)=>['Student Response','Primary Answer','Grade Mark','Points Earned','Points Possible'].map(k=>`#${i+1} ${k}`))];
const result=[];
for(const [teacher,count,scale] of [['A',80,1],['B',70,2]]){
 const rows=[headers];let points=0,proficient=0;
 for(let i=0;i<count;i++){
  const ability=.45+random()*.5;
  const hits=keys.map((k,j)=>random()<Math.min(.98,Math.max(.1,ability+[.05,.12,-.05,.1,-.12,.12,.15,-.2,-.1,.12][j])));
  const correct=hits.filter(Boolean).length;points+=correct;proficient+=correct>=7;
  rows.push(['ESS Unit 1','Combined sections — FICTIONAL DEMO',correct*scale,10*scale,...keys.flatMap((k,j)=>[hits[j]?k:['A','B','C','D'].filter(a=>a!==k)[Math.floor(random()*3)],k,hits[j]?'C':'X',hits[j]?scale:0,scale])]);
 }
 const path=`test-data/assessment-analytics/ESS-Unit-1-2025-2026-Teacher-${teacher}-FICTIONAL-DEMO.csv`;
 fs.writeFileSync(path,rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
 result.push({teacher,count,mean:100*points/(count*10),proficient:100*proficient/count,path});
}
fs.writeFileSync('test-data/assessment-analytics/expected.json',JSON.stringify(result,null,2));
console.log(result);

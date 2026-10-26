const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(fs.existsSync('index.html')?'index.html':'source/github-index.html','utf8');
const c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function zipGradeColumns'),html.indexOf('    const { useState,')),c);
vm.runInContext(html.slice(html.indexOf('function parseCSVFull'),html.indexOf('function parseICGradebook')),c);
vm.runInContext(html.slice(html.indexOf('function parsePriorAnalyticsCSV'),html.indexOf('function computeStats')),c);
vm.runInContext(html.slice(html.indexOf('function computeRiskStatus'),html.indexOf('function TeacherBreakdownCard')),c);
const fixture=name=>c.parseZipGradeCSV(c.parseCSVFull(fs.readFileSync(`test-data/${name}.csv`,'utf8')),name);
test('CITC excludes the item from the total (independent demo calculations)',()=>{
 const stats=c.computeItemPooledStats(fixture('Reach-ZipGrade-Demo-20-Students'));
 assert.equal(stats['1'].citc,.71);
 assert.equal(stats['2'].citc,-.05);
 assert.equal(stats['13'].citc,-.01);
 assert.equal(stats['16'].citc,-.08);
 assert.equal(stats['1'].diff,.8);
});
test('CITC uses earned points for partial credit and is unavailable without variance',()=>{
 const sec={itemData:{},students:[0,.5,1].map(x=>({pct:50,items:[{itemId:'1',earned:x,correct:false},{itemId:'2',earned:2*x}]}))};
 assert.equal(c.computeItemPooledStats([sec])['1'].citc,1);
 sec.students.forEach(s=>s.items[1].earned=1);
 assert.equal(c.computeItemPooledStats([sec])['1'].citc,null);
 sec.students.forEach(s=>s.items.pop());
 assert.equal(c.computeItemPooledStats([sec])['1'].citc,null);
});
test('second assessment keeps 20 identities and yields all four expected risk categories',()=>{
 const first=fixture('Reach-ZipGrade-Demo-20-Students');
 const second=fixture('Reach-ZipGrade-Demo-Assessment-2');
 const baseline=c.buildGrowthData(first,first[0].currentAssessment,null,null,{},{});
 const prior=c.parsePriorAnalyticsCSV(c.parseCSVFull(baseline.buildAnalyticsCSV())).students;
 const result=c.buildGrowthData(second,second[0].currentAssessment,null,prior,{},{});
 assert.equal(result.totalStudents,20);
 assert.equal(result.reassessments.length,0);
 const counts={};
 result.enriched.forEach(s=>{assert.equal(s.history.length,1);counts[s.riskStatus]=(counts[s.riskStatus]||0)+1;});
 assert.deepEqual(counts,{PERSISTENTLY_AT_RISK:6,AT_RISK:3,OK:8,RECOVERING:3});
 assert.equal(result.enriched.find(s=>s.studentId==='9004').name,'Paper 4');
});
test('report effect refreshes on data/history/settings changes and clears removed data',()=>{
 const start=html.indexOf('  // Keep report and risk history synchronized');
 const effect=html.slice(start,html.indexOf('  const GRADE_COLORS',start));
 let callback,deps,rebuilds=0,report='old',growth='old';
 const inputs={sections:[{}],subgroupMap:null,priorMap:null,nameMap:{},currentAssessmentName:'Test',teamSettings:{proficiencyThreshold:70,riskSettings:{}}};
 const run=()=>vm.runInNewContext(effect,{...inputs,React:{useEffect:(fn,d)=>{callback=fn;deps=d;}},rebuildReport:()=>rebuilds++,setReport:v=>report=v,setGrowthData:v=>growth=v});
 run();callback();assert.equal(rebuilds,1);
 for(const key of ['sections','subgroupMap','priorMap','nameMap','currentAssessmentName']){
  const before=deps;
  inputs[key]=key==='sections'?[{students:[]}]:key==='currentAssessmentName'?'Next':{updated:true};
  run();assert.ok(deps.some((v,i)=>v!==before[i]),key);callback();
 }
 inputs.sections=[];run();callback();assert.equal(report,null);assert.equal(growth,null);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(fs.existsSync('index.html')?'index.html':'source/github-index.html','utf8');
const moduleSource=html.split('// BEGIN ASSESSMENT ANALYTICS\n')[1].split('// END ASSESSMENT ANALYTICS')[0];
const c=vm.createContext({crypto:webcrypto});
vm.runInContext(html.slice(html.indexOf('function zipGradeColumns'),html.indexOf('    const { useState,')),c);
vm.runInContext(html.slice(html.indexOf('function parseCSVFull'),html.indexOf('function parseICGradebook')),c);
vm.runInContext(moduleSource.slice(0,moduleSource.indexOf('function AssessmentAnalytics(')),c);
const csv=(scale=1)=>[
 ['Quiz Name','Class','Student First Name','Student Last Name','Student ID','External Ref','Paper Timestamp','Earned Points','Possible Points','#1 Student Response','#1 Primary Answer','#1 Grade Mark','#1 Points Earned','#1 Points Possible','#2 Student Response','#2 Primary Answer','#2 Grade Mark','#2 Points Earned','#2 Points Possible'],
 ['Unit 1','Period 1','PrivateFirst','PrivateLast','secret-id','secret-ref','secret-time',2*scale,2*scale,'A','A','C',scale,scale,'B','B','C',scale,scale],
 ['Unit 1','Period 2','PrivateFirst','PrivateLast','secret-id','secret-ref','secret-time',scale,2*scale,'A','A','C',scale,scale,'A','B','X',0,scale]
].map(r=>r.join(',')).join('\n');
const draft=(papers,extra={})=>({assessment:'Unit 1',version:'Original',year:'2026-2027',teacher:'Teacher A',section:'Period 1',aligned:true,papers,...extra});
const record=(extra={})=>c.analyticsRecord(draft(c.analyticsParse(csv())[0].papers,extra));
test('groups sections and strips every student identifier before persistence',()=>{
 const parsed=c.analyticsParse(csv());assert.equal(parsed.length,2);
 const saved=c.analyticsRecord({...draft(parsed[0].papers),filename:'private-file.csv',studentId:'hidden'});
 assert.doesNotMatch(JSON.stringify(saved),/Private|secret|filename|studentId|name|timestamp/);
 assert.equal(saved.papers[0].pct,100);
 assert.throws(()=>c.analyticsRecord({...saved,year:'2026-2026'}),/school year/);
});
test('unequal class sizes weight papers, not teachers; scales normalize',()=>{
 const groups=c.analyticsParse(csv()),double=c.analyticsParse(csv(2));
 const first=record(),second=c.analyticsRecord(draft([...groups[1].papers,...groups[1].papers,...groups[1].papers],{teacher:'Teacher B'}));
 assert.equal(c.analyticsSummary([first,second]).mean,62.5);
 assert.equal(c.analyticsSummary([first,second]).proficiency,25);
 assert.equal(c.analyticsSignature(groups[0].papers[0]),c.analyticsSignature(double[0].papers[0]));
 assert.deepEqual(JSON.parse(JSON.stringify(c.analyticsItems([first]))),JSON.parse(JSON.stringify(c.analyticsItems([c.analyticsRecord(draft(double[0].papers))]))));
});
test('alignment, version metadata and question weights protect item comparisons',()=>{
 const a=record(),b=record({teacher:'Teacher B',aligned:false});assert.equal(c.analyticsComparable([a,b]),false);
 b.aligned=true;assert.equal(c.analyticsComparable([a,b]),true);
 b.papers[0].items[0].primaryAnswer='C';assert.equal(c.analyticsComparable([a,b]),false);
 assert.throws(()=>c.analyticsParse(csv().replace('2,2,A,A,C,1,1','2,3,A,A,C,1,1')),/totals/);
});
test('replacement keys ignore filename; teachers, sections and years stay separate',()=>{
 const a={...record(),savedAt:'2026-10-26T00:00:00Z',id:'a'};
 const newer={...a,savedAt:'2026-10-27T00:00:00Z',id:'b'};
 const other={...a,teacher:'Teacher B',id:'c'};
 const prior={...a,year:'2025-2026',id:'d'};
 const list=c.analyticsLatest([a,newer,other,prior]);assert.equal(list.length,3);assert.ok(list.some(r=>r.id==='b'));assert.ok(!list.some(r=>r.id==='a'));
});
test('five teachers with mixed section counts retain separate cohorts and anonymous exports work',()=>{
 const records=[];
 for(let t=1;t<=5;t++)for(let section=1;section<=(t%2?3:1);section++)records.push(record({teacher:`Teacher ${t}`,section:`Period ${section}`}));
 assert.equal(c.analyticsLatest(records.map((r,i)=>({...r,id:String(i),savedAt:'2026-10-26'}))).length,11);
 assert.equal(c.analyticsSummary(records).n,11);
 const rows=csv().split('\n').map(r=>r.split(','));
 const anonymous=rows.map(r=>r.filter((_,i)=>![2,3,4,5,6].includes(i)).join(',')).join('\n');
 assert.equal(c.analyticsParse(anonymous).length,2);
});
test('cohort comparisons preserve years and correctly handle proficiency boundaries',()=>{
 const prior=record({year:'2025-2026'}),current=record({year:'2026-2027'});
 prior.papers[0].pct=69.999;current.papers[0].pct=70;
 assert.equal(c.analyticsSummary([prior],70).proficiency,0);
 assert.equal(c.analyticsSummary([current],70).proficiency,100);
 assert.equal(c.analyticsLatest([{...prior,id:'a'},{...current,id:'b'}]).length,2);
 assert.equal(c.analyticsSummary([],70).mean,null);
});
test('Drive paginates and fails closed on incomplete data',async()=>{
 let calls=0;
 const fetcher=async url=>{
  calls++;
  if(url.includes('?alt=media'))return{ok:true,json:async()=>({...record(),savedAt:'2026-10-26'})};
  return{ok:true,json:async()=>url.includes('pageToken')?{files:[{id:'b'}]}:{files:[{id:'a'}],nextPageToken:'next'}};
 };
 const records=await c.analyticsDriveList(fetcher,'token','folder');assert.equal(calls,4);assert.equal(records.length,1);
 await assert.rejects(c.analyticsDriveList(async()=>({ok:false}),'token','folder'),/load team uploads/);
});
test('Drive rejects unreviewed replacement and writes only anonymous section data',async()=>{
 const previous={...record(),savedAt:'2026-10-26'};let body='';
 const fetcher=async(url,options)=>{
  if(options.method==='POST'){body=options.body;return{ok:true,json:async()=>({id:'new'})};}
  return{ok:true,json:async()=>url.includes('?alt=media')?previous:{files:[{id:'existing'}]}};
 };
 await assert.rejects(c.analyticsDriveSave(fetcher,'token','folder',previous,null),/changed since/);
 const saved=await c.analyticsDriveSave(fetcher,'token','folder',previous,'existing');assert.equal(saved.id,'new');
 assert.doesNotMatch(body,/Private|secret|studentId|filename/);
 assert.match(body,/reach_assessment_section_/);
});
test('embedded analytics module stays synchronized with its editable source',()=>{
 if(fs.existsSync('source/assessment-analytics.js')) assert.equal(moduleSource.trim(),fs.readFileSync('source/assessment-analytics.js','utf8').trim());
});

// Assessment Analytics: anonymous papers, independently saved section revisions.
function analyticsKey(record) {
  return JSON.stringify(['assessment','version','year','teacher','section'].map(k => record[k].trim().toLocaleLowerCase()));
}

function analyticsLatest(records) {
  const byKey = new Map();
  records.forEach(record => {
    const key = analyticsKey(record), previous = byKey.get(key);
    if (!previous || `${record.savedAt}|${record.id}` > `${previous.savedAt}|${previous.id}`) byKey.set(key, record);
  });
  return [...byKey.values()];
}

function analyticsParse(text) {
  const rows = parseCSVFull(text);
  if (!isZipGradeCSV(rows)) throw new Error('Use a ZipGrade custom or Full Format CSV with per-question responses and points.');
  const cols = zipGradeColumns(rows[0]);
  if (cols.questions.some(q => q.possible < 0 || q.key < 0)) throw new Error('Include Primary Answer and Points Possible for every question in the custom export.');
  // Remove identity columns before invoking the existing parser. Never retain original rows.
  const allowed = new Set([cols.quiz, cols.className, cols.total, cols.possible, ...cols.questions.flatMap(q => [q.response,q.key,q.earned,q.possible,q.mark])]);
  const clean = rows.map((row,i) => i === 0 ? row : row.map((value,j) => allowed.has(j) ? value : ''));
  clean.slice(1).forEach((row,i) => {
    if (!row.some(Boolean)) return;
    const earned = Number(row[cols.total]), possible = Number(row[cols.possible]);
    if (earned < 0 || earned > possible) throw new Error(`Paper ${i+1}: earned points must be between zero and possible points.`);
    const sum = cols.questions.reduce((n,q) => n + Number(row[q.possible]),0);
    const sumEarned = cols.questions.reduce((n,q) => n + Number(row[q.earned]),0);
    if (Math.abs(sum-possible)>0.001 || Math.abs(sumEarned-earned)>0.001) throw new Error(`Paper ${i+1}: question totals do not match the paper total. Export all graded questions with earned and possible points.`);
  });
  const groups = parseZipGradeCSV(clean,'Unlabeled section');
  if (!groups.length) throw new Error('No graded papers found.');
  return groups.map(group => ({quiz:group.currentAssessment, section:group.teacherName === 'Unlabeled section' ? '' : group.teacherName,
    papers:group.students.map(p => ({pct:p.pct,items:p.items.map(it => {
      if (it.earned<0 || it.earned>it.possible) throw new Error('Question earned points must be between zero and possible points.');
      return {itemId:it.itemId,earned:it.earned,possible:it.possible,correct:it.correct,response:it.response,primaryAnswer:it.primaryAnswer};
    })}))}));
}

function analyticsRecord(draft) {
  const record = {schema:1};
  ['assessment','version','year','teacher','section'].forEach(k => {
    record[k] = String(draft[k] || '').trim();
    if (!record[k] || record[k].length>120) throw new Error(`Enter ${k} (up to 120 characters).`);
  });
  if (!/^\d{4}-\d{4}$/.test(record.year) || Number(record.year.slice(5)) !== Number(record.year.slice(0,4))+1) throw new Error('Use a school year such as 2026-2027.');
  record.aligned = draft.aligned === true;
  record.papers = draft.papers.map(p => ({pct:p.pct,items:p.items.map(it => ({itemId:it.itemId,earned:it.earned,possible:it.possible,correct:it.correct,response:it.response,primaryAnswer:it.primaryAnswer}))}));
  if (!record.papers.length) throw new Error('No papers to save.');
  return record;
}

function analyticsSummary(records, threshold=70) {
  const scores=records.flatMap(r=>r.papers.map(p=>p.pct)).sort((a,b)=>a-b), n=scores.length;
  if (!n) return {n:0,mean:null,median:null,proficiency:null,high:null,low:null,stdDev:null,distribution:[0,0,0,0,0]};
  const mean=scores.reduce((a,b)=>a+b,0)/n;
  return {n,mean,high:scores[n-1],low:scores[0],stdDev:Math.sqrt(scores.reduce((sum,v)=>sum+(v-mean)**2,0)/n),median:(scores[Math.floor((n-1)/2)]+scores[Math.floor(n/2)])/2,
    proficiency:100*scores.filter(v=>v>=threshold).length/n,
    distribution:[scores.filter(v=>v<60).length,scores.filter(v=>v>=60&&v<70).length,scores.filter(v=>v>=70&&v<80).length,scores.filter(v=>v>=80&&v<90).length,scores.filter(v=>v>=90).length]};
}

function analyticsSignature(paper) {
  const total=paper.items.reduce((n,it)=>n+it.possible,0);
  return JSON.stringify([...paper.items].sort((a,b)=>Number(a.itemId)-Number(b.itemId)).map(it=>[it.itemId,it.primaryAnswer.toUpperCase().replace(/\s/g,'').split('').sort().join(''),Number((it.possible/total).toFixed(8))]));
}

function analyticsComparable(records) {
  return records.length>0 && records.every(r=>r.aligned) && new Set(records.flatMap(r=>r.papers.map(analyticsSignature))).size===1;
}

function analyticsItems(records) {
  const papers=records.flatMap(r=>r.papers);
  if (!papers.length) return [];
  // Normalize each item's weight onto a common 100-point scale before pooling
  // teachers who grade the same test out of different proportional totals.
  const students=papers.map(p=>{const total=p.items.reduce((n,it)=>n+it.possible,0);return {pct:p.pct,items:p.items.map(it=>({...it,earned:100*it.earned/total}))};});
  const pooled=computeItemPooledStats([{students,itemData:{}}]);
  const ids=[...new Set(papers.flatMap(p=>p.items.map(it=>it.itemId)))].sort((a,b)=>Number(a)-Number(b));
  // Split boundary ties proportionally so teacher/file ordering cannot change discrimination.
  const tailMean=(id,descending)=>{
    const sorted=[...papers].sort((a,b)=>descending?b.pct-a.pct:a.pct-b.pct);
    const target=Math.max(1,Math.floor(papers.length*.27));
    let remaining=target,total=0;
    for(let i=0;i<sorted.length&&remaining>0;){
      let end=i+1;while(end<sorted.length&&Math.abs(sorted[end].pct-sorted[i].pct)<1e-9)end++;
      const tied=sorted.slice(i,end),take=Math.min(remaining,tied.length);
      total+=take*tied.filter(p=>p.items.find(it=>it.itemId===id)?.correct).length/tied.length;
      remaining-=take;i=end;
    }
    return total/target;
  };
  return ids.map(id=>{
    const items=papers.flatMap(p=>p.items.filter(it=>it.itemId===id));
    const answers=Object.create(null); items.forEach(it=>{const answer=it.response||'(blank)';answers[answer]=(answers[answer]||0)+1;});
    return {id,n:items.length,correct:items.filter(it=>it.correct).length,success:100*items.filter(it=>it.correct).length/items.length,
      key:[...new Set(items.map(it=>it.primaryAnswer))].join(' / '),answers,disc:papers.length<2||new Set(papers.map(p=>p.pct)).size<2?null:tailMean(id,true)-tailMean(id,false),citc:pooled[id]?.citc??null};
  });
}

// Append-only revisions keep separate teachers' uploads from overwriting each other.
// Only the latest revision for each logical section is included in statistics.
async function analyticsDriveList(fetcher, token, folder) {
  const files=[]; let page='';
  do {
    const q=`'${folder}' in parents and trashed=false and name contains 'reach_assessment_section_'`;
    const response=await fetcher(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime)&pageSize=1000${page?'&pageToken='+encodeURIComponent(page):''}`,{headers:{Authorization:'Bearer '+token}});
    if (!response.ok) throw new Error('Could not load team uploads. Retry before uploading.');
    const data=await response.json(); files.push(...(data.files||[])); page=data.nextPageToken||'';
  } while(page);
  const records=[];
  // Bound concurrent requests for large teams and multiple years.
  for(let i=0;i<files.length;i+=6) {
    const batch=await Promise.all(files.slice(i,i+6).map(async file=>{
      const response=await fetcher(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,{headers:{Authorization:'Bearer '+token}});
      if (!response.ok) throw new Error('A section could not be loaded. Refresh to avoid incomplete team totals.');
      const r=await response.json();
      if(r.schema!==1 || !Array.isArray(r.papers)) throw new Error('An unsupported assessment upload was found.');
      return {...analyticsRecord(r),id:file.id,savedAt:file.createdTime||r.savedAt};
    })); records.push(...batch);
  }
  return analyticsLatest(records);
}

async function analyticsDriveSave(fetcher, token, folder, draft, expectedId) {
  const record=analyticsRecord(draft);
  const current=await analyticsDriveList(fetcher,token,folder);
  const previous=current.find(r=>analyticsKey(r)===analyticsKey(record));
  if ((previous?.id||null)!==(expectedId||null)) throw new Error('This section changed since the preview. Refresh uploads and review the replacement.');
  record.savedAt=new Date().toISOString();
  const boundary='reach_assessment_'+crypto.randomUUID();
  const metadata={name:'reach_assessment_section_'+crypto.randomUUID()+'.json',parents:[folder]};
  const response=await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':`multipart/related; boundary=${boundary}`},
    body:`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(record)}\r\n--${boundary}--`});
  if(!response.ok) throw new Error('Upload was not saved. Your preview is still available to retry.');
  const saved=await response.json(); return {...record,id:saved.id,savedAt:saved.createdTime||record.savedAt};
}

function analyticsItemStatus(item) {
  const flags=[];
  if(item.success<55) flags.push('LOW SUCCESS RATE');
  if(item.disc!==null&&item.disc<0.2) flags.push('LOW DISCRIMINATION');
  if(item.citc!==null&&item.citc<0.3) flags.push('LOW CITC');
  const category=flags.length?(item.success>=80?'Review':'Priority'):
    item.disc===null||item.citc===null?'Insufficient evidence':item.success>=80?'Strength':'Developing';
  return {category,flags};
}

function AssessmentAnalytics({team,readOnly,onLoad,onSave}) {
  React.useEffect(()=>{const old=document.title;document.title="Reach — Assessment Analytics";return()=>{document.title=old;};},[]);
  const [records,setRecords]=React.useState([]), [pending,setPending]=React.useState([]);
  const [tab,setTab]=React.useState('Assessment analysis'), [busy,setBusy]=React.useState(false), [loaded,setLoaded]=React.useState(false);
  const [message,setMessage]=React.useState(''),[error,setError]=React.useState('');
  const [assessment,setAssessment]=React.useState(''),[version,setVersion]=React.useState(''),[year,setYear]=React.useState('');
  const [teacher,setTeacher]=React.useState(''),[section,setSection]=React.useState(''),[threshold,setThreshold]=React.useState(70);
  const [baseYear,setBaseYear]=React.useState(''),[nextYear,setNextYear]=React.useState('');
  const today=new Date(), startYear=today.getMonth()>=7?today.getFullYear():today.getFullYear()-1;
  const [defaults,setDefaults]=React.useState({teacher:'',year:`${startYear}-${startYear+1}`,assessment:'',version:'Original'});
  const unique=values=>[...new Set(values)].sort();
  const choose = list => {
    setRecords(list);
    if(!list.length) setTab('Uploads');
    if(list.length && !assessment) {const r=list[list.length-1];setAssessment(r.assessment);setVersion(r.version);setYear(r.year);}
  };
  const refresh=async()=>{setBusy(true);setError('');try{choose(await onLoad());setLoaded(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
  React.useEffect(()=>{let active=true;onLoad().then(list=>{if(active){choose(list);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[team.id]);
  const group=records.filter(r=>r.assessment===assessment&&r.version===version);
  const years=unique(group.map(r=>r.year));
  const filtered=group.filter(r=>(!year||r.year===year)&&(!teacher||r.teacher===teacher)&&(!section||r.section===section));
  const summary=analyticsSummary(filtered,threshold),items=analyticsItems(filtered);
  const compareRecords=y=>group.filter(r=>r.year===y&&(!teacher||r.teacher===teacher)&&(!section||r.section===section));
  const left=compareRecords(baseYear),right=compareRecords(nextYear);
  const leftSummary=analyticsSummary(left,threshold),rightSummary=analyticsSummary(right,threshold);
  const comparisonReady=baseYear&&nextYear&&baseYear!==nextYear&&left.length&&right.length;
  const itemReady=analyticsComparable(filtered);
  const itemComparisonReady=comparisonReady&&analyticsComparable([...left,...right]);
  const pct=v=>v===null?'—':v.toFixed(1)+'%';
  const number=v=>v===null?'—':v.toFixed(2);
  const update=(i,k,v)=>setPending(list=>list.map((r,j)=>j===i?{...r,[k]:v,replace:false}:r));
  const upload=async files=>{
    setBusy(true);setError('');setMessage('');
    try {
      if(!defaults.assessment.trim()) throw new Error('Enter one shared assessment name for this batch before choosing the teacher CSVs.');
      const previews=[];
      for(const file of files) {
        if(file.size>8*1024*1024) throw new Error('Each CSV must be smaller than 8 MB.');
        const groups=analyticsParse(await file.text());
        previews.push(...groups.map(g=>({...defaults,assessment:defaults.assessment||g.quiz,section:g.section,papers:g.papers,aligned:false,replace:false,source:file.name})));
      }
      setPending(previews);setTab('Uploads');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const commit=async()=>{
    setBusy(true);setError('');setMessage('');
    try {
      const drafts=pending.map(analyticsRecord);
      if(new Set(drafts.map(analyticsKey)).size!==drafts.length) throw new Error('Two previews have the same teacher and section. Use distinct section labels or import just one replacement.');
      const latest=await onLoad();choose(latest);
      for(let i=0;i<drafts.length;i++) {
        const previous=latest.find(r=>analyticsKey(r)===analyticsKey(drafts[i]));
        const reviewed=records.find(r=>analyticsKey(r)===analyticsKey(drafts[i]));
        if(previous && (!pending[i].replace||previous.id!==reviewed?.id)) throw new Error('A matching section already exists. Review and check Replace existing section before saving.');
      }
      let current=latest;
      for(let i=0;i<drafts.length;i++) {
        const previous=current.find(r=>analyticsKey(r)===analyticsKey(drafts[i]));
        const saved=await onSave(drafts[i],previous?.id||null);
        current=analyticsLatest([...current,saved]);setRecords(current);
        // Remove each successful upload immediately; retries cannot duplicate it.
        setPending(list=>list.slice(1));
      }
      const last=drafts[drafts.length-1];setAssessment(last.assessment);setVersion(last.version);setYear(last.year);setTeacher('');setSection('');
      setMessage('Uploads saved. Overview and item analysis are up to date.');setTab('Assessment analysis');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const download=()=>{
    const rows=[['Assessment','Version','School year','Teacher','Section','Papers','Mean percent','Median percent','Proficient percent','Proficiency threshold'],...filtered.map(r=>{const s=analyticsSummary([r],threshold);return[r.assessment,r.version,r.year,r.teacher,r.section,s.n,s.mean,s.median,s.proficiency,threshold];})];
    const escape=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
    const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='Reach-Assessment-Summary.csv';a.click();URL.revokeObjectURL(url);
  };
  const selector=(label,value,change,options,empty)=><label>{label}<select value={value} onChange={e=>change(e.target.value)}><option value="">{empty}</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>;
  const table=(headers,rows)=><div className="aa-table"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
  const metrics=s=><div className="aa-metrics">{[['Papers',s.n],['Mean',pct(s.mean)],['Median',pct(s.median)],['Proficient',pct(s.proficiency)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
  return <div className="aa-shell">
    <style>{`.aa-hero{background:linear-gradient(135deg,#1e3a8a,#1d4ed8);border-radius:12px;padding:22px;color:white}.aa-hero small{color:#bfdbfe;letter-spacing:.08em}.aa-hero h1{margin:8px 0!important}.aa-hero p{color:#bfdbfe!important;margin:0}.aa-category-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0}.aa-category{padding:16px;border-radius:10px;border:1px solid #e2e8f0}.aa-category strong{display:block;font-size:28px;margin-top:8px}.aa-pill{display:inline-block;padding:4px 8px;border-radius:5px;font-weight:700}.aa-good,.aa-strength{color:#15803d;background:#f0fdf4}.aa-low,.aa-priority{color:#dc2626;background:#fef2f2}.aa-fair,.aa-review{color:#92400e;background:#fffbeb}.aa-warn{color:#c2410c;background:#ffedd5}.aa-developing,.aa-insufficient-evidence{color:#475569;background:#f1f5f9}.aa-citc{color:#7c3aed;background:#f5f3ff}.aa-item-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:20px 0}.aa-shell .aa-item{padding:16px;border:1px solid #e2e8f0;border-radius:10px}.aa-item-metrics{display:block;margin-top:8px;font-size:14px;font-weight:500}.aa-guide{background:#f8fafc;padding:16px!important;border-radius:8px}.aa-shell{flex:1;overflow:auto;padding:24px;color:#0f172a}.aa-content{max-width:1120px;margin:auto}.aa-shell h1{font-family:Lora,serif;font-size:26px;margin:0 0 8px}.aa-shell h2{font-size:20px;margin:24px 0 12px}.aa-shell p{color:#475569;line-height:1.5}.aa-shell button{border:1px solid #cbd5e1;border-radius:7px;background:white;color:#0f766e;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}.aa-shell button:disabled{opacity:.5;cursor:default}.aa-shell button[aria-selected=true],.aa-shell .aa-primary{background:#0f766e;color:white;border-color:#0f766e}.aa-shell label{display:flex;flex-direction:column;gap:5px;font-size:14px;font-weight:600}.aa-shell input,.aa-shell select{font:inherit;padding:9px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;width:100%;background:white;color:#0f172a}.aa-shell input[type=checkbox]{width:auto}.aa-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.aa-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}.aa-card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:16px 0}.aa-metrics{display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:12px;margin:20px 0}.aa-metrics>div{background:#f0fdfa;border:1px solid #99f6e4;padding:18px;border-radius:10px}.aa-metrics span{display:block;color:#475569;font-size:14px}.aa-metrics strong{font-size:28px;display:block;margin-top:6px}.aa-table{overflow:auto}.aa-table table{width:100%;border-collapse:collapse;font-size:15px}.aa-table th{text-align:left;background:#f1f5f9;color:#475569}.aa-table td,.aa-table th{padding:11px;border-bottom:1px solid #e2e8f0;white-space:nowrap}.aa-notice{background:#fffbeb;border:1px solid #fde68a;padding:12px;border-radius:8px}.aa-error{background:#fef2f2;color:#991b1b;padding:12px;border-radius:8px}.aa-success{background:#f0fdf4;color:#166534;padding:12px;border-radius:8px}.aa-shell details{border-bottom:1px solid #e2e8f0;padding:12px 0}.aa-shell summary{cursor:pointer;font-weight:600}.aa-check{flex-direction:row!important;align-items:center;margin-top:12px}.aa-bar{height:12px;border-radius:4px;background:#0d9488;min-width:2px}@media(max-width:650px){.aa-shell{padding:14px}.aa-metrics{grid-template-columns:repeat(2,1fr)}}`}</style>
    <div className="aa-content">{['teacher','assessment','version','section','year'].map(k=><datalist id={`aa-${k}`} key={k}>{unique(records.map(r=>r[k])).map(v=><option key={v} value={v}/>)}</datalist>)}<div className="aa-hero"><small>ASSESSMENT ANALYTICS</small><h1>{assessment||'Your team’s assessment results'}</h1><p>Upload all teachers’ CSVs → Review sections → Analyze your team</p></div>
    {readOnly&&<div className="aa-notice">View only. A team editor can add or replace uploads.</div>}
    {error&&<div role="alert" className="aa-error">{error}</div>}{message&&<div role="status" className="aa-success">{message}</div>}
    <div className="aa-toolbar" role="tablist">{['Uploads','Assessment analysis','Year over year'].map(t=><button role="tab" aria-selected={tab===t} key={t} onClick={()=>setTab(t)}>{t}</button>)}<button disabled={busy} onClick={refresh}>Refresh uploads</button></div>
    {!loaded&&<p>Loading team uploads…</p>}
    {tab!=='Uploads'&&<div className="aa-card aa-fields">
      {selector('Assessment',assessment,v=>{setAssessment(v);setVersion('');setYear('');setTeacher('');setSection('');setBaseYear('');setNextYear('');},unique(records.map(r=>r.assessment)),'Choose assessment')}
      {selector('Assessment version',version,v=>{setVersion(v);setYear('');setBaseYear('');setNextYear('');},unique(records.filter(r=>r.assessment===assessment).map(r=>r.version)),'Choose version')}
      {tab!=='Year over year'&&selector('School year',year,setYear,years,'All years')}
      {selector('Teacher',teacher,v=>{setTeacher(v);setSection('');},unique(group.map(r=>r.teacher)),'Whole team')}
      {selector('Section',section,setSection,unique(group.filter(r=>!teacher||r.teacher===teacher).map(r=>r.section)),'All sections')}
      <label>Proficiency threshold (%)<input type="number" min="0" max="100" value={threshold} onChange={e=>setThreshold(Math.max(0,Math.min(100,Number(e.target.value))))}/></label>
    </div>}
    {tab==='Assessment analysis'&&<><div className="aa-toolbar"><span>{filtered.length} section uploads · {unique(filtered.map(r=>r.teacher)).length} teachers · {year||'All years'}</span><button disabled={!filtered.length} onClick={download}>Download summary CSV</button></div>
      {!filtered.length?<div className="aa-card">Choose an assessment and version, or add your first ZipGrade export in Uploads.</div>:<>
      {!year&&years.length>1&&<p className="aa-notice">These totals combine multiple school years. Choose one year for a single cohort.</p>}
      {filtered.some(r=>/fictional demo/i.test(r.section))&&<p className="aa-notice">Includes fictional demo data for testing only.</p>}{metrics(summary)}<p>High: {pct(summary.high)} · Low: {pct(summary.low)} · Standard deviation: {pct(summary.stdDev)}</p><p>Team results weight every paper equally. Teacher averages are not averaged together.</p>
      <div className="aa-card"><h2>Score distribution</h2>{table(['Score range','Papers','Share'],summary.distribution.map((n,i)=>[["Below 60%","60–69%","70–79%","80–89%","90–100%"][i],n,<div style={{width:180}}><div className="aa-bar" style={{width:`${100*n/summary.n}%`,background:["#dc2626","#ea580c","#d97706","#65a30d","#15803d"][i]}}/>{pct(100*n/summary.n)}</div>]))}</div>
      <div className="aa-card"><h2>Teacher performance</h2>{table(['Teacher','Section uploads','Papers','Mean','Median','Proficient'],unique(filtered.map(r=>r.teacher)).map(t=>{const rs=filtered.filter(r=>r.teacher===t),s=analyticsSummary(rs,threshold);return[t,rs.length,s.n,pct(s.mean),pct(s.median),pct(s.proficiency)];}))}
      <h2>Section performance</h2>{table(['Year','Teacher','Section','Papers','Mean','Proficient'],filtered.map(r=>{const s=analyticsSummary([r],threshold);return[r.year,r.teacher,r.section,s.n,pct(s.mean),pct(s.proficiency)];}))}</div></>}
    </>}
    {tab==='Assessment analysis'&&filtered.length>0&&<div className="aa-card"><h2>Item analysis</h2>{!filtered.length?<p>Choose an assessment, version, and school year.</p>:!itemReady?<p className="aa-notice">Question comparison requires confirmed matching question content and order, matching answer keys, and proportional question weights. Filter to a compatible section or replace its upload with confirmed metadata.</p>:<>
      <p>{summary.n} anonymous papers. CITC excludes the question from the remaining score. — means the statistic cannot be calculated. {summary.n<30?'Small sample: interpret discrimination and CITC cautiously.':''}</p>
      <details className="aa-guide"><summary>📐 How to read these metrics</summary><div className="aa-fields">
        <div><h3>Success rate</h3><p>Fully correct papers ÷ all papers. Green ≥80%; yellow 70–79%; orange 55–69%; red below 55%.</p></div>
        <div><h3>Discrimination</h3><p>Top 27% minus bottom 27% success. ≥0.40 excellent; 0.20–0.39 good; 0–0.19 fair; below 0 poor.</p></div>
        <div><h3>Corrected item-total correlation</h3><p>CITC correlates item points with the remaining score, excluding this item. ≥0.30 good; 0.10–0.29 fair; below 0.10 weak. No score variation means unavailable.</p></div>
      </div><p>Priority: success below 80% with a low metric. Review: high success with low discrimination or CITC. Strength: high success and healthy metrics. Developing: moderate success with healthy metrics. Insufficient evidence: a statistic is unavailable and no low metric is observed. These categories guide item review, not student analysis.</p></details>
      <div className="aa-category-grid">{['Strength','Priority','Review','Developing','Insufficient evidence'].map(cat=><div className={'aa-category aa-'+cat.toLowerCase().replaceAll(' ','-')} key={cat}><span>{cat} items</span><strong>{items.filter(it=>analyticsItemStatus(it).category===cat).length}</strong></div>)}</div>
      {table(['Question','Correct','Success','Discrimination','CITC','Review status'],items.map(it=>{const status=analyticsItemStatus(it);return[it.id,`${it.correct}/${it.n}`,<span className={'aa-pill '+(it.success>=80?'aa-good':it.success>=70?'aa-fair':it.success>=55?'aa-warn':'aa-low')}>{pct(it.success)}</span>,<span className={'aa-pill '+(it.disc===null?'':it.disc>=.2?'aa-good':it.disc>=0?'aa-fair':'aa-low')}>{number(it.disc)}</span>,<span className={'aa-pill '+(it.citc===null?'':it.citc>=.3?'aa-good':it.citc>=.1?'aa-fair':'aa-low')}>{number(it.citc)}</span>,<span className={'aa-pill aa-'+status.category.toLowerCase().replaceAll(' ','-')}>{status.category}</span>];}))}
      <div className="aa-item-grid">{[...items].sort((a,b)=>a.success-b.success).map(it=>{const status=analyticsItemStatus(it);return <details className={'aa-item aa-'+status.category.toLowerCase().replaceAll(' ','-')} key={it.id}><summary>Question {it.id} · {status.category}<span className="aa-item-metrics">Success {pct(it.success)} · Disc {number(it.disc)} · CITC {number(it.citc)}</span></summary><div className="aa-toolbar">{status.flags.map(flag=><span className={'aa-pill '+(flag==='LOW CITC'?'aa-citc':flag==='LOW DISCRIMINATION'?'aa-fair':'aa-low')} key={flag}>{flag}</span>)}</div><p>{it.correct}/{it.n} correct · Answer key: {it.key}</p>{table(['Response','Papers','Share'],Object.entries(it.answers).sort((a,b)=>b[1]-a[1]).map(([a,n])=>[a,n,pct(100*n/it.n)]))}</details>;})}</div>
</>}
    </div>}
    {tab==='Year over year'&&<div className="aa-card"><h2>Compare school years</h2>{[...left,...right].some(r=>/fictional demo/i.test(r.section))&&<p className="aa-notice">This comparison includes fictional demo data. Changes are for testing only and do not represent actual historical performance.</p>}<p>Compare different cohorts using the same assessment version. This measures cohort performance, not individual growth. The selected proficiency threshold applies to both years.</p>
      <div className="aa-fields">{selector('Baseline year',baseYear,setBaseYear,years,'Choose year')}{selector('Comparison year',nextYear,setNextYear,years,'Choose year')}</div>
      {!comparisonReady?<p className="aa-notice">Select two different school years with uploads for the current filters.</p>:<>
      {table(['School year','Papers','Mean','Median','Proficient'],[[baseYear,leftSummary.n,pct(leftSummary.mean),pct(leftSummary.median),pct(leftSummary.proficiency)],[nextYear,rightSummary.n,pct(rightSummary.mean),pct(rightSummary.median),pct(rightSummary.proficiency)]])}
      <p>Mean change: <strong>{(rightSummary.mean-leftSummary.mean).toFixed(1)} percentage points</strong>. Proficiency change: <strong>{(rightSummary.proficiency-leftSummary.proficiency).toFixed(1)} percentage points</strong>.</p>
      <h2>Question changes</h2>{!itemComparisonReady?<p className="aa-notice">Overall percentages are shown, but question changes are withheld because question alignment or scoring weights do not match. Use separate assessment versions for changed tests.</p>:table(['Question',`${baseYear} correct`,`${nextYear} correct`,'Change (percentage points)'],analyticsItems(left).map(it=>{const other=analyticsItems(right).find(x=>x.id===it.id);return[it.id,pct(it.success),pct(other.success),(other.success-it.success).toFixed(1)];}))}</>}
    </div>}
    {tab==='Uploads'&&<><div className="aa-card"><h2>1. Upload the whole team’s CSVs</h2><p>Select all teachers’ files together. Enter a shared assessment name and school year once, then label each teacher and section in the batch preview.</p><p>Export all graded questions from ZipGrade with quiz name, class (if available), earned/possible totals, and each question’s response, answer, grade mark, earned points, and possible points. Names and IDs are optional and discarded before saving.</p>
      {!readOnly&&<><div className="aa-fields">{['year','assessment','version'].map(k=><label key={k}>{({teacher:'Teacher for this upload',year:'School year for this upload',assessment:'Shared assessment name',version:'Assessment version for this upload'})[k]}<input list={`aa-${k}`} value={defaults[k]} onChange={e=>setDefaults({...defaults,[k]:e.target.value})} placeholder={k==='assessment'?'e.g. ESS Unit 1':k==='teacher'?'e.g. Ms. Lee':''}/></label>)}</div>
      <p>Use one shared assessment name and version across teachers and years. If Class is blank, label the export “Combined sections” or export each section separately.</p>
      <label>Choose ZipGrade CSV files<input aria-label="Choose ZipGrade CSV files" type="file" accept=".csv,text/csv" multiple disabled={busy||!loaded||pending.length>0} onChange={e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)upload(files);}}/></label></>}
    </div>
    {pending.length>0&&<div className="aa-card"><h2>2. Review the batch</h2><p>{pending.length} section uploads · {pending.reduce((n,r)=>n+r.papers.length,0)} papers. Give every section its teacher label, then save the batch to open Assessment analysis.</p>{pending.map((r,i)=>{const existing=records.find(x=>analyticsKey(x)===analyticsKey(r));return <div className="aa-card" key={i}><strong>{r.source}</strong><p>{r.papers.length} papers · {r.papers[0]?.items.length} questions · mean {pct(analyticsSummary([r]).mean)}</p><div className="aa-fields">{['teacher','section','year','assessment','version'].map(k=><label key={k}>{k[0].toUpperCase()+k.slice(1)}<input list={`aa-${k}`} disabled={busy} aria-label={`Upload ${i+1} ${k}`} value={r[k]} onChange={e=>update(i,k,e.target.value)}/></label>)}</div>
      <label className="aa-check"><input disabled={busy} type="checkbox" checked={r.aligned} onChange={e=>update(i,'aligned',e.target.checked)}/>I confirm this version uses the same question content and order as other uploads assigned to it.</label>
      {existing&&<label className="aa-check aa-notice"><input disabled={busy} type="checkbox" checked={r.replace} onChange={e=>setPending(p=>p.map((x,j)=>j===i?{...x,replace:e.target.checked}:x))}/>Replace existing section ({existing.papers.length} papers). It will not be counted twice.</label>}
    </div>;})}<div className="aa-toolbar"><button className="aa-primary" disabled={busy||readOnly} onClick={commit}>{busy?'Saving…':'Save batch & analyze'}</button><button disabled={busy} onClick={()=>setPending([])}>Cancel preview</button></div></div>}
    <div className="aa-card"><h2>Saved uploads</h2>{records.length?table(['Assessment','Version','Year','Teacher','Section','Papers','Saved'],records.map(r=>[r.assessment,r.version,r.year,r.teacher,r.section,r.papers.length,new Date(r.savedAt).toLocaleString()])):<p>No uploads yet.</p>}</div></>}
    </div>
  </div>;
}

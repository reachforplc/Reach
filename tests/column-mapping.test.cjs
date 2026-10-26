const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(fs.existsSync('index.html') ? 'index.html' : 'source/github-index.html','utf8');
const c = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function cellToPct'), html.indexOf('function ColumnMappingUI')), c);
const rows = [['First Name','Last Name','Score'],['Avery','Morgan','50'],['Jordan','','85'],['','Reed','85']];
const mapping = {nameCol:0, nameCols:[0,1], idCol:null, sectionCol:null,dataStartRow:1,assessmentCols:[{colIndex:2,name:'Quiz',scoreType:'pct',pointsPossible:100}]};
test('generic mapping combines first and last names and retains either part alone',()=>{
 const [s]=c.parseGenericGradebook(rows,mapping,'Test');
 assert.deepEqual(Array.from(s.students,x=>x.name),['Avery Morgan','Jordan','Reed']);
 assert.deepEqual(Array.from(s.students,x=>x.pct),[50,85,85]);
});
test('legacy single-name mappings remain compatible',()=>{
 const old={...mapping};delete old.nameCols;
 const [s]=c.parseGenericGradebook([['Name','Other','Score'],['Morgan, Avery','','50']],old,'Test');
 assert.equal(s.students[0].name,'Avery Morgan');
});

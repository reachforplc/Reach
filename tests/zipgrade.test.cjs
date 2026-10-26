const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(fs.existsSync('index.html') ? 'index.html' : 'source/github-index.html', 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function zipGradeColumns'), html.indexOf('    const { useState,')), context);
vm.runInContext(html.slice(html.indexOf('function parseCSVFull'), html.indexOf('function parseICGradebook')), context);
const headers = ['Quiz Name','Class','Student First Name','Student Last Name','Student ID','Earned Points','Possible Points','Key Version',
  '#1 Student Response','#1 Primary Answer','#1 Grade Mark','#1 Points Earned','#1 Points Possible'];
function row(first, last, options = {}) {
  return ['Test quiz',options.className || '',first,last,'0',options.points ?? '1','1','A',options.response ?? 'AC','AC',options.mark ?? 'C',options.points ?? '1','1'];
}
test('accepts first name, last name, both, and anonymous papers without collapsing ID 0', () => {
  const rows = [headers, row('Avery',''),row('','Reed'),row('Jordan','Lee'),row('',''),row('','')];
  assert.equal(context.isZipGradeCSV(rows), true);
  const [section] = context.parseZipGradeCSV(rows, 'Example');
  assert.deepEqual(Array.from(section.students, s => s.name), ['Avery','Reed','Jordan Lee','Paper 4','Paper 5']);
  assert.ok(section.students.every(s => s.studentId === ''));
  assert.equal(section.itemData.items[0].Correct, '5');
});
test('preserves multiselect and blank answers, counts misses and links missed students', () => {
  const rows = [headers,row('Avery',''),row('Jordan','',{response:'',mark:'X',points:'0'})];
  const sections = context.parseZipGradeCSV(rows, 'Example');
  const report = context.buildItemReport(sections, 70);
  assert.equal(sections[0].itemData.summary.QuizMeanScore, '50');
  assert.equal(report.itemAgg['1'].correct, 1);
  assert.equal(report.itemAgg['1'].allAnswers['AC'].count, 1);
  assert.equal(report.itemAgg['1'].allAnswers['(blank)'].count, 1);
  assert.deepEqual(Array.from(report.itemAgg['1'].missedBy.Example), ['Jordan']);
});
test('partial credit is retained without being counted as a fully correct response', () => {
  const sections = context.parseZipGradeCSV([headers,row('Avery','',{points:'0.5',mark:'X'})], 'Example');
  assert.equal(sections[0].students[0].pct, 50);
  assert.equal(sections[0].students[0].items[0].earned, 0.5);
  assert.equal(sections[0].itemData.items[0].Correct, '0');
});
test('separates classes and assessments and rejects malformed grades', () => {
  const sections = context.parseZipGradeCSV([headers,row('A','',{className:'Period 1'}),row('B','',{className:'Period 2'})], 'Example');
  assert.equal(sections.length, 2);
  assert.notEqual(sections[0]._zipGradeKey, sections[1]._zipGradeKey);
  assert.throws(() => context.parseZipGradeCSV([headers,row('A','',{points:'no score'})], 'Example'), /valid numbers/);
});
test('also accepts ZipGrade built-in full exports and BOM headers', () => {
  const rows = [['\uFEFFQuizName','QuizClass','FirstName','LastName','StudentID','Earned Points','Possible Points','Stu1','PriKey1','Points1','Mark1'],
    ['Test','','Avery','Morgan','0123','1','1','AC','AC','1','C']];
  assert.equal(context.isZipGradeCSV(rows), true);
  const [section] = context.parseZipGradeCSV(rows, 'Example');
  assert.equal(section.students[0].studentId, '0123');
  assert.equal(section.students[0].items[0].correct, true);
  assert.equal(context.isZipGradeCSV([['Name','ID','Score']]), false);
});
test('sample export reconciles 4 papers, 20 questions, 58 points and a 72.5% mean', {skip: !fs.existsSync('test-data/ZipGrade-Fictional-Names.csv')}, () => {
  const rows = context.parseCSVFull(fs.readFileSync('test-data/ZipGrade-Fictional-Names.csv','utf8'));
  const sections = context.parseZipGradeCSV(rows,'Fictional sample');
  const [section] = sections;
  assert.equal(section.students.length, 4);
  assert.equal(section.itemData.items.length, 20);
  assert.equal(section.itemData.summary.QuizMeanScore, '72.5');
  assert.equal(section.students.flatMap(s => s.items).reduce((sum,it) => sum + it.earned,0), 58);
  const report = context.buildItemReport(sections,70);
  assert.equal(report.totalItems,20);
  assert.equal(report.itemAgg['3'].correct,0);
  assert.equal(report.itemAgg['6'].correct,4);
});

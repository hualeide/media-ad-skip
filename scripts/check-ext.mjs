import fs from 'fs';

const s = fs.readFileSync('extension/content/content.js', 'utf8');
const m = fs.readFileSync('extension/manifest.json', 'utf8');
const count = (re) => (s.match(re) || []).length;
const report = {
  masWrong: count(/id="mas-wrong"/g),
  masUndo: count(/id="mas-undo"/g),
  isBlockedUp: s.includes('function isBlockedUp'),
  reportWrongMark: s.includes('function reportWrongMark'),
  midMeta: s.includes('mid: d.owner'),
  watchlater: m.includes('watchlater'),
  version: JSON.parse(m).version,
};
console.log(report);
if (report.masWrong !== 1 || report.masUndo !== 1) process.exit(1);
if (!report.isBlockedUp || !report.reportWrongMark || !report.midMeta || !report.watchlater) process.exit(1);
console.log('ext smoke OK');

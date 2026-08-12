/**
 * 同步 self-test 到 detect-core
 */
import {
  extractTimeFromText,
  detectFromJumpTexts,
  detectFromSubtitles,
  convertChineseNumbersToArabic,
} from '../src/detect-core.mjs';

function isBlockedUp(mid, blockMids) {
  if (mid == null || mid === '') return false;
  return (blockMids || []).map(String).includes(String(mid));
}

const cases = [
  ['空降1:30', 90],
  ['快进到 2:15', 135],
  ['三分二十秒', 200],
  ['一分半 空降', 90],
  ['705工程', 425],
  ['谢谢八分十五郎', 495],
  ['8分15郎', 495],
  ['2:15mark', 135],
  ['《我的世界1.20预告片》', null],
];

console.log('convert', convertChineseNumbersToArabic('谢谢八分十五郎'));
let pass = 0;
for (const [text, expect] of cases) {
  const t = extractTimeFromText(text)?.time ?? null;
  if (t !== expect) throw new Error(`${text} => ${t}, expect ${expect}`);
  console.log('OK', text, '→', t);
  pass++;
}
const seg = detectFromJumpTexts([
  { time: 100, text: '空降2:00' },
  { time: 105, text: '谢谢二分郎' },
  { time: 110, text: '快进2:00' },
], 600);
if (!seg || seg.end !== 120) throw new Error(`cluster ${JSON.stringify(seg)}`);
console.log('OK cluster', seg);

const filler = (n) => Array.from({ length: n }, (_, i) => ({ from: i, to: i + 1, content: `旁白${i}` }));
const brandLines = [
  ...filler(5),
  { from: 90, to: 93, content: '今天给大家安利一下转转' },
  { from: 94, to: 97, content: '闲置可以爱回收' },
];
const brandSeg = detectFromSubtitles(brandLines, [], 300);
if (!brandSeg || brandSeg.source !== 'subtitle-brand' || brandSeg.start > 90 || brandSeg.end < 97) {
  throw new Error(`brand ${JSON.stringify(brandSeg)}`);
}
console.log('OK subtitle-brand', brandSeg);

const deerLines = [
  ...filler(5),
  { from: 120, to: 124, content: '神奇小鹿冰被真的凉快' },
];
const deerSeg = detectFromSubtitles(deerLines, [], 300);
if (!deerSeg || deerSeg.source !== 'subtitle-brand') {
  throw new Error(`deer ${JSON.stringify(deerSeg)}`);
}
console.log('OK deer brand', deerSeg);

// 早段误提品牌 + 后段真口播：应贴后段，不能从 40s 起跳
const gapLines = [
  ...filler(5),
  { from: 40, to: 42, content: '我刚用过转转' },
  { from: 100, to: 103, content: '今天给大家推荐转转' },
  { from: 104, to: 108, content: '闲置可以爱回收' },
];
const gapSeg = detectFromSubtitles(gapLines, [], 300);
if (!gapSeg || gapSeg.source !== 'subtitle-brand' || gapSeg.start < 90 || gapSeg.start > 102) {
  throw new Error(`gap cluster ${JSON.stringify(gapSeg)}`);
}
if (gapSeg.end - gapSeg.start > 75) throw new Error(`gap too wide ${JSON.stringify(gapSeg)}`);
console.log('OK gap-tight subtitle-brand', gapSeg);

// «Sad Songs» 章节不得因含 ad 子串误跳
function labelLooksAdSelfTest(text) {
  const raw = String(text || '');
  if (/(广告|广告时间|恰饭|赞助|商单|推广|软广)/.test(raw)) return true;
  return /\bads?\b|\bsponsors?\b|\bsponsored\b|\badvert(?:s|ising|isement)?\b/i.test(raw);
}
if (labelLooksAdSelfTest('Good Things Fall Apart vs. Sad Songs')) {
  throw new Error('false chapter ad on Sad Songs');
}
if (!labelLooksAdSelfTest('广告时间') || !labelLooksAdSelfTest('Skip Ads break') || !labelLooksAdSelfTest('sponsor break')) {
  throw new Error('chapter ad positive miss');
}
console.log('OK chapter labelLooksAd');

const weakLines = [
  ...filler(5),
  { from: 50, to: 52, content: '我今天购买了一本书' },
];
const weak = detectFromSubtitles(weakLines, [], 300);
if (weak) throw new Error(`false positive ${JSON.stringify(weak)}`);
console.log('OK no false positive on single 购买');

if (!isBlockedUp(491780876, ['491780876'])) throw new Error('mid block fail');
if (isBlockedUp(1, ['491780876'])) throw new Error('mid block fp');
if (isBlockedUp(null, ['1'])) throw new Error('mid null');
console.log('OK mid blacklist');

console.log(`全部通过 ${pass + 7}`);

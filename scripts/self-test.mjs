/**
 * 同步 self-test 到 detect-core
 */
import {
  extractTimeFromText,
  detectFromJumpTexts,
  detectFromSubtitles,
  convertChineseNumbersToArabic,
  labelLooksAd,
} from '../src/detect-core.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// 剧透空降刷屏（puzzle 解开）不应拉超长段
const spoiler = detectFromJumpTexts([
  { time: 270, text: '空降7:18' },
  { time: 270, text: '空降7:18' },
  { time: 270, text: '空降7:18' },
  { time: 270, text: '空降7:18' },
  { time: 270, text: '空降7:18' },
  { time: 270, text: '空降7:18' },
], 523);
if (spoiler) throw new Error(`spoiler 空降 false positive ${JSON.stringify(spoiler)}`);
console.log('OK no spoiler 空降 long-skip');

// 有广告语境的空降仍可跳
const adJump = detectFromJumpTexts([
  { time: 60, text: '广告空降2:00' },
  { time: 62, text: '恰饭结束 2:00' },
  { time: 65, text: '谢谢二分郎' },
], 600);
if (!adJump || adJump.end !== 120) throw new Error(`ad 空降 miss ${JSON.stringify(adJump)}`);
console.log('OK ad-context 空降', adJump);

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

// BV13qbK6VE8r：妙界口播品牌词稀疏（~6:09 与 ~6:55），旧逻辑只跳到 6:19；应拉到约 7:30
const miaojieLines = [
  ...filler(5),
  { from: 365.46, to: 367.76, content: '是不是感觉最近我都不连跪了' },
  { from: 367.76, to: 369.64, content: '那得多亏这张武器神卡' },
  { from: 369.64, to: 371.43, content: '妙界膝盖按摩椅' },
  { from: 371.43, to: 374.13, content: '一套热敷加按摩掩护连招下来' },
  { from: 381.579, to: 383.619, content: '这会儿正赶上九九大促' },
  { from: 383.619, to: 385.38, content: '大家也赶紧去薅羊毛' },
  { from: 395.68, to: 397.1, content: '它有大面积热敷' },
  { from: 415.72, to: 417.98, content: '都得及时整上妙界养护Buff' },
  { from: 437.2, to: 439.94, content: '现在九九大促入手就是全年底价' },
  { from: 439.94, to: 441.42, content: '售后质保全靠谱' },
  { from: 444.46, to: 448.62, content: '高颜值礼盒自用送人都包文的' },
  { from: 452.7, to: 453.78, content: '终于下班了' },
];
const miaojieSeg = detectFromSubtitles(miaojieLines, [], 492);
if (!miaojieSeg || miaojieSeg.source !== 'subtitle-brand') {
  throw new Error(`miaojie miss ${JSON.stringify(miaojieSeg)}`);
}
if (miaojieSeg.start > 370 || miaojieSeg.end < 448 || miaojieSeg.end > 452) {
  throw new Error(`miaojie range ${JSON.stringify(miaojieSeg)}`);
}
console.log('OK miaojie brand extend', miaojieSeg);

// «Sad Songs» 章节不得因含 ad 子串误跳（须用共享 labelLooksAd，禁影子副本）
if (labelLooksAd('Good Things Fall Apart vs. Sad Songs')) {
  throw new Error('false chapter ad on Sad Songs');
}
if (!labelLooksAd('广告时间') || !labelLooksAd('Skip Ads break') || !labelLooksAd('sponsor break')) {
  throw new Error('chapter ad positive miss');
}
// 油猴同构拷贝不得漂移：关键正则须仍在 user.js
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const user = fs.readFileSync(path.join(root, 'media-ad-skip.user.js'), 'utf8');
  if (!/function labelLooksAd\(text\)/.test(user)) throw new Error('user.js missing labelLooksAd');
  if (!user.includes('\\bads?\\b')) throw new Error('user.js labelLooksAd EN regex drifted');
  if (!/\(广告\|广告时间\|恰饭\|赞助\|商单\|推广\|软广\)/.test(user)) {
    throw new Error('user.js labelLooksAd ZH regex drifted');
  }
}
console.log('OK chapter labelLooksAd');

// 同构：extractTimeFromText 的 mark 分支必须同步进 user.js
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const user = fs.readFileSync(path.join(root, 'media-ad-skip.user.js'), 'utf8');
  if (!/(?:mark\|标记)/.test(user)) {
    throw new Error('user.js extractTimeFromText missing mark/标记 branch');
  }
  if (!/function extractTimeFromText/.test(user)) throw new Error('user.js missing extractTimeFromText');
}
console.log('OK user.js time extractor parity');

// 撤销语义：重分析不得清空 undoneKeys（审阅 #1）
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const user = fs.readFileSync(path.join(root, 'media-ad-skip.user.js'), 'utf8');
  const runIdx = user.indexOf('async function runBilibili');
  if (runIdx < 0) throw new Error('missing runBilibili');
  const block = user.slice(runIdx, runIdx + 2500);
  if (block.includes('undoneKeys = new Set()')) {
    throw new Error('runBilibili must not reset undoneKeys (undo regression)');
  }
}
console.log('OK undo survives re-analyze');

// 官方报备广告段（view_points type=1）无条件命中
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const user = fs.readFileSync(path.join(root, 'media-ad-skip.user.js'), 'utf8');
  if (!/ch\.type === 1/.test(user) || !/chapter-official-ad/.test(user)) {
    throw new Error('user.js missing official ad chapter (type=1) detection');
  }
}
console.log('OK official ad chapter type=1');

// 评论时间轴：「01:51 跳过广告」应命中；松散「正片从 2:00」在 timelineOnly 下不得命中
import { detectFromCreatorMarks } from '../src/detect-core.mjs';
{
  const tl = detectFromCreatorMarks('01:51\n跳过广告', 278, { timelineOnly: true });
  if (!tl || tl.end !== 111 || tl.source !== 'creator-timeline') {
    throw new Error(`comment timeline miss ${JSON.stringify(tl)}`);
  }
  const loose = detectFromCreatorMarks('正片从 2:00 开始', 300, { timelineOnly: true });
  if (loose) throw new Error(`timelineOnly loose hit ${JSON.stringify(loose)}`);
  const looseOk = detectFromCreatorMarks('正片从 2:00 开始', 300);
  if (!looseOk) throw new Error('non-timelineOnly should still catch 正片从');
}
console.log('OK comment timelineOnly');

// 结束点语义：「01:51 跳过广告」→ 段 [51,111]，startEstimated；前面有起点标记则用前值
{
  const endSeg = detectFromCreatorMarks('01:51\n跳过广告', 278, { timelineOnly: true });
  if (!endSeg || endSeg.start !== 51 || endSeg.end !== 111 || !endSeg.startEstimated) {
    throw new Error(`end-marker seg wrong ${JSON.stringify(endSeg)}`);
  }
  const pair = detectFromCreatorMarks('00:59 广告\n01:51 跳过广告', 278, { timelineOnly: true });
  if (!pair || pair.start !== 59 || pair.end !== 111 || pair.startEstimated) {
    throw new Error(`pair seg wrong ${JSON.stringify(pair)}`);
  }
}
console.log('OK end-marker semantics');

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

console.log(`全部通过 ${pass + 11}`);

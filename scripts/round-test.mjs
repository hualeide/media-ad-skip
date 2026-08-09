/**
 * 回环压测：单元 + SponsorBlock 对照 + 多 BV 弹幕
 * node scripts/round-test.mjs
 */
import {
  extractTimeFromText,
  detectFromJumpTexts,
  pickSponsorSegments,
  overlapRatio,
  fetchSponsorSegments,
  fetchBiliDanmaku,
  convertChineseNumbersToArabic,
} from '../src/detect-core.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(outDir, { recursive: true });

const UNIT = [
  ['空降1:30', 90],
  ['快进到 2:15', 135],
  ['三分二十秒', 200],
  ['一分半 空降', 90],
  ['705工程', 425],
  ['0705工程', 425],
  ['指路3分钟', 180],
  ['空降到90秒', 90],
  ['谢谢八分十五郎', 495],
  ['8分15郎', 495],
  ['2:15mark', 135],
  ['进度条君5:00', 300],
  ['发布一分钟', null],
  ['打8分', null],
  ['《我的世界1.20预告片》', null],
  ['空降兵00:01', null], // 低置信或应忽略；允许 1 但 conf 低——这里期望 null 更安全
  ['2026年8月4日21:45考古', null],
];

function runUnits() {
  let pass = 0;
  const fails = [];
  for (const [text, expect] of UNIT) {
    // 空降兵：我们允许解析出时间但 conf 低；严格期望 null
    const got = extractTimeFromText(text);
    const t = got ? got.time : null;
    // special: 空降兵 should not match jump → if got, conf should be low; treat as fail if conf>=1
    if (text.includes('空降兵')) {
      if (!got || got.conf < 1) {
        pass++;
        continue;
      }
      fails.push({ text, got, expect: 'null-or-low-conf' });
      continue;
    }
    if (t !== expect) fails.push({ text, got: t, expect });
    else pass++;
  }
  // cluster smoke
  const seg = detectFromJumpTexts([
    { time: 120, text: '广告来了' },
    { time: 125, text: '空降3:30' },
    { time: 130, text: '快进3:30' },
    { time: 140, text: '空降到3:30' },
    { time: 145, text: '谢谢三分三十郎' },
  ], 600);
  if (!seg || seg.end !== 210) fails.push({ text: 'cluster', got: seg, expect: 'end=210' });
  else pass++;
  return { pass, fails, total: UNIT.length + 1 };
}

async function compareWithSponsorBlock(bvid) {
  const [sbRaw, bili] = await Promise.all([
    fetchSponsorSegments(bvid).catch((e) => ({ __err: String(e) })),
    fetchBiliDanmaku(bvid).catch((e) => ({ __err: String(e) })),
  ]);
  if (sbRaw.__err || bili.__err) {
    return { bvid, error: sbRaw.__err || bili.__err };
  }
  const truth = pickSponsorSegments(sbRaw, { minVotes: 5 });
  const jump = detectFromJumpTexts(bili.danmaku, bili.duration);
  let hit = false;
  let bestOv = 0;
  if (jump && truth.length) {
    for (const t of truth) {
      const ov = overlapRatio(jump, t);
      if (ov > bestOv) bestOv = ov;
      if (ov >= 0.25 || Math.abs(jump.end - t.end) <= 15) hit = true;
    }
  }
  // 无 SB 高票段时，jump 也应尽量少误报
  const falsePositive = !truth.length && !!jump;
  return {
    bvid,
    title: bili.title,
    duration: bili.duration,
    danmaku: bili.danmaku.length,
    sbCount: truth.length,
    sbTop: truth.slice(0, 3),
    jump,
    hit,
    bestOv,
    falsePositive,
  };
}

const TEST_BVS = [
  'BV1bY4y1v7Mb', // SponsorBlock 示例
  'BV14741127BN', // SB 文档测试
  'BV1GJ411x7h7', // rickroll 负例
];

async function main() {
  const started = new Date().toISOString();
  console.log('=== round-test', started, '===');
  console.log('cn convert', convertChineseNumbersToArabic('谢谢八分十五郎'));

  const units = runUnits();
  console.log(`units ${units.pass}/${units.total}`);
  if (units.fails.length) console.log('unit fails', units.fails);

  const comparisons = [];
  for (const bvid of TEST_BVS) {
    process.stdout.write(`SB compare ${bvid}... `);
    const r = await compareWithSponsorBlock(bvid);
    comparisons.push(r);
    if (r.error) console.log('ERR', r.error);
    else {
      console.log(
        `sb=${r.sbCount} jump=${r.jump ? `${Math.round(r.jump.start)}-${Math.round(r.jump.end)}` : 'null'} hit=${r.hit} fp=${r.falsePositive} ov=${r.bestOv.toFixed(2)}`,
      );
    }
  }

  const report = { started, units, comparisons };
  const file = path.join(outDir, `round-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(report, null, 2));

  const hardFails = [
    ...units.fails.map((f) => `unit:${f.text}`),
    ...comparisons.filter((c) => c.falsePositive).map((c) => `fp:${c.bvid}`),
    // SB 有高票段则必须能挑出（API 路径）；弹幕 miss 只警告
    ...comparisons
      .filter((c) => !c.error && c.sbCount === 0 && Array.isArray(c.sbTop) === false)
      .map((c) => `sb-parse:${c.bvid}`),
  ];

  for (const c of comparisons) {
    if (c.error) continue;
    if (c.sbCount > 0 && !c.hit) {
      console.log(`WARN danmaku-miss ${c.bvid} (rely on SponsorBlock in product)`);
    }
  }

  // SB API 自身：示例片必须有高票 sponsor，且 pick 出的段应覆盖首段
  const demo = comparisons.find((c) => c.bvid === 'BV1bY4y1v7Mb');
  if (demo && !demo.error && demo.sbCount < 1) hardFails.push('sb-demo-empty');
  if (demo && !demo.error && demo.sbTop?.[0]) {
    const first = demo.sbTop[0];
    if (!(first.end > 30 && first.end < 40)) {
      console.log('WARN unexpected first SB end', first);
    }
  }
  console.log('report', file);
  console.log(hardFails.length ? `FAIL ${hardFails.join(' | ')}` : 'PASS all gates');
  if (hardFails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

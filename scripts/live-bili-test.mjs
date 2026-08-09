/**
 * 在线自测：拉 B 站真实弹幕，跑跳点算法
 * 用法: node scripts/live-bili-test.mjs [bvid]
 */
const bvid = process.argv[2] || 'BV1GJ411x7h7';
function zhNumToInt(str) {
  const ZH = { 零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
  if (!str) return 0;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (str === '十') return 10;
  if (str.includes('十')) {
    const [a, b] = str.split('十');
    return (a ? ZH[a] ?? 1 : 1) * 10 + (b ? ZH[b] ?? 0 : 0);
  }
  return ZH[str] ?? 0;
}
function extractTimeFromText(text) {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return null;
  if (/发布.{0,4}[分秒钟]|打\s*\d+\s*分/i.test(t)) return null;
  if (/\d+\.\d+.*(更新|版本|预告|我的世界|minecraft)/i.test(t)) return null;
  if (/minecraft|我的世界/i.test(t) && /\d+\.\d+/.test(t)) return null;
  if (/\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日|考古/.test(t)) return null;
  if (/\d{4}\s*[-/,.]\s*\d{1,2}/.test(t)) return null;
  let m = t.match(/(\d{1,2})[:;：；](\d{2})(?!\d)/);
  if (m && parseInt(m[2], 10) < 60) {
    const time = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const hasJump = /(空降(?!兵)|跳过|快进|广告|恰饭|指路|进度条)/.test(t);
    return { time, conf: hasJump ? 1.2 : 0.35 };
  }
  m = t.match(/([一二三四五六七八九十两\d]{1,3})\s*分\s*半/);
  if (m) return { time: zhNumToInt(m[1]) * 60 + 30, conf: 1.15 };
  m = t.match(/([一二三四五六七八九十两\d]{1,3})\s*分\s*([一二三四五六七八九十两\d]{1,3})\s*秒/);
  if (m) return { time: zhNumToInt(m[1]) * 60 + zhNumToInt(m[2]), conf: 1.1 };
  m = t.match(/([一二三四五六七八九十两\d]{1,3})\s*分钟?(?!\s*[半\d一二三四五六七八九十两])/);
  if (m && /(空降(?!兵)|跳过|快进|广告|恰饭|指路|进度条)/.test(t)) return { time: zhNumToInt(m[1]) * 60, conf: 1.0 };
  m = t.match(/0?(\d{1,2})(\d{2})\s*工程/);
  if (m && parseInt(m[2], 10) < 60) return { time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), conf: 1.3 };
  m = t.match(/(?:空降(?!兵)|跳过|快进|指路|进度条)[^\d]{0,6}(\d{2,4})\s*秒/);
  if (m) return { time: parseInt(m[1], 10), conf: 1.4 };
  return null;
}
function detectFromJumpTexts(items, duration) {
  const votes = new Map();
  const pairs = [];
  for (const it of items) {
    const info = extractTimeFromText(it.text);
    if (!info) continue;
    const end = Math.round(info.time);
    if (end <= 0 || (duration > 0 && end >= duration - 5)) continue;
    let score = info.conf + (/(空降(?!兵)|跳过|快进|广告|恰饭|指路)/.test(it.text) ? 0.8 : 0);
    votes.set(end, (votes.get(end) || 0) + score);
    if (typeof it.time === 'number') pairs.push({ start: it.time, end, score });
  }
  if (!votes.size) return null;
  const [bestEnd, bestScore] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestScore < 1.5) return null;
  let start = Math.max(0, bestEnd - 60);
  const related = pairs.filter((p) => Math.abs(p.end - bestEnd) <= 2 && p.end - p.start >= 20);
  if (related.length) {
    related.sort((a, b) => a.start - b.start);
    start = related[0].start + 2;
  }
  return { start, end: bestEnd, score: bestScore, votes: votes.size };
}
async function main() {
  console.log('fetch view', bvid);
  const view = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)).json();
  if (view.code !== 0) throw new Error(JSON.stringify(view));
  const cid = view.data.pages?.[0]?.cid || view.data.cid;
  const duration = view.data.duration;
  console.log({ title: view.data.title, cid, duration });
  const xml = await (await fetch(`https://comment.bilibili.com/${cid}.xml`)).text();
  const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  const danmaku = [];
  let m;
  while ((m = re.exec(xml)) !== null) danmaku.push({ time: parseFloat(m[1].split(',')[0]), text: m[2] });
  console.log('danmaku', danmaku.length);
  const withTime = danmaku.map(d => ({...d, parsed: extractTimeFromText(d.text)?.time})).filter(d => d.parsed != null);
  console.log('time-like', withTime.length);
  console.log(withTime.slice(0, 12).map(d => `${d.time.toFixed(1)}s "${d.text}" → ${d.parsed}`));
  console.log('segment', detectFromJumpTexts(danmaku, duration));
}
main().catch(e => { console.error(e); process.exit(1); });

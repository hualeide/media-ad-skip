/**
 * 防崩压力自测：大字符串 / 边界条件应快速早退，不得卡住主线程过久
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 模拟 ingestFeedJsonLight（与源码同阈值）
function ingestFeedJsonLight(text) {
  if (!text || text.length < 40 || text.length > 350_000) return 0;
  if (!/"aweme_id"/.test(text)) return 0;
  const idRe = /"aweme_id"\s*:\s*"?(\d{6,})"?/g;
  let m;
  let count = 0;
  while ((m = idRe.exec(text)) && count < 16) count += 1;
  return count;
}

const huge = 'x'.repeat(400_000);
const t0 = Date.now();
assert(ingestFeedJsonLight(huge) === 0, 'huge body must early-return');
assert(Date.now() - t0 < 50, 'huge early-return too slow');

const mid = `${'{"aweme_id":"1234567","is_ads":true},'.repeat(20)}`;
assert(ingestFeedJsonLight(mid) >= 1, 'small feed should parse ids');

const almost = `${'a'.repeat(349_000)}"aweme_id":"9999999"`;
const t1 = Date.now();
ingestFeedJsonLight(almost);
assert(Date.now() - t1 < 200, 'near-limit scan too slow');

// spaWatchKey 语义：忽略 t=
function spaWatchKey(pathname, search) {
  const m = pathname.match(/\/video\/(BV[\w]+)/i);
  const id = m ? m[1] : pathname;
  const p = new URLSearchParams(search).get('p') || '';
  return `${String(id).toUpperCase()}|${p}`;
}
assert(
  spaWatchKey('/video/BV1Auut6VE2V', '?t=6&spm=1') === spaWatchKey('/video/BV1Auut6VE2V', '?t=90'),
  't= must not change spa key',
);
assert(
  spaWatchKey('/video/BV1Auut6VE2V', '?p=1') !== spaWatchKey('/video/BV1Auut6VE2V', '?p=2'),
  'p= must change spa key',
);

// analyzeGen 语义
let analyzeGen = 0;
function still(gen) { return gen === analyzeGen; }
const g1 = analyzeGen;
analyzeGen += 1;
assert(!still(g1), 'stale gen must drop');
assert(still(analyzeGen), 'current gen ok');

console.log('crash-stress PASS');

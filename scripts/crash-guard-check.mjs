/**
 * 防崩静态自检（不启动浏览器）
 * 退出码 0 = 通过
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const warn = [];

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

const user = read('media-ad-skip.user.js');
const content = read('extension/content/content.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const bg = read('extension/background.js');
const bridge = read('extension/content/page-bridge.js');

const uv = (user.match(/\/\/ @version\s+(\S+)/) || [])[1];
const ug = (user.match(/window\.__MAS_VER__ = '([^']+)'/) || [])[1];
const cg = (content.match(/window\.__MAS_VER__ = '([^']+)'/) || [])[1];

if (uv !== cg || uv !== manifest.version) fails.push(`version drift user=${uv} content=${cg} manifest=${manifest.version}`);
if (!uv) fails.push('missing @version');
if (ug !== uv) fails.push(`user __MAS_VER__ ${ug} != @version ${uv}`);

if (manifest.manifest_version !== 3) fails.push('manifest_version not 3');
if (manifest.background?.scripts) fails.push('MV3 still has background.scripts');
if (!manifest.background?.service_worker) fails.push('missing service_worker');

for (const [name, src] of [['user', user], ['content', content]]) {
  if (/history\.(push|replace)State\s*=/.test(src)) fails.push(`${name}: history hijack`);
  if (/backdrop-filter/.test(src) && !/不用 backdrop-filter/.test(src)) fails.push(`${name}: backdrop-filter`);
  if (/document\.querySelectorAll\([^)]*\)/.test(src) && /querySelectorAll\('\*'\)|querySelectorAll\("\*"\)/.test(src)) {
    fails.push(`${name}: querySelectorAll(*)`);
  }
  if (!/fireIfChanged|spaWatchKey/.test(src) && name === 'user') fails.push('user: missing spaWatchKey/fireIfChanged');
  if (!/analyzeGen/.test(src)) fails.push(`${name}: missing analyzeGen`);
  if (!/MAX_FEED_BODY|350_000|350000/.test(src)) fails.push(`${name}: missing feed size cap`);
  if (!/feedResponseTooLarge|content-length|MAX_FEED_BODY/.test(src)) warn.push(`${name}: no Content-Length gate?`);
  // Crashpad：renderer FATAL + GPU video — 禁止打点/打视频合成层
  if (/document\.elementFromPoint\s*\(/.test(src)) fails.push(`${name}: elementFromPoint`);
  if (!/probeViewportText\(\)\s*\{\s*return \[\];\s*\}/.test(src)
    && !/function probeViewportText\(\)\s*\{\s*return \[\];\s*\}/.test(src)) {
    // content 可能被压缩排版；至少要求 stub 返回空
    if (/function probeViewportText/.test(src) && !/probeViewportText[\s\S]{0,120}return \[\]/.test(src)) {
      fails.push(`${name}: probeViewportText not stubbed`);
    }
  }
}

if (!/MAX_DANMAKU_XML|600_000|600000/.test(user) || !/danmaku xml too large/.test(user)) {
  fails.push('user: danmaku size guard missing');
}
if (!/MAX_RENDER_DATA|250_000|250000/.test(user)) fails.push('user: RENDER_DATA cap missing');
if (!bridge.includes('600000') && !bridge.includes('600_000') && !bridge.includes('MAX')) fails.push('page-bridge: size cap missing');
if (!bg.includes('800000') && !bg.includes('800_000')) fails.push('background: size cap missing');

// 危险：整页 innerText
if (/\binnerText\b/.test(content.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  // allow only if rare - flag any
  const lines = content.split('\n').map((l, i) => ({ l, i: i + 1 })).filter((x) => /\binnerText\b/.test(x.l) && !/\/\//.test(x.l.trim().slice(0, 2)));
  if (lines.length) warn.push(`content innerText lines: ${lines.map((x) => x.i).join(',')}`);
}

// 抖音必须延后 start，且 hooks 装在 start 回调内
if (!/requestIdleCallback\(\(\) => setTimeout\(start, 2200\)/.test(user)
  && !/setTimeout\(start, 2800\)/.test(user)) {
  fails.push('douyin start not delayed');
}
const startBlock = user.slice(user.indexOf('const start = () =>'), user.indexOf('const start = () =>') + 450);
if (!startBlock.includes('installDouyinFeedHooks()')) {
  fails.push('douyin hooks not inside delayed start()');
}

// content 必须含防崩注释/逻辑
if (/history\.pushState\s*=/.test(content)) fails.push('content still hijacks pushState');
if (!content.includes('禁止劫持 history')) fails.push('content missing no-hijack comment/path');

console.log(JSON.stringify({
  round: 'static-crash-guard',
  version: uv,
  failCount: fails.length,
  warnCount: warn.length,
  fails,
  warn,
}, null, 2));

if (fails.length) process.exit(1);

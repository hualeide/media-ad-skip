import fs from 'fs';
import path from 'path';

const dir = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data/Crashpad/reports');
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.dmp'))
  .map((f) => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { f, p, t: st.mtimeMs, size: st.size };
  })
  .sort((a, b) => b.t - a.t)
  .slice(0, 8);

function extractStrings(buf) {
  const strings = [];
  let cur = '';
  for (let i = 0; i < buf.length; i += 1) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else {
      if (cur.length >= 8) strings.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 8) strings.push(cur);
  return strings;
}

const hitRe = /gpu|GPU|viz|compositor|blink|Renderer|FATAL|CHECK|douyin|Media|WebGL|Skia|oom|Out of memory|STATUS_|EXCEPTION_|chrome\.dll|raw_hash|NOTREACHED|video|ANGLE|mas-|__MAS|ContentShell|Gpu/i;

for (const file of files) {
  const buf = fs.readFileSync(file.p);
  const strings = extractStrings(buf);
  const hits = [...new Set(strings.filter((s) => hitRe.test(s)))].slice(0, 30);
  const urls = [...new Set(
    strings
      .map((s) => {
        const m = s.match(/https?:\/\/[^\s"'\\]+/i);
        return m ? m[0].replace(/[,;)].*$/, '') : null;
      })
      .filter(Boolean),
  )].slice(0, 15);
  const fatals = [...new Set(strings.filter((s) => /FATAL:|NOTREACHED|LOG_FATAL|Check failed/i.test(s)))].slice(0, 10);
  console.log('====', new Date(file.t).toLocaleString(), 'size=' + file.size, file.f);
  console.log('fatals:', fatals.join('\n  ') || '(none)');
  console.log('urls:', urls.join('\n  ') || '(none)');
  console.log('hits:', hits.join(' | '));
  console.log('');
}

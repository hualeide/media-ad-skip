/**
 * 打包 extension/ 为可分发 zip（供 GitHub Release）
 * 用法：node scripts/pack-extension.mjs
 *
 * 产出两个文件：
 * - media-ad-skip-extension-v{ver}.zip  （带版本，便于归档）
 * - media-ad-skip-extension.zip         （固定名，供 /releases/latest/download/ 直链）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const ver = manifest.version;
const outDir = path.join(root, 'dist');
const outZipVer = path.join(outDir, `media-ad-skip-extension-v${ver}.zip`);
const outZipStable = path.join(outDir, 'media-ad-skip-extension.zip');

fs.mkdirSync(outDir, { recursive: true });
for (const f of [outZipVer, outZipStable]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

function packTo(dest) {
  const ps = `Compress-Archive -Path '${ext.replace(/'/g, "''")}\\*' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
  } catch {
    execSync(`tar -a -cf "${dest}" -C "${ext}" .`, { stdio: 'inherit' });
  }
}

packTo(outZipVer);
fs.copyFileSync(outZipVer, outZipStable);

console.log('packed', outZipVer);
console.log('packed', outZipStable);
console.log('stable download URL after release:');
console.log('  https://github.com/hualeide/media-ad-skip/releases/latest/download/media-ad-skip-extension.zip');
console.log('next: gh release create v' + ver + ' "' + outZipVer + '" "' + outZipStable + '" --title "v' + ver + '" --generate-notes');

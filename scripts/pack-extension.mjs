/**
 * 打包 extension/ 为可分发 zip（供 GitHub Release）
 * 用法：node scripts/pack-extension.mjs
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
const outZip = path.join(outDir, `media-ad-skip-extension-v${ver}.zip`);

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

// 优先用 PowerShell Compress-Archive（Windows）
const ps = `Compress-Archive -Path '${ext.replace(/'/g, "''")}\\*' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force`;
try {
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
} catch {
  // fallback: tar (Windows 10+/Git)
  execSync(`tar -a -cf "${outZip}" -C "${ext}" .`, { stdio: 'inherit' });
}

console.log('packed', outZip);
console.log('next: gh release create v' + ver + ' "' + outZip + '" --title "v' + ver + '" --generate-notes');

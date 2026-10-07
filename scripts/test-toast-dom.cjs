const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const repo = process.argv.slice(2).find(arg => !arg.startsWith('--'))
  || path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const files = ['media-ad-skip.user.js', 'extension/content/content.js'];
const labels = [
  '\u5e7f\u544a',
  '&<> " \'',
  '<img src=x onerror="window.__injected=true">',
  '<script>window.__injected=true</script>',
  '',
];

function extract(source, name) {
  const match = source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `Missing actual function: ${name}`);
  return match[0];
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  let cases = 0;
  try {
    const context = await browser.newContext({ offline: true });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    for (const file of files) {
      const source = baseline
        ? execFileSync('git', ['-C', repo, 'show', `HEAD:${file}`], { encoding: 'utf8' })
        : fs.readFileSync(path.join(repo, file), 'utf8');
      const functions = ['formatTime', 'bindMasActions', 'showUpcomingToast']
        .map(name => extract(source, name)).join('\n');
      for (const label of labels) {
        for (const withActions of [false, true]) {
          cases++;
          const result = await page.evaluate(({ functions, label, withActions }) => {
            document.body.replaceChildren();
            document.getElementById('mas-skip-toast')?.remove();
            window.__injected = false;
            const calls = [];
            const cfg = { showUndoToast: true, countdownSec: 3 };
            const ensureToastStyles = () => {};
            const dismissMasToast = () => {};
            const revealToast = () => {};
            const armToastAutoHide = () => {};
            const toastStayMs = () => 0;
            const doSkip = () => calls.push('go');
            const rejectSegForever = () => calls.push('no');
            const segKey = () => 'fixture';
            const log = (...args) => { throw new Error(args.join(' ')); };
            const loaded = eval(`(() => { ${functions}; return {showUpcomingToast, formatTime}; })()`);
            const seg = { start: 0, end: 10, label };
            loaded.showUpcomingToast(seg, { withActions });
            const toast = document.getElementById('mas-skip-toast');
            const expected = loaded.formatTime(0) + ' \u2192 ' + loaded.formatTime(10)
              + (label ? ' \u00b7 ' + label : '');
            const text = toast?.querySelector('.mas-toast-sub')?.textContent;
            const dangerousElements = toast?.querySelectorAll('img,script').length;
            const eventAttributes = [...(toast?.querySelectorAll('*') || [])]
              .flatMap(el => [...el.attributes]).filter(attr => /^on/i.test(attr.name)).length;
            const buttons = toast?.querySelectorAll('button').length;
            if (withActions) {
              toast.querySelector('[data-mas-act="go"]').click();
              toast.querySelector('[data-mas-act="no"]').click();
            }
            return { text, expected, dangerousElements, eventAttributes, buttons, calls,
              injected: window.__injected };
          }, { functions, label, withActions });
          try {
            assert.equal(result.text, result.expected);
            assert.equal(result.dangerousElements, 0);
            assert.equal(result.eventAttributes, 0);
            assert.equal(result.injected, false);
            assert.equal(result.buttons, withActions ? 2 : 0);
            assert.deepEqual(result.calls, withActions ? ['go', 'no'] : []);
          } catch (error) {
            failures++;
            console.error(`FAIL ${file}, label=${JSON.stringify(label)}, actions=${withActions}`);
            console.error(error.message);
          }
        }
      }
    }
    console.log(`${baseline ? 'HEAD baseline' : 'Working tree'}: ${cases - failures}/${cases} passed`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

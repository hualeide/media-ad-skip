const DEFAULTS = {
  autoSkip: true,
  showPanel: false,
  showUndoToast: true,
  useSponsorBlock: true,
  douyinInVideo: true,
  douyinFeedAd: false,
  douyinFeedLive: false,
  douyinFeedShop: false,
  biliInVideo: true,
  countdownSec: 3,
  softOralSkipSec: 35,
  feedPollMs: 900,
};

async function getCfg() {
  const { cfg } = await chrome.storage.sync.get(['cfg']);
  return { ...DEFAULTS, ...(cfg || {}) };
}

async function patch(partial) {
  const cfg = await getCfg();
  await chrome.storage.sync.set({ cfg: { ...cfg, ...partial } });
}

function isSupportedUrl(url) {
  return /:\/\/([^/]*\.)?(bilibili|douyin|iesdouyin)\.com\//i.test(url || '');
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** 只通信，绝不向抖音页热注入大脚本 */
async function sendCmd(cmd) {
  const tab = await activeTab();
  if (!tab?.id) return { ok: false, error: '无活动标签' };
  if (!isSupportedUrl(tab.url || '')) {
    return { ok: false, error: '请在抖音/B站视频页使用' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'MAS_CMD', cmd });
  } catch {
    return { ok: false, error: '页面未加载插件，请刷新该视频页后再试' };
  }
}

function setStatus(text) {
  document.getElementById('status').textContent = text || '待命';
}

function setBlockUi(blocked) {
  const input = document.getElementById('blockThis');
  const hint = document.getElementById('blockHint');
  input.checked = !!blocked;
  hint.textContent = blocked ? '开：本集不会自动跳广告' : '关：本集会跳过广告';
}

async function refreshStatus() {
  const res = await sendCmd('status');
  if (res?.ok) {
    setStatus(res.status || '待命');
    setBlockUi(!!res.blocked);
  } else {
    setStatus(res?.error || '待命');
    setBlockUi(false);
  }
}

async function load() {
  const c = await getCfg();
  document.getElementById('autoSkip').checked = c.autoSkip !== false;
  document.getElementById('feedSwipe').checked = !!(c.douyinFeedAd || c.douyinFeedLive);
  await refreshStatus();
}

document.getElementById('autoSkip').addEventListener('change', (e) => {
  patch({ autoSkip: e.target.checked });
});
document.getElementById('feedSwipe').addEventListener('change', (e) => {
  const on = e.target.checked;
  patch({ douyinFeedAd: on, douyinFeedLive: on });
});
document.getElementById('blockThis').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const res = await sendCmd(on ? 'block' : 'unblock');
  if (res?.ok) {
    setStatus(res.status || (on ? '本集已禁用' : '已恢复本集'));
    setBlockUi(!!res.blocked || on);
  } else {
    setStatus(res?.error || '操作失败');
    e.target.checked = !on;
    setBlockUi(!on);
  }
});

async function run(cmd) {
  const res = await sendCmd(cmd);
  setStatus(res?.status || res?.error || '完成');
  if (typeof res?.blocked === 'boolean') setBlockUi(res.blocked);
}

document.getElementById('reanalyze').addEventListener('click', () => run('reanalyze'));
document.getElementById('undo').addEventListener('click', () => run('undo'));
document.getElementById('wrong').addEventListener('click', () => run('wrong'));
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

load();

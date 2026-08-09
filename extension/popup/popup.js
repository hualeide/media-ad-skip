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
    return { ok: false, error: '页面未加载插件，请点下方「刷新当前页」' };
  }
}

function setStatus(text) {
  document.getElementById('status').textContent = text || '待命';
}

async function refreshStatus() {
  const res = await sendCmd('status');
  if (res?.ok) setStatus(res.status || '待命');
  else setStatus(res?.error || '待命');
}

async function load() {
  const c = await getCfg();
  document.getElementById('autoSkip').checked = c.autoSkip !== false;
  // 划走：信息流广告 + 直播卡共用一个开关
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

async function run(cmd) {
  const res = await sendCmd(cmd);
  setStatus(res?.status || res?.error || '完成');
}

document.getElementById('reanalyze').addEventListener('click', () => run('reanalyze'));
document.getElementById('undo').addEventListener('click', () => run('undo'));
document.getElementById('block').addEventListener('click', () => run('block'));
document.getElementById('wrong').addEventListener('click', () => run('wrong'));
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('reloadTab').addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab?.id) chrome.tabs.reload(tab.id);
  setStatus('已刷新，请稍候再打开插件');
});

load();

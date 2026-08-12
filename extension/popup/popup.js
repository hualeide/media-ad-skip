const DEFAULTS = {
  autoSkip: true,
  showPanel: false,
  showUndoToast: true,
  useSponsorBlock: true,
  douyinInVideo: true,
  douyinFeedAd: true,
  douyinFeedLive: false,
  douyinFeedShop: true,
  biliInVideo: true,
  countdownSec: 3,
  softOralSkipSec: 35,
  feedPollMs: 1400,
};

let lastVideoId = null;

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

function videoIdFromUrl(url) {
  const u = String(url || '');
  const modal = u.match(/[?&#]modal_id=(\d+)/);
  if (modal) return modal[1];
  const dy = u.match(/\/video\/(\d+)/);
  if (dy) return dy[1];
  const bv = u.match(/\/video\/(BV[\w]+)/i);
  if (bv) return bv[1];
  return null;
}

/** 只通信，绝不向抖音页热注入大脚本 */
async function sendCmd(cmd, extra = {}) {
  const tab = await activeTab();
  if (!tab?.id) return { ok: false, error: '无活动标签' };
  if (!isSupportedUrl(tab.url || '')) {
    return { ok: false, error: '请在抖音/B站视频页使用' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'MAS_CMD', cmd, ...extra });
  } catch {
    return { ok: false, error: '页面未加载插件，请刷新该视频页后再试' };
  }
}

function setStatus(text) {
  document.getElementById('status').textContent = text || '待命';
}

async function refreshFeedStat() {
  const el = document.getElementById('feedStat');
  if (!el) return;
  try {
    const { masStats = {} } = await chrome.storage.local.get(['masStats']);
    const ad = (Number(masStats.feedAdCount) || 0) + (Number(masStats.feedShopCount) || 0);
    const skip = Number(masStats.skipCount) || 0;
    const sec = Math.max(0, Math.floor(Number(masStats.savedSec) || 0));
    let saved = `${sec}秒`;
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      saved = s ? `${m}分${s}秒` : `${m}分`;
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const rm = m % 60;
        saved = rm ? `${h}小时${rm}分` : `${h}小时`;
      }
    }
    el.textContent = `划走 ${ad} · 跳过 ${skip} · 已删 ${saved}`;
  } catch {
    el.textContent = '划走 — · 跳过 — · 已删 —';
  }
}

function setBlockUi(blocked) {
  const input = document.getElementById('blockThis');
  const hint = document.getElementById('blockHint');
  input.checked = !!blocked;
  hint.textContent = blocked ? '开：本集不会自动跳广告' : '关：本集会跳过广告';
}

async function resolveVideoId() {
  if (lastVideoId) return lastVideoId;
  const tab = await activeTab();
  const fromUrl = videoIdFromUrl(tab?.url);
  if (fromUrl) {
    lastVideoId = fromUrl;
    return fromUrl;
  }
  return null;
}

/** 弹窗直接改 storage，不依赖页面回包，避免开关弹回 */
async function writeBlockState(on, videoId) {
  const id = String(videoId);
  const { blockBvids = [] } = await chrome.storage.local.get(['blockBvids']);
  const set = new Set((blockBvids || []).map(String));
  if (on) set.add(id);
  else set.delete(id);
  const next = [...set];
  await chrome.storage.local.set({ blockBvids: next });
  return next;
}

async function refreshStatus() {
  const tab = await activeTab();
  const urlId = videoIdFromUrl(tab?.url);
  if (urlId) lastVideoId = urlId;

  const res = await sendCmd('status');
  if (res?.ok) {
    if (res.videoId) lastVideoId = res.videoId;
    setStatus(res.status || '待命');
    // 以 storage 为准，避免 content 内存不同步导致关不上
    const id = lastVideoId || res.videoId;
    if (id) {
      const { blockBvids = [] } = await chrome.storage.local.get(['blockBvids']);
      setBlockUi(blockBvids.map(String).includes(String(id)));
    } else {
      setBlockUi(!!res.blocked);
    }
  } else {
    setStatus(res?.error || '待命');
    if (lastVideoId) {
      const { blockBvids = [] } = await chrome.storage.local.get(['blockBvids']);
      setBlockUi(blockBvids.map(String).includes(String(lastVideoId)));
    } else {
      setBlockUi(false);
    }
  }
}

document.getElementById('autoSkip').addEventListener('change', (e) => {
  patch({ autoSkip: e.target.checked });
});
document.getElementById('feedAd').addEventListener('change', (e) => {
  const on = e.target.checked;
  patch({ douyinFeedAd: on, douyinFeedShop: on });
});
document.getElementById('feedLive').addEventListener('change', (e) => {
  patch({ douyinFeedLive: e.target.checked });
});

document.getElementById('blockThis').addEventListener('change', async (e) => {
  const on = !!e.target.checked;
  // 先按用户意图显示，禁止中途弹回
  setBlockUi(on);

  let videoId = await resolveVideoId();
  const st = await sendCmd('status');
  if (st?.videoId) {
    videoId = st.videoId;
    lastVideoId = st.videoId;
  }

  if (!videoId) {
    setStatus('无法识别视频，请打开具体视频页');
    setBlockUi(false);
    return;
  }

  try {
    await writeBlockState(on, videoId);
    // 通知内容脚本同步内存（失败也不弹回开关）
    const res = await sendCmd(on ? 'block' : 'unblock', { videoId });
    setStatus(
      res?.status
      || (on ? '本集已禁用跳过' : '已恢复本集跳过'),
    );
    setBlockUi(on);
  } catch (err) {
    setStatus(String(err?.message || err || '操作失败'));
    setBlockUi(on);
  }
});

async function run(cmd) {
  const res = await sendCmd(cmd);
  setStatus(res?.status || res?.error || '完成');
  await refreshStatus();
}

document.getElementById('reanalyze').addEventListener('click', () => run('reanalyze'));
document.getElementById('undo').addEventListener('click', () => run('undo'));
document.getElementById('wrong').addEventListener('click', () => run('wrong'));
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

let updateMeta = null;

function renderUpdate(meta) {
  const box = document.getElementById('updateBox');
  const title = document.getElementById('updateTitle');
  const desc = document.getElementById('updateDesc');
  updateMeta = meta || null;
  if (meta?.hasUpdate) {
    box.classList.add('show');
    title.textContent = `有新版本 ${meta.latestVersion}`;
    desc.textContent = `当前 ${meta.localVersion || chrome.runtime.getManifest().version} → 下载 ZIP，覆盖 extension 文件夹后在扩展页点「重新加载」。`;
  } else if (meta && !meta.error) {
    box.classList.remove('show');
  } else if (meta?.error) {
    box.classList.add('show');
    title.textContent = '检查更新失败';
    desc.textContent = meta.error;
  } else {
    box.classList.remove('show');
  }
}

async function refreshUpdate(force) {
  try {
    const res = await chrome.runtime.sendMessage({ type: force ? 'MAS_CHECK_UPDATE' : 'MAS_GET_UPDATE', force: !!force });
    if (force && res?.ok) renderUpdate(res.meta);
    else if (!force && res?.ok) renderUpdate(res.meta);
    if (force && res?.ok && !res.meta?.hasUpdate) {
      setStatus(res.meta?.error ? `更新检查失败：${res.meta.error}` : `已是最新（${res.meta?.localVersion || ''}）`);
      if (!res.meta?.hasUpdate && !res.meta?.error) {
        document.getElementById('updateBox').classList.add('show');
        document.getElementById('updateTitle').textContent = '已是最新';
        document.getElementById('updateDesc').textContent = `当前版本 ${res.meta?.localVersion || chrome.runtime.getManifest().version}`;
      }
    }
  } catch { /* ignore */ }
}

document.getElementById('updateCheck').addEventListener('click', () => refreshUpdate(true));
document.getElementById('updateOpen').addEventListener('click', () => {
  const url = updateMeta?.zip || updateMeta?.url || 'https://github.com/hualeide/media-ad-skip/releases';
  chrome.tabs.create({ url });
});

async function load() {
  const c = await getCfg();
  document.getElementById('autoSkip').checked = c.autoSkip !== false;
  document.getElementById('feedAd').checked = !!(c.douyinFeedAd || c.douyinFeedShop);
  document.getElementById('feedLive').checked = !!c.douyinFeedLive;
  await refreshFeedStat();
  await refreshStatus();
  await refreshUpdate(false);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.masStats) refreshFeedStat();
    });
  } catch { /* ignore */ }
  // 打开弹窗时轻量检查（后台有缓存）
  chrome.runtime.sendMessage({ type: 'MAS_CHECK_UPDATE', force: false }).then((res) => {
    if (res?.ok) renderUpdate(res.meta);
  }).catch(() => {});
}

load();

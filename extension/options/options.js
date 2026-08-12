const DEFAULT_BRAND_KW = (typeof MAS_DEFAULT_BRAND_KW !== 'undefined' && MAS_DEFAULT_BRAND_KW.length)
  ? MAS_DEFAULT_BRAND_KW.slice()
  : [
    '转转', '爱回收', '闲鱼', '瓜子', '萤石', '山楂树下', '真我',
    '神奇小鹿', '小鹿冰被', '躺岛', '蓝盒子', '半日闲', '时光存折', '栖作', '甜秘密',
    '华味坊', '酸汤面叶', '劲仔', '卫龙', '盐津铺子', '三只松鼠', '良品铺子', '王小卤', '认养一头牛',
    '妙界', '赫恩', '海洋至尊', '溪木源', '博乐达', '蜜丝婷',
    '盖世小鸡', '飞智', '北通', '黑白调', '骁骑',
    '瑞幸', '安克', '酷态科',
  ];

const DEFAULTS = {
  autoSkip: true,
  showPanel: false,
  douyinFeedAd: true,
  douyinFeedLive: false,
  douyinFeedShop: true,
  douyinInVideo: true,
  biliInVideo: true,
  feedPollMs: 1400,
  countdownSec: 3,
  softOralSkipSec: 35,
  softOralAuto: false,
  useSponsorBlock: true,
  showUndoToast: true,
  statsEnabled: false,
};

const BOOL_IDS = [
  'autoSkip', 'showPanel', 'showUndoToast', 'useSponsorBlock', 'softOralAuto',
  'biliInVideo', 'douyinInVideo', 'douyinFeedAd', 'douyinFeedLive', 'douyinFeedShop',
];

const EMPTY_STATS = {
  skipCount: 0,
  undoCount: 0,
  wrongCount: 0,
  feedSwipeCount: 0,
  feedAdCount: 0,
  feedLiveCount: 0,
  feedShopCount: 0,
  savedSec: 0,
};

function linesToList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(arr) {
  return (arr || []).join('\n');
}

function formatSavedTime(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  if (n < 60) return `${n}秒`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m < 60) return s ? `${m}分${s}秒` : `${m}分`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}小时${rm}分` : `${h}小时`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg || '已保存';
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 1600);
}

function renderStats(stats) {
  const s = { ...EMPTY_STATS, ...(stats || {}) };
  // 划走广告：广告卡 + 带货（用户感知都是广告）
  const swipeAds = (Number(s.feedAdCount) || 0) + (Number(s.feedShopCount) || 0);
  const feedAd = document.getElementById('statFeedAd');
  const skip = document.getElementById('statSkip');
  const saved = document.getElementById('statSaved');
  if (feedAd) feedAd.textContent = String(swipeAds);
  if (skip) skip.textContent = String(s.skipCount || 0);
  if (saved) saved.textContent = formatSavedTime(s.savedSec);
}

async function loadStats() {
  const { masStats = {} } = await chrome.storage.local.get(['masStats']);
  renderStats(masStats);
  return masStats;
}

async function loadFeedback() {
  const { feedbackLog = [] } = await chrome.storage.local.get(['feedbackLog']);
  const el = document.getElementById('feedbackPreview');
  if (!feedbackLog.length) {
    el.textContent = '（暂无）';
    return feedbackLog;
  }
  el.textContent = feedbackLog.slice(-5).reverse().map((x) => JSON.stringify(x)).join('\n');
  return feedbackLog;
}

async function load() {
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version) {
    document.getElementById('extVersion').textContent = `v${manifest.version}`;
  }
  const sync = await chrome.storage.sync.get(['cfg']);
  const local = await chrome.storage.local.get(['brandKeywords', 'blockBvids', 'blockMids']);
  const cfg = { ...DEFAULTS, ...(sync.cfg || {}) };
  for (const id of BOOL_IDS) {
    const el = document.getElementById(id);
    if (el) el.checked = !!cfg[id];
  }
  document.getElementById('countdownSec').value = cfg.countdownSec ?? 3;
  document.getElementById('softOralSkipSec').value = cfg.softOralSkipSec ?? 35;
  document.getElementById('feedPollMs').value = cfg.feedPollMs ?? 1400;

  let brands = local.brandKeywords || cfg.brandKeywords || DEFAULT_BRAND_KW;
  if (!Array.isArray(brands)) brands = DEFAULT_BRAND_KW.slice();
  brands = brands.map((x) => String(x).trim()).filter(Boolean);
  // 残缺短列表（例如只剩 5 个）自动补全默认词并写回
  if (brands.length > 0 && brands.length < Math.ceil(DEFAULT_BRAND_KW.length * 0.5)) {
    const set = new Set(brands);
    for (const k of DEFAULT_BRAND_KW) set.add(k);
    brands = [...set];
    await chrome.storage.local.set({ brandKeywords: brands });
    showToast(`已补全默认品牌词（现 ${brands.length} 个）`);
  } else if (!brands.length) {
    brands = DEFAULT_BRAND_KW.slice();
  }
  document.getElementById('brandKeywords').value = listToLines(brands);
  document.getElementById('blockBvids').value = listToLines(local.blockBvids || cfg.blockBvids || []);
  document.getElementById('blockMids').value = listToLines(local.blockMids || cfg.blockMids || []);
  await loadFeedback();
  await loadStats();
}

async function save() {
  const cfg = { ...DEFAULTS };
  for (const id of BOOL_IDS) {
    cfg[id] = !!document.getElementById(id).checked;
  }
  cfg.countdownSec = Math.max(0, Math.min(15, Number(document.getElementById('countdownSec').value) || 0));
  cfg.softOralSkipSec = Math.max(15, Math.min(90, Number(document.getElementById('softOralSkipSec').value) || 35));
  cfg.feedPollMs = Math.max(400, Math.min(3000, Number(document.getElementById('feedPollMs').value) || 1400));
  const brandKeywords = linesToList(document.getElementById('brandKeywords').value);
  const blockBvids = linesToList(document.getElementById('blockBvids').value);
  const blockMids = linesToList(document.getElementById('blockMids').value);

  await chrome.storage.sync.set({ cfg });
  await chrome.storage.local.set({ brandKeywords, blockBvids, blockMids });
  await loadStats();
  showToast('已保存');
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('resetStats')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ masStats: { ...EMPTY_STATS } });
  await loadStats();
  showToast('统计已清零');
});
document.getElementById('resetBrands').addEventListener('click', () => {
  document.getElementById('brandKeywords').value = DEFAULT_BRAND_KW.join('\n');
  showToast('已恢复默认品牌词（记得保存）');
});
document.getElementById('mergeBrands').addEventListener('click', () => {
  const cur = new Set(linesToList(document.getElementById('brandKeywords').value));
  let added = 0;
  for (const k of DEFAULT_BRAND_KW) {
    if (!cur.has(k)) {
      cur.add(k);
      added += 1;
    }
  }
  document.getElementById('brandKeywords').value = [...cur].join('\n');
  showToast(added ? `已合并 ${added} 个默认词（记得保存）` : '已是最新默认词');
});
document.getElementById('exportFeedback').addEventListener('click', async () => {
  const log = await loadFeedback();
  const text = JSON.stringify(log, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast('反馈已复制');
  } catch {
    alert(text);
  }
});
document.getElementById('clearFeedback').addEventListener('click', async () => {
  await chrome.storage.local.set({ feedbackLog: [] });
  await loadFeedback();
  showToast('反馈已清空');
});

function renderUpdateStatus(meta) {
  const el = document.getElementById('updateStatus');
  if (!el) return;
  const local = chrome.runtime.getManifest().version;
  if (!meta) {
    el.textContent = `当前 v${local}`;
    return;
  }
  if (meta.hasUpdate) {
    el.textContent = `发现新版本 v${meta.latestVersion}（当前 v${meta.localVersion || local}）`;
  } else if (meta.error) {
    el.textContent = `检查失败：${meta.error}`;
  } else {
    el.textContent = `已是最新 v${meta.localVersion || local}`;
  }
}

document.getElementById('checkUpdate')?.addEventListener('click', async () => {
  showToast('正在检查…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'MAS_CHECK_UPDATE', force: true });
    renderUpdateStatus(res?.meta);
    showToast(res?.meta?.hasUpdate ? '有新版本' : (res?.meta?.error ? '检查失败' : '已是最新'));
  } catch (e) {
    showToast('检查失败');
  }
});
document.getElementById('openRelease')?.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'MAS_GET_UPDATE' });
  const url = res?.meta?.url || 'https://github.com/hualeide/media-ad-skip/releases';
  chrome.tabs.create({ url });
});

load().then(async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'MAS_GET_UPDATE' });
    renderUpdateStatus(res?.meta);
    chrome.runtime.sendMessage({ type: 'MAS_CHECK_UPDATE', force: false }).then((r) => {
      if (r?.ok) renderUpdateStatus(r.meta);
    });
  } catch { /* ignore */ }
});

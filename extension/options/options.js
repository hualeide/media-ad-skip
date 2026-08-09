const DEFAULT_BRAND_KW = [
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
  douyinFeedLive: true,
  douyinFeedShop: false,
  douyinInVideo: true,
  biliInVideo: true,
  feedPollMs: 900,
  countdownSec: 3,
  softOralSkipSec: 35,
  useSponsorBlock: true,
  showUndoToast: true,
};

const BOOL_IDS = [
  'autoSkip', 'showPanel', 'showUndoToast', 'useSponsorBlock',
  'biliInVideo', 'douyinInVideo', 'douyinFeedAd', 'douyinFeedLive', 'douyinFeedShop',
];

function linesToList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(arr) {
  return (arr || []).join('\n');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg || '已保存';
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 1600);
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
  document.getElementById('feedPollMs').value = cfg.feedPollMs ?? 900;
  document.getElementById('brandKeywords').value = listToLines(
    local.brandKeywords || cfg.brandKeywords || DEFAULT_BRAND_KW,
  );
  document.getElementById('blockBvids').value = listToLines(local.blockBvids || cfg.blockBvids || []);
  document.getElementById('blockMids').value = listToLines(local.blockMids || cfg.blockMids || []);
  await loadFeedback();
}

async function save() {
  const cfg = { ...DEFAULTS };
  for (const id of BOOL_IDS) {
    cfg[id] = !!document.getElementById(id).checked;
  }
  cfg.countdownSec = Math.max(0, Math.min(15, Number(document.getElementById('countdownSec').value) || 0));
  cfg.softOralSkipSec = Math.max(15, Math.min(90, Number(document.getElementById('softOralSkipSec').value) || 35));
  cfg.feedPollMs = Math.max(400, Math.min(3000, Number(document.getElementById('feedPollMs').value) || 900));
  const brandKeywords = linesToList(document.getElementById('brandKeywords').value);
  const blockBvids = linesToList(document.getElementById('blockBvids').value);
  const blockMids = linesToList(document.getElementById('blockMids').value);

  await chrome.storage.sync.set({ cfg });
  await chrome.storage.local.set({ brandKeywords, blockBvids, blockMids });
  showToast('已保存');
}

document.getElementById('save').addEventListener('click', save);
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

load();

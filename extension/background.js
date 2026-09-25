/* Media Ad Skip — MV3 service worker */
const REPO = 'hualeide/media-ad-skip';
const UPDATE_ALARM = 'mas-update-check';
const CHECK_HOURS = 24;
// 与 src/config.mjs 的 MAX_BG_FETCH 对齐
const MAX_BG_FETCH = 800_000;

function parseVer(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
}

function cmpVer(a, b) {
  const aa = parseVer(a);
  const bb = parseVer(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i += 1) {
    const x = aa[i] || 0;
    const y = bb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function fetchLatestVersion() {
  // 优先 Release；没有则用最新 tag
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (r.ok) {
      const j = await r.json();
      const tag = String(j.tag_name || '').replace(/^v/i, '');
      if (tag) {
        const assets = Array.isArray(j.assets) ? j.assets : [];
        const stable = assets.find((a) => a?.name === 'media-ad-skip-extension.zip');
        const anyZip = assets.find((a) => /\.zip$/i.test(a?.name || ''));
        const zip = stable?.browser_download_url
          || anyZip?.browser_download_url
          || `https://github.com/${REPO}/releases/latest/download/media-ad-skip-extension.zip`;
        return {
          version: tag,
          url: j.html_url || `https://github.com/${REPO}/releases/latest`,
          zip,
          name: j.name || tag,
        };
      }
    }
  } catch { /* fallthrough */ }

  const r2 = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=1`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!r2.ok) throw new Error(`GitHub ${r2.status}`);
  const tags = await r2.json();
  const tag = String(tags?.[0]?.name || '').replace(/^v/i, '');
  if (!tag) throw new Error('no tags');
  return {
    version: tag,
    url: `https://github.com/${REPO}/releases/latest`,
    zip: `https://github.com/${REPO}/releases/latest/download/media-ad-skip-extension.zip`,
    name: tag,
  };
}

async function checkForUpdate(force) {
  const local = chrome.runtime.getManifest().version;
  const prev = await chrome.storage.local.get(['updateMeta']);
  const meta = prev.updateMeta || {};
  const now = Date.now();
  if (!force && meta.checkedAt && now - meta.checkedAt < CHECK_HOURS * 3600 * 1000 * 0.5) {
    return meta;
  }

  try {
    const latest = await fetchLatestVersion();
    const hasUpdate = cmpVer(latest.version, local) > 0;
    const next = {
      checkedAt: now,
      localVersion: local,
      latestVersion: latest.version,
      hasUpdate,
      url: latest.url,
      zip: latest.zip,
      error: null,
    };
    await chrome.storage.local.set({ updateMeta: next });
    if (hasUpdate) {
      chrome.action.setBadgeText({ text: '↑' });
      chrome.action.setBadgeBackgroundColor({ color: '#0a84ff' });
      chrome.action.setTitle({ title: `Media Ad Skip · 有新版本 ${latest.version}` });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'Media Ad Skip' });
    }
    return next;
  } catch (e) {
    const next = {
      ...meta,
      checkedAt: now,
      localVersion: local,
      error: String(e && e.message ? e.message : e),
    };
    await chrome.storage.local.set({ updateMeta: next });
    return next;
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const { cfg } = await chrome.storage.sync.get(['cfg']);
    if (details.reason === 'install') {
      if (!cfg || typeof cfg !== 'object') {
        await chrome.storage.sync.set({
          cfg: {
            autoSkip: true,
            showPanel: false,
            showUndoToast: true,
            useSponsorBlock: true,
            useDanmakuDetect: false,
            useCreatorMarks: false,
            douyinInVideo: true,
            douyinFeedAd: true,
            douyinFeedLive: false,
            douyinFeedShop: true,
            biliInVideo: true,
            countdownSec: 3,
            softOralSkipSec: 35,
            feedPollMs: 1400,
            crashSafe131: true,
            feedSwipe1520: true,
            feedSwipe1523: true,
            feedSep1528: true,
            feedLiveOff1529: true,
            feedFast1554: true,
            crashSafe1562: true,
            danmakuOff1568: true,
            creatorOff1569: true,
          },
        });
      }
      chrome.runtime.openOptionsPage();
    } else if (details.reason === 'update' && cfg && typeof cfg === 'object') {
      const next = { ...cfg };
      let dirty = false;
      if (cfg.crashSafe131 !== true) {
        next.crashSafe131 = true;
        dirty = true;
      }
      if (cfg.feedSwipe1520 !== true) {
        next.douyinFeedAd = true;
        next.feedSwipe1520 = true;
        dirty = true;
      }
      if (cfg.feedSwipe1523 !== true) {
        next.douyinFeedShop = true;
        next.feedSwipe1523 = true;
        dirty = true;
      }
      if (cfg.feedSep1528 !== true) {
        next.feedSep1528 = true;
        dirty = true;
      }
      // 1.5.29：默认关直播划走、开广告/带货划走
      if (cfg.feedLiveOff1529 !== true) {
        next.douyinFeedLive = false;
        next.douyinFeedAd = true;
        next.douyinFeedShop = true;
        next.feedLiveOff1529 = true;
        dirty = true;
      }
      // 1.5.54：信息流检测默认加快（旧 1400 体感慢）
      if (cfg.feedFast1554 !== true) {
        const cur = Number(cfg.feedPollMs);
        if (!Number.isFinite(cur) || cur >= 1200) next.feedPollMs = 700;
        next.feedFast1554 = true;
        dirty = true;
      }
      // 1.5.62：Crashpad 连环崩 → 默认轮询回 1400，禁 elementFromPoint
      if (cfg.crashSafe1562 !== true) {
        next.feedPollMs = 1400;
        next.crashSafe1562 = true;
        dirty = true;
      }
      // 1.5.68：弹幕检测默认关（剧透/吐槽误伤）
      if (cfg.danmakuOff1568 !== true) {
        next.useDanmakuDetect = false;
        next.danmakuOff1568 = true;
        dirty = true;
      }
      // 1.5.69：简介自标默认关（多数视频不写恰饭轴）
      if (cfg.creatorOff1569 !== true) {
        next.useCreatorMarks = false;
        next.creatorOff1569 = true;
        dirty = true;
      }
      if (dirty) await chrome.storage.sync.set({ cfg: next });
    }
  } catch { /* ignore */ }

  try {
    await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: CHECK_HOURS * 60 });
    checkForUpdate(true);
  } catch { /* ignore */ }
});

chrome.runtime.onStartup.addListener(() => {
  checkForUpdate(false);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate(false);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'MAS_CHECK_UPDATE') {
    checkForUpdate(!!msg.force).then((meta) => sendResponse({ ok: true, meta })).catch((e) => {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    });
    return true;
  }
  if (msg && msg.type === 'MAS_GET_UPDATE') {
    chrome.storage.local.get(['updateMeta']).then(({ updateMeta }) => {
      sendResponse({ ok: true, meta: updateMeta || null, local: chrome.runtime.getManifest().version });
    });
    return true;
  }
  if (!msg || msg.type !== 'MAS_FETCH' || !msg.url) return false;
  (async () => {
    try {
      const res = await fetch(msg.url, { credentials: 'omit' });
      const text = await res.text();
      if (text.length > MAX_BG_FETCH) {
        sendResponse({ ok: false, error: 'response too large' });
        return;
      }
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (!res.ok) {
        sendResponse({ ok: false, error: `HTTP ${res.status}`, data });
        return;
      }
      sendResponse({ ok: true, data });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});

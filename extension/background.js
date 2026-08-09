/* Media Ad Skip — MV3 service worker */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const { cfg } = await chrome.storage.sync.get(['cfg']);
    if (details.reason === 'install') {
      // 仅首次安装写默认；升级不覆盖用户已改的 showPanel 等项
      if (!cfg || typeof cfg !== 'object') {
        await chrome.storage.sync.set({
          cfg: {
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
            crashSafe131: true,
          },
        });
      }
      chrome.runtime.openOptionsPage();
      return;
    }
    // 1.5.13：默认关掉信息流划走，减轻首页崩溃；用户可在选项再打开
    if (details.reason === 'update' && cfg && typeof cfg === 'object' && cfg.crashSafe131 !== true) {
      await chrome.storage.sync.set({
        cfg: {
          ...cfg,
          douyinFeedAd: false,
          douyinFeedLive: false,
          crashSafe131: true,
        },
      });
    }
  } catch { /* ignore */ }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'MAS_FETCH' || !msg.url) return false;
  (async () => {
    try {
      const res = await fetch(msg.url, { credentials: 'omit' });
      const text = await res.text();
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

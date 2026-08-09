/* Media Ad Skip — MV3 service worker */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      const { cfg } = await chrome.storage.sync.get(['cfg']);
      // 仅首次安装写默认；升级不覆盖用户已改的 showPanel 等项
      if (!cfg || typeof cfg !== 'object') {
        await chrome.storage.sync.set({
          cfg: {
            autoSkip: true,
            showPanel: false,
            showUndoToast: true,
            useSponsorBlock: true,
            douyinInVideo: true,
            douyinFeedAd: true,
            douyinFeedLive: true,
            douyinFeedShop: false,
            biliInVideo: true,
            countdownSec: 3,
            softOralSkipSec: 35,
            feedPollMs: 600,
          },
        });
      }
    } catch { /* ignore */ }
    chrome.runtime.openOptionsPage();
  }
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

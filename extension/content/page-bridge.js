/* 运行在页面主世界：带 Cookie 请求抖音接口（扩展隔离世界 fetch 拿不到登录态） */
(function () {
  if (window.__MAS_PAGE_BRIDGE__) return;
  window.__MAS_PAGE_BRIDGE__ = true;
  const MAX = 600000;
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'mas-content') return;
    if (ev.data.type !== 'MAS_PAGE_FETCH') return;
    const { id, url } = ev.data;
    try {
      const r = await fetch(url, { credentials: 'include' });
      const cl = parseInt(r.headers.get('content-length') || '', 10);
      if (Number.isFinite(cl) && cl > MAX) {
        window.postMessage({ source: 'mas-page-bridge', id, ok: false, error: 'response too large' }, '*');
        return;
      }
      const text = await r.text();
      if ((text || '').length > MAX) {
        window.postMessage({ source: 'mas-page-bridge', id, ok: false, error: 'response too large' }, '*');
        return;
      }
      const trimmed = (text || '').trim();
      let data = text;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { data = JSON.parse(text); } catch { /* keep text */ }
      }
      window.postMessage({ source: 'mas-page-bridge', id, ok: true, data }, '*');
    } catch (e) {
      window.postMessage({
        source: 'mas-page-bridge',
        id,
        ok: false,
        error: String(e && e.message ? e.message : e),
      }, '*');
    }
  });
})();

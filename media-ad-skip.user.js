// ==UserScript==
// @name         Media Ad Skip (B站 + 抖音)
// @namespace    https://github.com/hualeide/media-ad-skip
// @version      1.5.30
// @description  仅在 B站/抖音页面工作：SponsorBlock、字幕品牌词、官方广告看点
// @author       media-ad-skip
// @homepageURL  https://github.com/hualeide/media-ad-skip
// @supportURL   https://github.com/hualeide/media-ad-skip/issues
// @updateURL    https://raw.githubusercontent.com/hualeide/media-ad-skip/master/media-ad-skip.user.js
// @downloadURL  https://raw.githubusercontent.com/hualeide/media-ad-skip/master/media-ad-skip.user.js
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/list/*
// @match        *://www.bilibili.com/watchlater/*
// @match        *://www.bilibili.com/bangumi/*
// @match        *://m.bilibili.com/video/*
// @match        *://www.douyin.com/*
// @match        *://www.iesdouyin.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      bsbsb.top
// @connect      api.bilibili.com
// @connect      comment.bilibili.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  if (window.__MAS_VER__ === '1.5.30') return;
  window.__MAS_VER__ = '1.5.30';

  const HOST = location.hostname;
  const IS_BILI = HOST.includes('bilibili.com');
  const IS_DOUYIN = HOST.includes('douyin.com');
  // 非目标站一律不跑（双重保险；扩展/油猴 match 已限定）
  if (!IS_BILI && !IS_DOUYIN) return;
  window.__MAS_LOADED__ = true;

  const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

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
    douyinFeedLive: false,
    douyinFeedShop: true,
    douyinInVideo: true,
    biliInVideo: true,
    feedPollMs: 700,
    countdownSec: 3,
    softOralSkipSec: 35,
    useSponsorBlock: true,
    showUndoToast: true,
    brandKeywords: DEFAULT_BRAND_KW.slice(),
    blockBvids: [],
    blockMids: [],
  };

  const AD_START = ['广告开始', '开始恰饭', '恰饭开始', '广告来了', '开始推广', '金主来了', '广告时间'];
  const AD_END = ['广告结束', '欢迎回来', '恰饭结束', '回来了', '广告完了', '正片开始', '回归正片'];
  /* 弹幕泛词 + 品牌：见 generalKw() */
  const AD_LABEL = ['广告', 'ad', 'sponsor', '赞助', '商单', '恰饭', '推广'];
  const SKIP_BTN_TEXT = ['跳过广告', '关闭广告', 'Skip Ad', 'Skip Ads'];

  const ZH_NUM = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };

  /** @type {typeof DEFAULTS} */
  let cfg = loadCfg();
  let panelEl = null;
  let statusText = '待命';
  let activeSeg = null; // { start, end, source } 当前优先段
  let activeSegs = []; // 多段（SponsorBlock）
  let skippedKeys = new Set();
  let lastKey = '';
  let lastSkip = null;
  let softOralReady = false;

  function brandList() {
    // null/undefined → 默认；显式 [] 表示用户清空；过短残缺列表 → 补全默认词
    if (!Array.isArray(cfg.brandKeywords)) return DEFAULT_BRAND_KW.slice();
    const cur = cfg.brandKeywords.map((x) => String(x).trim()).filter(Boolean);
    if (!cur.length) return [];
    if (cur.length < Math.ceil(DEFAULT_BRAND_KW.length * 0.5)) {
      const set = new Set(cur);
      for (const k of DEFAULT_BRAND_KW) set.add(k);
      return [...set];
    }
    return cur;
  }

  function generalKw() {
    return ['已买', '购买', '购入', '接广', '广告', '广子', '感谢金主', '商单', '恰饭', '下单', '买买买', ...brandList()];
  }

  function currentVideoId() {
    if (IS_BILI) {
      const m = location.pathname.match(/\/video\/(BV[\w]+)/i);
      return m ? m[1] : null;
    }
    if (IS_DOUYIN) {
      return (typeof getDouyinAwemeId === 'function' ? getDouyinAwemeId() : null)
        || (location.pathname.match(/\/video\/(\d+)/) || [])[1]
        || null;
    }
    return null;
  }

  function isBlockedVideo() {
    const id = currentVideoId();
    if (!id) return false;
    return (cfg.blockBvids || []).map(String).includes(String(id));
  }

  function isBlockedUp(mid) {
    if (mid == null || mid === '') return false;
    return (cfg.blockMids || []).map(String).includes(String(mid));
  }

  async function appendFeedback(entry) {
    const item = {
      at: Date.now(),
      href: location.href,
      videoId: currentVideoId(),
      ...entry,
    };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const { feedbackLog = [] } = await chrome.storage.local.get(['feedbackLog']);
        const next = [...feedbackLog, item].slice(-50);
        await chrome.storage.local.set({ feedbackLog: next });
      } else {
        const raw = localStorage.getItem('mas-feedback') || '[]';
        const arr = JSON.parse(raw);
        arr.push(item);
        localStorage.setItem('mas-feedback', JSON.stringify(arr.slice(-50)));
      }
    } catch (e) {
      log('feedback save fail', e);
    }
    return item;
  }

  async function reportWrongMark() {
    const seg = lastSkip?.seg || activeSeg;
    const item = await appendFeedback({
      reason: 'wrong_skip',
      seg: seg ? { start: seg.start, end: seg.end, source: seg.source } : null,
      fromTime: lastSkip?.fromTime ?? null,
    });
    if (lastSkip) undoLastSkip();
    else if (seg) skippedKeys.add(segKey(seg));
    const text = JSON.stringify(item, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已记录标错并复制到剪贴板');
    } catch {
      setStatus('已记录标错（复制失败，见设置页导出）');
    }
  }

  function blockCurrentVideo(forcedId) {
    const id = forcedId || currentVideoId();
    if (!id) {
      setStatus('无法识别视频 ID');
      return false;
    }
    const set = new Set((cfg.blockBvids || []).map(String));
    set.add(String(id));
    cfg.blockBvids = [...set];
    saveCfg();
    activeSeg = null;
    activeSegs = [];
    skippedKeys = new Set();
    lastSkip = null;
    setStatus('本视频已禁用跳过');
    return true;
  }

  function unblockCurrentVideo(forcedId) {
    const id = forcedId || currentVideoId();
    if (!id) {
      setStatus('无法识别视频 ID');
      return false;
    }
    cfg.blockBvids = (cfg.blockBvids || []).map(String).filter((x) => x !== String(id));
    saveCfg();
    setStatus('已恢复本集跳过');
    return true;
  }

  function isCurrentVideoBlocked() {
    const id = currentVideoId();
    if (!id) return false;
    return (cfg.blockBvids || []).map(String).includes(String(id));
  }

  function undoLastSkip() {
    if (!lastSkip) {
      setStatus('无可撤销跳过');
      return;
    }
    if (seekTo(lastSkip.fromTime)) {
      skippedKeys.delete(lastSkip.key);
      setStatus(`已撤销 → ${formatTime(lastSkip.fromTime)}`);
      lastSkip = null;
      dismissMasToast(document.getElementById('mas-undo-toast'));
    }
  }

  function dismissMasToast(el) {
    if (!el) return;
    clearTimeout(el._hideAnim);
    el.style.display = 'none';
  }

  /** 右下角 toast：纯色、无动画，避免与视频 seek 同帧合成崩溃 */
  function ensureToastStyles() {
    if (document.getElementById('mas-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'mas-toast-style';
    style.textContent = `
      #mas-undo-toast,#mas-skip-toast{
        position:fixed;right:20px;bottom:24px;z-index:2147483646;
        padding:12px 14px;border-radius:12px;
        font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
        color:#f5f5f7;display:none;
        max-width:min(300px,calc(100vw - 40px));
        background:#1c1c1e;border:1px solid #3a3a3c;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
      }
      #mas-undo-toast .mas-toast-title,#mas-skip-toast .mas-toast-title{font-weight:600}
      #mas-undo-toast .mas-toast-sub,#mas-skip-toast .mas-toast-sub{
        margin-top:4px;font-weight:500;font-size:12px;opacity:.78;
      }
      #mas-undo-toast .mas-toast-actions,#mas-skip-toast .mas-toast-actions{
        margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;
      }
      #mas-undo-toast .mas-btn,#mas-skip-toast .mas-btn{
        appearance:none;-webkit-appearance:none;cursor:pointer;border:0;border-radius:8px;
        padding:6px 12px;font:600 12px/1.2 inherit;
      }
      #mas-undo-toast .mas-btn-primary,#mas-skip-toast .mas-btn-primary{background:#0a84ff;color:#fff}
      #mas-undo-toast .mas-btn-ghost,#mas-skip-toast .mas-btn-ghost{
        background:#2c2c2e;color:#f5f5f7;border:1px solid #3a3a3c;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function revealToast(toast) {
    ensureToastStyles();
    toast.style.display = 'block';
  }

  /** 即将跳过（自动跳前 / 手动确认） */
  function showUpcomingToast(seg, opts = {}) {
    if (!seg || cfg.showUndoToast === false) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-undo-toast'));
    let toast = document.getElementById('mas-skip-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-skip-toast';
      document.documentElement.appendChild(toast);
    }
    const range = `${formatTime(seg.start)} → ${formatTime(seg.end)}`;
    const label = seg.label ? ` · ${seg.label}` : '';
    const withActions = !!opts.withActions;
    toast.innerHTML = `<div class="mas-toast-title">即将跳过广告</div>
      <div class="mas-toast-sub">${range}${label}</div>
      ${withActions ? `<div class="mas-toast-actions">
        <button type="button" id="mas-toast-go" class="mas-btn mas-btn-primary">立即跳过</button>
        <button type="button" id="mas-toast-no" class="mas-btn mas-btn-ghost">忽略</button>
      </div>` : ''}`;
    revealToast(toast);
    if (withActions) {
      toast.querySelector('#mas-toast-go').onclick = () => { doSkip(seg, true); dismissMasToast(toast); };
      toast.querySelector('#mas-toast-no').onclick = () => {
        dismissMasToast(toast);
        skippedKeys.add(segKey(seg));
      };
    }
    clearTimeout(showUpcomingToast._t);
    const ms = withActions
      ? Math.max(3, cfg.countdownSec || 3) * 1000
      : 1800;
    showUpcomingToast._t = setTimeout(() => dismissMasToast(toast), ms);
  }

  function showUndoToast() {
    if (!cfg.showUndoToast || !lastSkip) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-skip-toast'));
    let toast = document.getElementById('mas-undo-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-undo-toast';
      document.documentElement.appendChild(toast);
    }
    const end = lastSkip.seg ? formatTime(lastSkip.seg.end) : formatTime(lastSkip.toTime);
    toast.innerHTML = `<div class="mas-toast-title">已跳过广告</div>
      <div class="mas-toast-sub">跳到 ${end}</div>
      <div class="mas-toast-actions">
        <button type="button" id="mas-undo-btn" class="mas-btn mas-btn-primary">撤销</button>
        <button type="button" id="mas-block-btn" class="mas-btn mas-btn-ghost">本集不跳</button>
        <button type="button" id="mas-wrong-btn" class="mas-btn mas-btn-ghost">标错了</button>
      </div>`;
    revealToast(toast);
    toast.querySelector('#mas-undo-btn').onclick = () => undoLastSkip();
    toast.querySelector('#mas-block-btn').onclick = () => {
      blockCurrentVideo();
      dismissMasToast(toast);
    };
    toast.querySelector('#mas-wrong-btn').onclick = () => {
      reportWrongMark();
      dismissMasToast(toast);
    };
    clearTimeout(showUndoToast._t);
    showUndoToast._t = setTimeout(() => dismissMasToast(toast), Math.max(3, cfg.countdownSec || 3) * 1000);
  }

  // -------------------- storage --------------------
  function loadCfg() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue('cfg', null) : localStorage.getItem('mas-cfg');
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...DEFAULTS, ...(parsed || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveCfg() {
    const raw = JSON.stringify(cfg);
    if (typeof GM_setValue === 'function') GM_setValue('cfg', raw);
    else localStorage.setItem('mas-cfg', raw);
  }

  // -------------------- utils --------------------
  function log(...args) {
    console.log('[MAS]', ...args);
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function softSkipSec() {
    const n = Number(cfg.softOralSkipSec);
    return Math.max(15, Math.min(90, Number.isFinite(n) ? n : 35));
  }

  /** 无看点终点时：从当前进度软跳一段（需用户听到口播再点） */
  function softSkipForward() {
    const v = getVideoEl();
    if (!v || !Number.isFinite(v.currentTime)) {
      setStatus('没有可跳的播放器');
      return;
    }
    const from = v.currentTime;
    const sec = softSkipSec();
    const dur = v.duration && Number.isFinite(v.duration) ? v.duration : 0;
    const end = dur > 0 ? Math.min(dur - 0.5, from + sec) : from + sec;
    if (end <= from + 2) {
      setStatus('已接近片尾，无法再跳');
      return;
    }
    const seg = { start: from, end, source: 'soft-oral', label: `约${Math.round(end - from)}s` };
    activeSeg = seg;
    activeSegs = [seg];
    softOralReady = true;
    doSkip(seg, true);
  }

  function showSoftOralHint() {
    if (cfg.showUndoToast === false) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-undo-toast'));
    let toast = document.getElementById('mas-skip-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-skip-toast';
      document.documentElement.appendChild(toast);
    }
    const sec = softSkipSec();
    toast.innerHTML = `<div class="mas-toast-title">口播无时间戳</div>
      <div class="mas-toast-sub">听到广告时点下方，从当前进度跳过约 ${sec} 秒</div>
      <div class="mas-toast-actions">
        <button type="button" id="mas-toast-soft" class="mas-btn mas-btn-primary">跳过约${sec}秒</button>
        <button type="button" id="mas-toast-no" class="mas-btn mas-btn-ghost">关闭</button>
      </div>`;
    revealToast(toast);
    toast.querySelector('#mas-toast-soft').onclick = () => {
      dismissMasToast(toast);
      softSkipForward();
    };
    toast.querySelector('#mas-toast-no').onclick = () => dismissMasToast(toast);
    clearTimeout(showSoftOralHint._t);
    showSoftOralHint._t = setTimeout(() => dismissMasToast(toast), 12000);
  }

  function zhNumToInt(str) {
    if (!str) return 0;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (str === '十') return 10;
    if (str.includes('十')) {
      const [a, b] = str.split('十');
      const tens = a ? ZH_NUM[a] ?? 1 : 1;
      const ones = b ? ZH_NUM[b] ?? 0 : 0;
      return tens * 10 + ones;
    }
    return ZH_NUM[str] ?? 0;
  }

  function convertChineseNumbersToArabic(text) {
    let converted = String(text || '');
    converted = converted.replace(/([一二三四五六七八九])?十([一二三四五六七八九])?/g, (_, tens, ones) => {
      const tensValue = tens ? (ZH_NUM[tens] ?? 1) : 1;
      const onesValue = ones ? (ZH_NUM[ones] ?? 0) : 0;
      return String(tensValue * 10 + onesValue);
    });
    for (const [c, n] of Object.entries(ZH_NUM)) {
      if (c === '十') continue;
      converted = converted.split(c).join(String(n));
    }
    return converted;
  }

  function extractTimeFromText(text) {
    if (!text) return null;
    let t = text.trim();
    if (t.startsWith('[') || t.startsWith('{')) return null;
    if (/发布.{0,4}[分秒钟]|打\s*\d+\s*分|^\d+(\.\d+)?\s*(米|km)/i.test(t)) return null;
    if (/\d+\.\d+.*(更新|版本|预告|我的世界|minecraft)/i.test(t)) return null;
    if (/minecraft|我的世界/i.test(t) && /\d+\.\d+/.test(t)) return null;
    if (/\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日|考古/.test(t)) return null;
    if (/\d{4}\s*[-/,.]\s*\d{1,2}/.test(t)) return null;

    const raw = t;
    t = convertChineseNumbersToArabic(t);

    let m = t.match(/(?:谢谢|感谢|谢|多谢|感恩)?\s*(\d{1,2})\s*分\s*(\d{1,2})\s*(?:郎|君|酱|哥|姐|侠|总|大佬|大神)/);
    if (m) return { time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), conf: 1.5 };

    m = t.match(/(\d{1,2})[:;：；](\d{2})(?!\d)/);
    if (m) {
      const sec = parseInt(m[2], 10);
      if (sec < 60) {
        const time = parseInt(m[1], 10) * 60 + sec;
        const hasJump = /(空降(?!兵)|跳过|快进|广告|恰饭|指路|进度条|mark|标记|正片|指挥部)/i.test(raw + t);
        return { time, conf: hasJump ? 1.25 : 0.35 };
      }
    }

    m = t.match(/(\d{1,3})\s*分\s*半/);
    if (m) return { time: parseInt(m[1], 10) * 60 + 30, conf: 1.15 };

    m = t.match(/(\d{1,3})\s*分\s*(\d{1,2})\s*秒/);
    if (m) return { time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), conf: 1.1 };

    m = t.match(/(\d{1,3})\s*分钟?(?!\s*[半\d])/);
    if (m && /(空降(?!兵)|跳过|快进|广告|恰饭|指路|进度条|跳到|直达)/.test(raw + t)) {
      return { time: parseInt(m[1], 10) * 60, conf: 1.0 };
    }

    m = t.match(/0?(\d{1,2})(\d{2})\s*工程/);
    if (m) {
      const sec = parseInt(m[2], 10);
      if (sec < 60) return { time: parseInt(m[1], 10) * 60 + sec, conf: 1.3 };
    }

    m = t.match(/(?:空降(?!兵)|跳过|快进|指路|进度条|跳到|直达)[^\d]{0,8}(\d{2,4})\s*[秒sS]/);
    if (m) return { time: parseInt(m[1], 10), conf: 1.4 };

    return null;
  }

  function findDenseCluster(times, windowSec, minSize) {
    if (!times || times.length < minSize) return null;
    const sorted = [...times].sort((a, b) => a - b);
    let best = null;
    let i = 0;
    for (let j = 0; j < sorted.length; j++) {
      while (sorted[j] - sorted[i] > windowSec) i++;
      const count = j - i + 1;
      if (count >= minSize && (!best || count > best.count)) {
        best = { count, start: sorted[i], end: sorted[j], center: (sorted[i] + sorted[j]) / 2 };
      }
    }
    return best;
  }

  function validSeg(seg, duration) {
    if (!seg || seg.start == null || seg.end == null) return false;
    const len = seg.end - seg.start;
    if (len < 8 || len > 420) return false;
    if (seg.start < 0) return false;
    // 作者自标允许片头广告
    if (!String(seg.source || '').startsWith('creator') && seg.start < 3) return false;
    if (duration > 0 && seg.end >= duration - 3) return false;
    return true;
  }

  let pendingSkip = null; // { key, target, timer }

  function getActiveFeedRoot() {
    if (!IS_DOUYIN) return null;
    return document.querySelector(
      '[data-e2e="feed-active-video"], .swiper-slide-active',
    );
  }

  /** 桌面版作者/@名/「广告」灰标常在 slide 外层或侧栏，不能只扫 video 根 */
  function getFeedInspectRoots() {
    const roots = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el) || roots.length >= 5) return;
      // 过大容器跳过，避免扫整页
      try {
        if ((el.querySelectorAll?.('div')?.length || 0) > 400) return;
      } catch { /* ignore */ }
      seen.add(el);
      roots.push(el);
    };
    const active = getActiveFeedRoot();
    add(active);
    if (active) {
      add(active.parentElement);
      add(active.closest(
        '[data-e2e="feed-item"], [data-e2e="feed-video"], [class*="feed-item"],'
        + '[class*="FeedItem"], [class*="sliderItem"], [class*="swiper-slide"], article, li',
      ));
    }
    // 当前屏常见作者/文案区（与 video 兄弟）
    document.querySelectorAll(
      '[data-e2e="video-author"], [data-e2e="video-author-name"], [data-e2e="video-desc"],'
      + '[data-e2e="user-info"], [data-e2e="feed-video-desc"]',
    ).forEach((el) => {
      if (roots.length >= 5) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      add(el);
      add(el.parentElement);
    });
    return roots;
  }

  function getVideoEl() {
    const root = getActiveFeedRoot();
    if (root) {
      const v = root.querySelector('video, bwp-video');
      if (v) return v;
    }
    if (/\/video\//.test(location.pathname)) {
      const main = document.querySelector(
        '[data-e2e="feed-active-video"] video, .xgplayer video, video, bwp-video',
      );
      if (main) return main;
    }
    return document.querySelector('video, bwp-video');
  }

  /** 轻量 seek：只改 currentTime，禁止全页 query + 禁止狂点进度条 */
  function seekTo(sec) {
    const v = getVideoEl();
    if (!v) return false;
    const target = Math.max(0, sec);
    try {
      if (Math.abs((v.currentTime || 0) - target) < 0.35) return true;
      v.currentTime = target;
      if (IS_DOUYIN) {
        setTimeout(() => {
          const v2 = getVideoEl();
          if (v2 && Math.abs(v2.currentTime - target) > 1.5) {
            try { v2.currentTime = target; } catch { /* ignore */ }
          }
        }, 300);
        setTimeout(() => {
          const v2 = getVideoEl();
          if (v2 && Math.abs(v2.currentTime - target) > 1.5) {
            try { v2.currentTime = target; } catch { /* ignore */ }
          }
        }, 750);
      }
      return true;
    } catch {
      return false;
    }
  }

  function seekCloseEnough(target, slack = 2.5) {
    const v = getVideoEl();
    return !!(v && Number.isFinite(v.currentTime) && Math.abs(v.currentTime - target) <= slack);
  }

  // 品牌词见 brandList()
  const AD_CONTENT_KW = [
    '赞助', '冠名', '推广', '合作', '商单', '评论区', '蓝链', '二维码', '口令',
    '领取', '领券', '优惠券', '优惠码', '兑换码', '下单', '购买', '入手', '抢购',
    '限时', '福利', '首充', '种草', '安利', '应用商店',
  ];

  function detectFromSubtitles(lines, danmaku, duration) {
    if (!lines || lines.length < 5) return null;
    const hits = [];
    for (const line of lines) {
      const text = String(line.content || '');
      const lower = text.toLowerCase();
      const brands = brandList().filter((k) => text.includes(k) || lower.includes(k.toLowerCase()));
      const matched = AD_CONTENT_KW.filter((k) => lower.includes(k.toLowerCase()) || text.includes(k));
      if (!brands.length && !matched.length) continue;
      hits.push({
        from: line.from,
        to: line.to,
        matched,
        brands,
        weight: brands.length ? 2 + brands.length : 1,
      });
    }
    if (!hits.length) return null;

    const hasBrand = hits.some((h) => h.brands.length);
    if (hits.length < 2 && !hasBrand) return null;

    const MAX_WIN = 120;
    let bestWeight = 0;
    let bestStart = -1;
    let bestEnd = -1;
    let i = 0;
    for (let j = 0; j < hits.length; j++) {
      while (hits[j].from - hits[i].from > MAX_WIN) i++;
      let w = 0;
      for (let k = i; k <= j; k++) w += hits[k].weight;
      if (w > bestWeight) {
        bestWeight = w;
        bestStart = hits[i].from;
        bestEnd = hits[j].to;
      }
    }
    if (bestWeight >= 2 && bestEnd > bestStart) {
      if (hasBrand) {
        bestStart = Math.max(0, bestStart - 8);
        const padEnd = bestEnd + 45;
        bestEnd = duration > 0 ? Math.min(duration - 3.1, padEnd) : padEnd;
      }
      const seg = {
        start: bestStart,
        end: bestEnd,
        source: hasBrand ? 'subtitle-brand' : 'subtitle',
      };
      return validSeg(seg, duration) ? seg : null;
    }

    // CTA / 品牌强信号
    const strong = hits.find((h) => h.brands.length || h.matched.length >= 2);
    if (strong) {
      let start = Math.max(0, strong.to - 60);
      if (danmaku?.length) {
        const win = danmaku.filter((d) => d.time >= strong.to - 120 && d.time <= strong.to);
        for (const d of win) {
          if (AD_START.some((k) => d.text.includes(k)) || generalKw().some((k) => d.text.includes(k))) {
            start = Math.min(start, d.time);
          }
        }
      }
      let end = strong.to;
      if (strong.brands.length) {
        start = Math.max(0, strong.from - 8);
        end = duration > 0 ? Math.min(duration - 3.1, strong.to + 45) : strong.to + 45;
      }
      const seg = {
        start,
        end,
        source: strong.brands.length ? 'subtitle-brand' : 'subtitle-cta',
      };
      return validSeg(seg, duration) ? seg : null;
    }
    return null;
  }

  function skipIfPlayingInSegs() {
    const v = getVideoEl();
    if (!v || !Number.isFinite(v.currentTime)) return false;
    const t = v.currentTime;
    const pool = activeSegs.length ? activeSegs : (activeSeg ? [activeSeg] : []);
    for (const seg of pool) {
      if (skippedKeys.has(segKey(seg))) continue;
      if (t >= seg.start - 0.6 && t < seg.end - 0.4) {
        doSkip(seg, true);
        return true;
      }
    }
    return false;
  }

  function setStatus(text) {
    statusText = text;
    const el = document.getElementById('mas-status');
    if (el) el.textContent = text;
  }

  function hidePanel() {
    if (!panelEl) return;
    panelEl.remove();
    panelEl = null;
  }

  function resetPlaybackState() {
    lastKey = '';
    activeSeg = null;
    activeSegs = [];
    skippedKeys = new Set();
    lastSkip = null;
    softOralReady = false;
    dismissMasToast(document.getElementById('mas-undo-toast'));
    dismissMasToast(document.getElementById('mas-skip-toast'));
  }

  // -------------------- time-text clustering (shared) --------------------
  /**
   * 从文本列表里找「跳到某时刻」的共识终点，再估广告段。
   * @param {{time?:number,text:string}[]} items  time=弹幕出现时刻；评论可无 time
   * @param {number} duration
   */
  function detectFromJumpTexts(items, duration) {
    const votes = new Map(); // endSec -> score
    const pairs = [];

    for (const it of items) {
      const info = extractTimeFromText(it.text);
      if (!info) continue;
      const end = Math.round(info.time);
      if (end <= 0 || (duration > 0 && end >= duration - 5)) continue;

      let score = info.conf;
      if (/(空降|跳过|快进|广告|恰饭|指路)/.test(it.text)) score += 0.8;
      votes.set(end, (votes.get(end) || 0) + score);

      if (typeof it.time === 'number' && !Number.isNaN(it.time)) {
        pairs.push({ start: it.time, end, score });
      }
    }

    if (votes.size === 0) return null;

    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [bestEnd, bestScore] = ranked[0];
    if (bestScore < 1.8) return null;

    // 用弹幕出现时刻估广告起点；否则默认 end-60
    let start = Math.max(0, bestEnd - 60);
    const related = pairs.filter((p) => Math.abs(p.end - bestEnd) <= 2 && p.end - p.start >= 20);
    if (related.length) {
      related.sort((a, b) => a.start - b.start);
      start = related[0].start + 2;
    }

    const seg = { start, end: bestEnd, source: 'timestamp' };
    return validSeg(seg, duration) ? seg : null;
  }

  function detectFromKeywords(items, duration) {
    const starts = [];
    const ends = [];
    const generals = [];

    for (const it of items) {
      const t = (it.text || '').trim();
      const time = typeof it.time === 'number' ? it.time : null;
      if (time == null) continue;
      if (AD_START.some((k) => t.includes(k))) starts.push(time);
      if (AD_END.some((k) => t.includes(k))) ends.push(time);
      if (generalKw().some((k) => t.includes(k))) generals.push(time);
    }

    const sc = findDenseCluster(starts, 20, 2);
    const ec = findDenseCluster(ends, 20, 2);
    if (sc && ec && ec.center > sc.center) {
      const seg = { start: sc.start, end: ec.end, source: 'keyword' };
      if (validSeg(seg, duration)) return seg;
    }

    const gc = findDenseCluster(generals, 90, 3);
    if (gc && gc.end - gc.start >= 20) {
      const seg = { start: Math.max(0, gc.start - 3), end: gc.end, source: 'keyword-general' };
      if (validSeg(seg, duration)) return seg;
    }
    return null;
  }

  // -------------------- UI --------------------
  function ensurePanel() {
    if (!cfg.showPanel || panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'mas-panel';
    panelEl.innerHTML = `
      <div class="mas-head">
        <strong>Ad Skip</strong>
        <button type="button" id="mas-toggle" title="折叠">▾</button>
      </div>
      <div class="mas-body">
        <div id="mas-status">${statusText}</div>
        <label><input type="checkbox" data-k="autoSkip"> 自动跳过</label>
        <label><input type="checkbox" data-k="${IS_BILI ? 'biliInVideo' : 'douyinInVideo'}"> 片内广告</label>
        ${IS_DOUYIN ? `
          <label><input type="checkbox" data-k="douyinFeedAd"> 信息流广告</label>
          <label><input type="checkbox" data-k="douyinFeedLive"> 跳过直播卡</label>
          <label><input type="checkbox" data-k="douyinFeedShop"> 跳过购物卡</label>
        ` : ''}
        <button type="button" id="mas-skip-now" class="mas-btn mas-btn-primary">立即跳过</button>
        <button type="button" id="mas-reanalyze" class="mas-btn mas-btn-ghost">重新分析</button>
        <button type="button" id="mas-undo" class="mas-btn mas-btn-ghost">撤销跳过</button>
        <button type="button" id="mas-block" class="mas-btn mas-btn-ghost">本集不跳</button>
        <button type="button" id="mas-wrong" class="mas-btn mas-btn-ghost">标错了</button>
      </div>
    `;
    const style = document.createElement('style');
    // 不用 backdrop-filter：盖在抖音/B站视频上会触发 Chrome 渲染崩溃
    style.textContent = `
      #mas-panel{
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        color:#f5f5f7;
        background:#1c1c1e;
        border:1px solid #3a3a3c;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
        letter-spacing:-0.01em;
        position:fixed;right:16px;top:96px;z-index:2147483646;
        width:212px;font-size:12px;line-height:1.4;
        border-radius:12px;user-select:none;overflow:hidden;
      }
      #mas-panel .mas-head{
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 12px;border-bottom:1px solid #3a3a3c;cursor:move;
        font-weight:600;font-size:13px;
      }
      #mas-panel .mas-body{padding:10px 12px;display:flex;flex-direction:column;gap:7px}
      #mas-panel.collapsed .mas-body{display:none}
      #mas-panel label{display:flex;gap:6px;align-items:center;opacity:.95}
      #mas-panel #mas-status{opacity:.78;min-height:1.2em;word-break:break-all;font-weight:400}
      #mas-panel .mas-btn{
        appearance:none;-webkit-appearance:none;cursor:pointer;
        border:0;border-radius:8px;padding:6px 12px;font:600 12px/1.2 inherit;
      }
      #mas-panel .mas-btn-primary{background:#0a84ff;color:#fff}
      #mas-panel .mas-btn-ghost{
        background:#2c2c2e;color:#f5f5f7;border:1px solid #3a3a3c;
      }
      #mas-panel button#mas-toggle{
        background:transparent;border:0;padding:2px 6px;color:#f5f5f7;cursor:pointer;border-radius:8px;
      }
      @media (prefers-reduced-motion: reduce){
        #mas-panel .mas-btn{transition:none}
      }
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(panelEl);

    panelEl.querySelectorAll('input[data-k]').forEach((input) => {
      const k = input.getAttribute('data-k');
      input.checked = !!cfg[k];
      input.addEventListener('change', () => {
        cfg[k] = input.checked;
        saveCfg();
        setStatus(`已更新: ${k}`);
      });
    });

    panelEl.querySelector('#mas-toggle').addEventListener('click', () => {
      panelEl.classList.toggle('collapsed');
    });
    panelEl.querySelector('#mas-skip-now').addEventListener('click', () => {
      if (activeSeg) doSkip(activeSeg, true);
      else if (softOralReady) softSkipForward();
      else setStatus(statusText.includes('分析') ? '还在分析，稍后再点' : '暂无跳点（本片未识别到广告段）');
    });
    panelEl.querySelector('#mas-reanalyze')?.addEventListener('click', () => {
      resetPlaybackState();
      if (IS_BILI) runBilibili();
      else douyinAnalyzeInVideo();
    });
    panelEl.querySelector('#mas-undo')?.addEventListener('click', () => undoLastSkip());
    panelEl.querySelector('#mas-block')?.addEventListener('click', () => blockCurrentVideo());
    panelEl.querySelector('#mas-wrong')?.addEventListener('click', () => { reportWrongMark(); });

    // 简易拖拽
    const head = panelEl.querySelector('.mas-head');
    let dragging = false;
    let ox = 0;
    let oy = 0;
    head.addEventListener('mousedown', (e) => {
      dragging = true;
      const r = panelEl.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panelEl.style.left = `${Math.max(0, e.clientX - ox)}px`;
      panelEl.style.top = `${Math.max(0, e.clientY - oy)}px`;
      panelEl.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function showSkipToast(seg) {
    showUpcomingToast(seg, { withActions: true });
  }

  function segKey(seg) {
    return `${Math.round(seg.start)}-${Math.round(seg.end)}`;
  }

  function doSkip(seg, force) {
    if (!seg) return;
    const key = segKey(seg);
    if (!force && skippedKeys.has(key)) return;
    if (force) skippedKeys.delete(key);
    if (pendingSkip?.key === key) {
      seekTo(pendingSkip.target);
      return;
    }
    // 换段前清掉上一次确认轮询，避免定时器叠多层
    if (pendingSkip?.timer) {
      clearInterval(pendingSkip.timer);
      pendingSkip = null;
    }
    const v = getVideoEl();
    const fromTime = v ? v.currentTime : seg.start;
    const target = seg.end + 0.3;
    // 先 seek，绝不与 toast 同帧；自动跳不弹「即将跳过」
    seekTo(target);
    log('skip try', seg, '→', target);

    const commit = () => {
      skippedKeys.add(key);
      lastSkip = { fromTime, toTime: target, key, seg };
      setStatus(`已跳过 → ${formatTime(seg.end)} (${seg.source || ''})`);
      clearTimeout(doSkip._toastT);
      doSkip._toastT = setTimeout(() => showUndoToast(), 450);
    };

    if (!IS_DOUYIN) {
      commit();
      return;
    }

    setStatus(`正在跳到 ${formatTime(target)}…`);
    let tries = 0;
    if (pendingSkip?.timer) clearInterval(pendingSkip.timer);
    const timer = setInterval(() => {
      tries += 1;
      if (seekCloseEnough(target)) {
        clearInterval(timer);
        pendingSkip = null;
        commit();
        return;
      }
      if (tries <= 2) seekTo(target);
      if (tries >= 3) {
        clearInterval(timer);
        pendingSkip = null;
        if (seekCloseEnough(target, 3)) commit();
        else {
          const now = getVideoEl()?.currentTime;
          setStatus(`跳转未生效（仍在 ${formatTime(now || 0)}）`);
        }
      }
    }, 450);
    pendingSkip = { key, target, timer };
  }

  function watchPlayback() {
    const tick = () => {
      const v = getVideoEl();
      if (!v) return;
      const t = v.currentTime;
      const pool = activeSegs.length ? activeSegs : (activeSeg ? [activeSeg] : []);
      for (const seg of pool) {
        const key = segKey(seg);
        if (skippedKeys.has(key) || pendingSkip?.key === key) continue;
        if (t >= seg.start - 0.4 && t < seg.end - 1) {
          activeSeg = seg;
          if (cfg.autoSkip) doSkip(seg, false);
          else showSkipToast(seg);
          break;
        }
      }
    };
    setInterval(tick, 400);
  }

  // ==================== Bilibili ====================
  async function biliFetchJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    return res.json();
  }

  async function biliGetVideoMeta() {
    const m = location.pathname.match(/\/video\/(BV[\w]+)/i);
    const bvid = m ? m[1] : (window.__INITIAL_STATE__?.bvid || null);
    if (!bvid) return null;
    const json = await biliFetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const page = d.pages?.[0];
    return {
      bvid,
      cid: page?.cid || d.cid,
      mid: d.owner?.mid ?? d.owner_mid ?? null,
      desc: d.desc || '',
      duration: d.duration || 0,
      title: d.title || '',
    };
  }

  async function biliFetchDanmaku(cid, duration) {
    // 优先 XML（兼容性好）
    try {
      const res = await fetch(`https://comment.bilibili.com/${cid}.xml`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const list = Array.from(doc.getElementsByTagName('d')).map((d) => ({
        time: parseFloat((d.getAttribute('p') || '0').split(',')[0]),
        text: d.textContent || '',
      }));
      if (list.length) return list;
    } catch (e) {
      log('xml danmaku fail', e);
    }

    // protobuf 分段兜底
    try {
      const segs = Math.max(1, Math.ceil((duration || 600) / 360));
      const all = [];
      for (let i = 1; i <= segs; i++) {
        const res = await fetch(`https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${i}`);
        if (!res.ok) continue;
        all.push(...decodeDanmakuProto(await res.arrayBuffer()));
      }
      return all;
    } catch (e) {
      log('proto danmaku fail', e);
      return [];
    }
  }

  function decodeDanmakuProto(buffer) {
    const view = new DataView(buffer);
    const results = [];
    let offset = 0;

    function readVarint() {
      let result = 0;
      let shift = 0;
      while (offset < view.byteLength) {
        const byte = view.getUint8(offset++);
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return result;
        shift += 7;
      }
      return result;
    }

    function readBytes() {
      const len = readVarint();
      const bytes = new Uint8Array(buffer, offset, len);
      offset += len;
      return bytes;
    }

    function decodeElem(elemBuffer) {
      const elem = { progress: 0, content: '' };
      const elemView = new DataView(elemBuffer.buffer, elemBuffer.byteOffset, elemBuffer.byteLength);
      let pos = 0;
      const readEV = () => {
        let result = 0;
        let shift = 0;
        while (pos < elemBuffer.byteLength) {
          const byte = elemView.getUint8(pos++);
          result |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) return result;
          shift += 7;
        }
        return result;
      };
      while (pos < elemBuffer.byteLength) {
        const tag = readEV();
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x7;
        if (wireType === 0) {
          const val = readEV();
          if (fieldNum === 2) elem.progress = val;
        } else if (wireType === 2) {
          const len = readEV();
          if (fieldNum === 7) {
            elem.content = new TextDecoder().decode(
              new Uint8Array(elemBuffer.buffer, elemBuffer.byteOffset + pos, len),
            );
          }
          pos += len;
        } else if (wireType === 5) pos += 4;
        else if (wireType === 1) pos += 8;
        else break;
      }
      return elem;
    }

    while (offset < view.byteLength) {
      const tag = readVarint();
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        const bytes = readBytes();
        if (fieldNum === 1) {
          const elem = decodeElem(bytes);
          if (elem.content) results.push({ time: elem.progress / 1000, text: elem.content });
        }
      } else if (wireType === 0) readVarint();
      else if (wireType === 5) offset += 4;
      else if (wireType === 1) offset += 8;
      else break;
    }
    return results;
  }

  async function biliFetchPlayer(bvid, cid) {
    try {
      const json = await biliFetchJson(
        `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`,
      );
      return {
        viewPoints: json?.data?.view_points || [],
        subtitles: json?.data?.subtitle?.subtitles || [],
      };
    } catch {
      return { viewPoints: [], subtitles: [] };
    }
  }

  async function biliFetchSubtitleBody(subtitleUrl) {
    try {
      const url = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl;
      const res = await fetch(url);
      const json = await res.json();
      return json.body || [];
    } catch (e) {
      log('subtitle fetch fail', e);
      return [];
    }
  }

  function detectFromChapters(viewPoints) {
    for (const ch of viewPoints || []) {
      const label = String(ch.content || '').toLowerCase();
      if (AD_LABEL.some((k) => label.includes(k))) {
        return { start: ch.from, end: ch.to, source: 'chapter' };
      }
    }
    return null;
  }

  function detectFromDesc(desc, duration) {
    return detectFromCreatorMarks(desc, duration);
  }

  /**
   * 作者自标：简介/标题/置顶评论里的恰饭时间轴
   * 例：
   *  0:00 广告 / 1:20 正片
   *  广告 0:00-1:30
   *  恰饭到 2:15
   *  【赞助】1:00~2:00
   */
  function detectFromCreatorMarks(text, duration) {
    if (!text) return null;
    const raw = String(text);
    const AD = /(广告|恰饭|赞助|商单|推广|软广|合作方|金主|片头广告)/i;
    const OK = /(正片|正文|开始|开讲|上车|回归|谢谢收看)/i;

    // 区间：广告 1:00-2:30 / 1:00~2:30 恰饭 / 【广告】0:00—1:20
    let m = raw.match(/(?:广告|恰饭|赞助|商单|推广|软广)[^0-9]{0,12}(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})/i)
      || raw.match(/(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})[^\n]{0,12}(?:广告|恰饭|赞助|商单|推广)/i);
    if (m) {
      const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      const seg = { start, end, source: 'creator-range' };
      if (validSeg(seg, duration) || (end > start && end - start >= 8)) return seg;
    }

    // 结束点：恰饭到 2:15 / 广告结束 1:30 / 正片 2:00起
    m = raw.match(/(?:广告|恰饭|赞助|商单)[^0-9]{0,8}(?:到|至|结束(?:于|在)?|完(?:于|在)?)[^0-9]{0,6}(\d{1,2})[:：](\d{2})/i)
      || raw.match(/(?:正片|正文)[^0-9]{0,6}(?:从|自|开始|起)?[^0-9]{0,4}(\d{1,2})[:：](\d{2})/i);
    if (m) {
      const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const start = Math.max(0, end - Math.min(90, Math.floor(end * 0.8) || 60));
      const seg = { start: start < 5 && end > 20 ? 0.1 : start, end, source: 'creator-end' };
      if (end - start >= 8 && end < (duration || 99999) - 3) return seg;
    }

    // 时间轴列表
    const entries = [];
    const re = /(?:^|\n)\s*(?:[【\[]?(?:广告|恰饭|赞助)?[】\]]?)?\s*(\d{1,2})[:：](\d{2})(?:\s*[-~—～]\s*(\d{1,2})[:：](\d{2}))?\s*[【\[]?(.*?)[】\]]?(?=\n|$)/g;
    let mm;
    while ((mm = re.exec(raw)) !== null) {
      const start = parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10);
      const end = mm[3] != null
        ? parseInt(mm[3], 10) * 60 + parseInt(mm[4], 10)
        : null;
      entries.push({ start, end, label: (mm[5] || '').trim() });
    }
    // 同行内联：0:00 广告  1:20 正片
    if (entries.length < 2) {
      const inline = [...raw.matchAll(/(\d{1,2})[:：](\d{2})\s*([^\d\n]{1,16})/g)];
      for (const it of inline) {
        entries.push({
          start: parseInt(it[1], 10) * 60 + parseInt(it[2], 10),
          end: null,
          label: it[3].trim(),
        });
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const label = entries[i].label.toLowerCase();
      const isAd = AD.test(label) || AD_LABEL.some((k) => label.includes(k));
      if (!isAd && !(i === 0 && AD.test(raw.slice(0, 80)) && entries[i].start <= 5)) continue;

      let start = entries[i].start;
      let end = entries[i].end;
      if (end == null) {
        if (i + 1 < entries.length) end = entries[i + 1].start;
        else end = Math.min(duration || start + 90, start + 90);
      }
      // 若下一段标正片，用其起点作 end
      if (i + 1 < entries.length && OK.test(entries[i + 1].label)) {
        end = entries[i + 1].start;
      }
      const seg = { start, end, source: 'creator-timeline' };
      if (end > start && end - start >= 8) return seg;
    }
    return null;
  }

  function gmFetchJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          onload: (res) => {
            try { resolve(JSON.parse(res.responseText)); }
            catch (e) { reject(e); }
          },
          onerror: reject,
        });
      } else {
        fetch(url).then((r) => r.json()).then(resolve).catch(reject);
      }
    });
  }

  async function fetchSponsorBlock(bvid) {
    try {
      if (cfg.useSponsorBlock === false) return [];
      const url = `https://bsbsb.top/api/skipSegments?videoID=${encodeURIComponent(bvid)}&categories=${encodeURIComponent(JSON.stringify(['sponsor']))}`;
      const data = await gmFetchJson(url);
      if (!Array.isArray(data)) return [];
      // votes：镜像库常见 0；仅丢掉明显差评（官方客户端约 > -2）
      return data
        .filter((s) => s.actionType === 'skip' && s.category === 'sponsor' && (s.votes ?? 0) > -2)
        .map((s) => ({
          start: s.segment[0],
          end: s.segment[1],
          source: 'sponsorblock',
          votes: s.votes ?? 0,
        }))
        .filter((s) => s.end - s.start >= 5 && s.end - s.start <= 420)
        .sort((a, b) => a.start - b.start);
    } catch (e) {
      log('sponsorblock fail', e);
      return [];
    }
  }

  async function runBilibili(forceKey) {
    if (isBlockedVideo()) {
      setStatus('本视频已禁用');
      activeSeg = null;
      activeSegs = [];
      return;
    }
    if (!cfg.biliInVideo) {
      setStatus('片内检测已关闭');
      return;
    }
    setStatus('分析中…');
    const meta = await biliGetVideoMeta();
    if (!meta?.cid) {
      setStatus('未获取到视频信息');
      return;
    }
    if (isBlockedUp(meta.mid)) {
      setStatus(`该 UP 已禁用 (mid ${meta.mid})`);
      activeSeg = null;
      activeSegs = [];
      return;
    }
    const key = forceKey || `${meta.bvid}:${meta.cid}`;
    if (key === lastKey && (activeSeg || activeSegs.length)) {
      setStatus(`跳点就绪 ${activeSegs.length || 1} 段`);
      return;
    }
    lastKey = key;
    skippedKeys = new Set();
    activeSeg = null;
    activeSegs = [];

    const [danmaku, player, sbSegs] = await Promise.all([
      biliFetchDanmaku(meta.cid, meta.duration),
      biliFetchPlayer(meta.bvid, meta.cid),
      fetchSponsorBlock(meta.bvid),
    ]);
    const { viewPoints, subtitles } = player;
    log('bili', meta.bvid, 'dm', danmaku.length, 'sb', sbSegs.length);

    if (sbSegs.length) {
      activeSegs = sbSegs;
      activeSeg = sbSegs[0];
      setStatus(`SB ${sbSegs.length} 段 · 首段 ${formatTime(activeSeg.start)}→${formatTime(activeSeg.end)}`);
      if (!cfg.autoSkip) showSkipToast(activeSeg);
      return;
    }

    let subtitleLines = [];
    if (subtitles.length) {
      const zh = subtitles.find((s) => s.lan === 'zh-CN' || s.lan === 'ai-zh') || subtitles[0];
      subtitleLines = await biliFetchSubtitleBody(zh.subtitle_url);
    }

    const pipeline = [
      () => detectFromChapters(viewPoints),
      () => detectFromDesc(meta.desc, meta.duration),
      () => detectFromSubtitles(subtitleLines, danmaku, meta.duration),
      () => detectFromJumpTexts(danmaku, meta.duration),
      () => detectFromKeywords(danmaku, meta.duration),
    ];

    for (const step of pipeline) {
      const seg = await step();
      if (seg && validSeg(seg, meta.duration)) {
        activeSeg = seg;
        activeSegs = [seg];
        setStatus(`跳点 ${formatTime(seg.start)}→${formatTime(seg.end)} · ${seg.source}`);
        if (!cfg.autoSkip) showSkipToast(seg);
        return;
      }
    }
    setStatus('未发现广告段');
  }

  // ==================== Douyin ====================
  function clickIfVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    el.click();
    return true;
  }

  function findClickableByText(texts) {
    // 绝不扫 document：抖音全页 button 数量巨大，广告 UI 出现时尤甚
    const root = document.querySelector('.xgplayer')
      || document.querySelector('[data-e2e="feed-active-video"]')
      || document.querySelector('xg-controls, .xgplayer-controls');
    if (!root) return null;
    const nodes = root.querySelectorAll('button, [role="button"]');
    const max = Math.min(nodes.length, 60);
    for (let i = 0; i < max; i += 1) {
      const el = nodes[i];
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 16) continue;
      if (texts.some((x) => t === x || t.includes(x))) return el;
    }
    return null;
  }

  /** 抖音推荐流：下一则 → ArrowDown + 正向滚轮（ArrowUp 会回到上一条，以实测为准） */
  function pressFeedNextKey() {
    const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
    const v = getVideoEl();
    const root = getActiveFeedRoot() || v || document.body;
    for (const t of [root, document, window]) {
      try {
        t.dispatchEvent(new KeyboardEvent('keydown', opts));
        t.dispatchEvent(new KeyboardEvent('keyup', opts));
      } catch { /* ignore */ }
    }
  }

  /** 信息流下一则：优先官方按钮，再键盘 + 滚轮（滚轮打在 video 上，避免点到头像进直播） */
  function swipeToNextFeed() {
    const nextBtn = document.querySelector(
      '[data-e2e="video-switch-next-arrow"], [data-e2e="feed-scroll-down"],'
      + '[data-e2e="arrow-right"], [data-e2e="video-switch-button-down"],'
      + '.xgplayer-playswitch-next, button[aria-label*="下"], button[title*="下"]',
    );
    if (nextBtn) {
      try { nextBtn.click(); } catch { /* ignore */ }
    }
    pressFeedNextKey();
    try {
      const v = getVideoEl();
      const root = getActiveFeedRoot();
      const target = v || root;
      if (target) {
        const midX = Math.floor(window.innerWidth / 2);
        const midY = Math.floor(window.innerHeight / 2);
        // 正 deltaY = 滚轮向下 = 下一条（与 ArrowDown 一致）
        const wheel = { deltaY: 900, deltaMode: 0, bubbles: true, cancelable: true, clientX: midX, clientY: midY };
        target.dispatchEvent(new WheelEvent('wheel', wheel));
      }
    } catch { /* ignore */ }
  }

  /** 有预算地摘文本，避免整卡 textContent/innerText 拖垮抖音页 */
  function lightText(root, maxLen = 400, maxNodes = 36) {
    if (!root) return '';
    let out = '';
    let n = 0;
    try {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = tw.nextNode()) && out.length < maxLen && n < maxNodes) {
        n += 1;
        const t = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        out += `${t}\n`;
      }
    } catch {
      return '';
    }
    return out.slice(0, maxLen);
  }

  function douyinCurrentCardText() {
    const root = getActiveFeedRoot() || (() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el?.closest(
        '[data-e2e="feed-active-video"], [data-e2e="feed-item"], .swiper-slide-active, article, li',
      ) || null;
    })();
    if (!root) return '';
    return lightText(root, 480, 40);
  }

  function isNearAvatarOrFollow(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      '[data-e2e*="avatar"], [data-e2e*="Avatar"], [data-e2e*="follow"],'
      + '[class*="avatar"], [class*="Avatar"], [class*="follow"], [class*="Follow"],'
      + 'a[href*="/user/"]',
    );
  }

  /** 真·直播间/直播预览卡，不是作者头像上单独的「直播」粉标 */
  function isStrongLiveRoomText(text) {
    const t = String(text || '');
    if (!t) return false;
    // 「点击或按 F 进入直播间」等（勿要求「点击」紧贴「进入」）
    if (/进入直播间|点击进入直播|去直播间看|观看直播|按\s*F\s*进入/.test(t)) return true;
    // 推荐流直播预览倒计时条
    if (/\d+\s*s?\s*后将进入下一个视频|后将进入下一个视频/.test(t)) return true;
    return false;
  }

  function looksLikeLiveBadgeText(t) {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s === '直播中' || s === '直播' || /^LIVE$/i.test(s);
  }

  /** 看角标/短标签，比整卡文本更稳 */
  function looksLikeAdBadgeText(t) {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 12) return false;
    if (s === '广告' || s === '广告.' || s === '广告。') return true;
    if (/^广告$/.test(s)) return true;
    // 「广告」夹在短标里：如「广告 ·」「AD」「推广」
    if (/^(广告|AD|Ad|推广|赞助)$/i.test(s)) return true;
    if (s.length <= 6 && /广告/.test(s) && !/直播|关注|点赞|评论|分享/.test(s)) return true;
    return false;
  }

  function inspectActiveFeedCard() {
    const roots = getFeedInspectRoots();
    const out = { ad: false, live: false, shop: false, text: '' };
    if (!roots.length) {
      const fallback = document.querySelector('[data-e2e="feed-active-video"], .swiper-slide-active');
      if (fallback) roots.push(fallback);
    }
    if (!roots.length) return out;

    const bits = [];
    let sawLiveBadge = false;
    let sawLiveCta = false;
    for (const root of roots) {
      bits.push(lightText(root, 320, 56));
      if (root.querySelector(
        '[class*="ad-tag"], [class*="AdTag"], [class*="advert"], [class*="Advert"],'
        + '[data-e2e*="ad"], [data-e2e*="Ad"], [class*="isAd"], [class*="is-ad"],'
        + '[class*="adLabel"], [class*="AdLabel"], [class*="ad-label"]',
      )) out.ad = true;
      // 商品卡 / 锚点购物组件
      if (root.querySelector(
        '[class*="commerce"], [class*="Commerce"], [class*="shop-card"], [class*="ShopCard"],'
        + '[class*="product"], [class*="Product"], [data-e2e*="shop"], [data-e2e*="goods"],'
        + '[class*="anchor"], [class*="Anchor"]',
      )) {
        if (/查看详情|购物|购买|专卖|旗舰|商品|到手价|券后/.test(bits[bits.length - 1] || '')) {
          out.shop = true;
        }
      }

      const nodes = root.querySelectorAll(
        'span, a, p, div, label, i, button, em, strong, h1, h2, h3',
      );
      const max = Math.min(nodes.length, 160);
      for (let i = 0; i < max; i += 1) {
        const el = nodes[i];
        if ((el.children?.length || 0) > 5) continue;
        const aria = String(el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').trim();
        if (looksLikeAdBadgeText(aria)) out.ad = true;
        if (isStrongLiveRoomText(aria)) {
          sawLiveCta = true;
          out.live = true;
        }
        const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 40) continue;
        if (looksLikeAdBadgeText(t)) out.ad = true;
        if (looksLikeLiveBadgeText(t)) sawLiveBadge = true;
        // 进房 CTA：即使靠近头像区也算直播卡（底部「进入直播间」不是粉标）
        if (isStrongLiveRoomText(t)) {
          sawLiveCta = true;
          out.live = true;
        }
        if (/^购物\s*[|｜]/.test(t) || /^(立即购买|商品橱窗|去购买|购物|查看详情)$/.test(t)) {
          out.shop = true;
        }
        if (out.ad && out.live && out.shop) break;
      }
      if (out.ad && out.live && out.shop) break;
    }

    out.text = bits.filter(Boolean).join('\n').slice(0, 600);
    if (isStrongLiveRoomText(out.text)) out.live = true;
    // 「直播中」角标 + 进房文案/倒计时 → 直播预览卡
    if (sawLiveBadge && (sawLiveCta || isStrongLiveRoomText(out.text))) out.live = true;
    return out;
  }

  function isFeedAdLike(text) {
    if (!text) return false;
    const raw = String(text);
    // 单独成行的「广告」灰标（中文不能靠 \b）
    if (/(^|\n)\s*广告\s*(\n|$)/.test(raw)) return true;
    if (/\n\s*广告\s*\n/.test(`\n${raw}\n`)) return true;
    if (/Advertisement|赞助商|品牌合作/i.test(raw)) return true;
    // @账号 下方紧跟广告标
    if (/@[^\n]{1,40}\n\s*广告\s*(\n|$)/.test(raw)) return true;
    if (/赞助|品牌合作|立即购买|商品橱窗/.test(raw) && /广告|购物|推广/.test(raw)) return true;
    return false;
  }

  function isFeedLive(text) {
    // 不要用单独的「直播/LIVE/直播中」：作者在播时短视频头像也会带
    return isStrongLiveRoomText(text);
  }

  function isFeedShop(text) {
    // 购物条、商品卡「查看详情」、店铺号等
    return /购物\s*[|｜]|商品橱窗|立即购买|去购买|查看详情|小黄车|橱窗|专卖店|旗舰店|官方店|进入店铺|同款商品/.test(text || '');
  }

  let lastFeedSkipAt = 0;
  let lastFeedSkipKey = '';
  function douyinFeedTick() {
    if (!IS_DOUYIN || document.hidden) return;
    if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop && !cfg.douyinInVideo) return;
    const now = Date.now();
    if (now - lastFeedSkipAt < 900) return;

    // 官方中插/贴片：自动点跳过（勿匹配裸「跳过」）
    if (cfg.douyinInVideo) {
      const btn = findClickableByText(SKIP_BTN_TEXT);
      if (btn && clickIfVisible(btn)) {
        lastFeedSkipAt = now;
        const seg = activeSeg || pendingSkip && activeSegs.find((s) => segKey(s) === pendingSkip.key);
        if (pendingSkip?.timer) {
          clearInterval(pendingSkip.timer);
          pendingSkip = null;
        }
        if (seg) {
          const key = segKey(seg);
          skippedKeys.add(key);
          const v = getVideoEl();
          lastSkip = {
            fromTime: v ? Math.max(0, (v.currentTime || seg.start) - 5) : seg.start,
            toTime: v?.currentTime || seg.end,
            key,
            seg,
          };
          setStatus(`已跳过 → ${formatTime(v?.currentTime || seg.end)} (官方按钮)`);
          clearTimeout(doSkip._toastT);
          doSkip._toastT = setTimeout(() => showUndoToast(), 450);
        } else {
          setStatus('已点跳过广告');
        }
        return;
      }
    }

    // 推荐流 / 视频页竖滑：仅在命中广告·带货·真直播时划走（不再因 /video/ 整页禁用）
    if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop) return;

    const card = inspectActiveFeedCard();
    const text = card.text || douyinCurrentCardText();
    const shopHit = card.shop || isFeedShop(text);
    const adHit = card.ad || isFeedAdLike(text);
    let shouldSkip = false;
    let reason = '';
    // 广告 / 购物 / 直播分开；开广告时不自动带上购物（购物有独立开关）
    if (cfg.douyinFeedAd && adHit) {
      shouldSkip = true;
      reason = '信息流广告';
    } else if (cfg.douyinFeedShop && shopHit) {
      shouldSkip = true;
      reason = '购物卡';
    } else if (cfg.douyinFeedLive && (card.live || isFeedLive(text))) {
      shouldSkip = true;
      reason = '直播卡';
    }
    if (!shouldSkip) return;

    // 同一卡短时间不连划
    const key = `${reason}:${(text || '').slice(0, 40)}`;
    if (key === lastFeedSkipKey && now - lastFeedSkipAt < 2500) return;
    lastFeedSkipKey = key;
    lastFeedSkipAt = now;
    setStatus(`划走${reason}`);
    swipeToNextFeed();
    setTimeout(() => swipeToNextFeed(), 280);
  }

  /** 抖音官方「广告看点」索引 → 跳过区间（口播略加缓冲，勿吞太多正片） */
  function chapterLabelLooksAd(label) {
    const t = String(label || '');
    if (/(广告|恰饭|赞助|商单|推广|软广)/.test(t)) return true;
    return brandList().some((k) => t.includes(k));
  }

  function detectFromDouyinAdChapters(chapterList, adIndexes, durationSec) {
    if (!chapterList?.length) return [];
    const segs = [];
    const dur = durationSec || 0;
    for (const idx of adIndexes || []) {
      const ch = chapterList[idx];
      if (!ch) continue;
      const start = (ch.timestamp || 0) / 1000;
      let endIdx = idx + 1;
      if (endIdx < chapterList.length) {
        const nextLab = String(chapterList[endIdx].desc || chapterList[endIdx].detail || '');
        const gap = endIdx + 1 < chapterList.length
          ? (chapterList[endIdx + 1].timestamp - chapterList[endIdx].timestamp) / 1000
          : 99;
        // 下一看点标题仍像广告话术、且间隔短 → 再吞一段
        if (gap <= 45 && (chapterLabelLooksAd(nextLab)
          || /(压力|旗舰|性能|续航|优惠|下单|品牌|真我|一加|红米|小米|华为|vivo|OPPO|手机|冰被|回收|零食|方便面|咖啡|联名)/i.test(nextLab))) {
          endIdx += 1;
        }
      }
      let end;
      if (endIdx < chapterList.length) {
        // 跳到下一看点起点后只留短缓冲，避免 +28s 吞正片
        end = (chapterList[endIdx].timestamp || 0) / 1000 + 5;
      } else {
        end = Math.min(dur || start + 75, start + 75);
      }
      // 王路翔类口播：官方下一段常偏早，保证至少约 32s
      if (end - start < 32) {
        let stretch = start + 40;
        if (endIdx + 1 < chapterList.length) {
          stretch = Math.min(stretch, (chapterList[endIdx + 1].timestamp || 0) / 1000 + 5);
        } else if (dur > 0) {
          stretch = Math.min(stretch, dur - 2.5);
        }
        end = Math.max(end, stretch);
      }
      if (dur > 0) end = Math.min(dur - 2.5, end);
      if (end - start < 8) continue;
      segs.push({
        start,
        end,
        source: 'douyin-ad-chapter',
        label: String(ch.desc || ch.detail || ''),
      });
    }
    if (!segs.length) {
      for (let i = 0; i < chapterList.length; i++) {
        const label = String(chapterList[i].desc || chapterList[i].detail || '');
        if (!chapterLabelLooksAd(label)) continue;
        const start = (chapterList[i].timestamp || 0) / 1000;
        let end = chapterList[i + 1]
          ? (chapterList[i + 1].timestamp || 0) / 1000 + 5
          : Math.min(dur || start + 60, start + 75);
        if (dur > 0) end = Math.min(dur - 2.5, end);
        segs.push({ start, end, source: 'douyin-chapter-kw', label });
      }
    }
    return segs.filter((s) => s.end > s.start + 5);
  }

  function collectDouyinSubtitleInfos(detail) {
    if (!detail || typeof detail !== 'object') return [];
    const out = [];
    const push = (info, langHint) => {
      if (!info || typeof info !== 'object') return;
      const url = info.url
        || info.Url
        || (Array.isArray(info.url_list) && info.url_list[0])
        || (info.url && info.url.url_list && info.url.url_list[0]);
      if (!url || typeof url !== 'string') return;
      const lang = String(
        langHint
        || info.language_code
        || info.language
        || info.lang
        || info.LanguageCodeName
        || info.LanguageID
        || '',
      );
      out.push({ url, lang, format: String(info.caption_format || info.Format || info.format || '') });
    };

    const video = detail.video || {};
    for (const info of (video.subtitleInfos || video.subtitle_infos || detail.subtitle_infos || [])) {
      push(info);
    }
    for (const info of (video.cla_info?.caption_infos || [])) {
      push(info, info.lang);
    }
    const stickers = detail.interaction_stickers || [];
    for (const st of stickers) {
      const caps = st?.auto_video_caption_info?.auto_captions || [];
      for (const cap of caps) {
        push(cap, cap.language);
      }
    }
    // 去重 URL
    const seen = new Set();
    return out.filter((x) => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });
  }

  function parseClockToSec(raw) {
    const t = String(raw || '').trim().replace(',', '.');
    const parts = t.split(':').map((x) => parseFloat(x));
    if (parts.some((n) => !Number.isFinite(n))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function normalizeSubtitleLines(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) {
      return payload.map((x) => {
        let from = x.from ?? x.start ?? x.start_time ?? x.begin;
        let to = x.to ?? x.end ?? x.end_time ?? x.finish;
        if (from > 1000 || to > 1000) {
          from /= 1000;
          to /= 1000;
        }
        return {
          from: Number(from) || 0,
          to: Number(to) || (Number(from) || 0) + 2,
          content: String(x.content || x.text || x.utterance || ''),
        };
      }).filter((l) => l.content);
    }
    if (typeof payload === 'object') {
      if (Array.isArray(payload.body)) return normalizeSubtitleLines(payload.body);
      if (Array.isArray(payload.utterances)) {
        return normalizeSubtitleLines(payload.utterances.map((u) => ({
          start_time: u.start_time,
          end_time: u.end_time,
          text: u.text,
        })));
      }
      if (Array.isArray(payload.sentences)) {
        return normalizeSubtitleLines(payload.sentences);
      }
    }
    const text = String(payload);
    if (!text.includes('-->')) return [];
    const lines = [];
    const re = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{1,2}:\d{2}|\n\d+\s*\n|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const from = parseClockToSec(m[1]);
      const to = parseClockToSec(m[2]);
      const content = String(m[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!content || !Number.isFinite(from) || !Number.isFinite(to)) continue;
      lines.push({ from, to, content });
    }
    return lines;
  }

  async function fetchDouyinSubtitleLines(infos) {
    if (!infos?.length) return [];
    const ranked = [...infos].sort((a, b) => {
      const score = (x) => (/zh|cn|chi/i.test(x.lang || '') ? 0 : 1);
      return score(a) - score(b);
    });
    for (const info of ranked.slice(0, 4)) {
      try {
        let url = info.url;
        if (url.startsWith('//')) url = `https:${url}`;
        const data = await pageFetchJson(url);
        const lines = normalizeSubtitleLines(data);
        if (lines.length >= 5) {
          log('douyin subtitle lines', lines.length, info.lang || '', info.format || '');
          return lines;
        }
      } catch (e) {
        log('douyin subtitle fail', e);
      }
    }
    return [];
  }

  function packDouyinDetail(detail, fromApi) {
    if (!detail) return null;
    return {
      chapterList: detail.chapter_list || [],
      adIndexes: detail.chapter_data?.ad_chapter_index_list || [],
      durationMs: detail.duration || 0,
      desc: detail.desc || '',
      subtitleInfos: collectDouyinSubtitleInfos(detail),
      fromApi: !!fromApi,
    };
  }

  async function fetchDouyinChapters(awemeId) {
    try {
      const url = `https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&aweme_id=${encodeURIComponent(awemeId)}`;
      const data = await pageFetchJson(url);
      const detail = data?.aweme_detail || data?.aweme_detail_list?.[0] || null;
      if (!detail) {
        const embedded = tryReadDouyinEmbedded(awemeId);
        if (embedded) return embedded;
        return null;
      }
      return packDouyinDetail(detail, true);
    } catch (e) {
      log('douyin chapters fail', e);
      return tryReadDouyinEmbedded(awemeId);
    }
  }

  function tryReadDouyinEmbedded(awemeId) {
    if (!awemeId) return null;
    // 推荐流首页 RENDER_DATA 极大，未登录也常有；禁止在非详情上下文解析
    if (!isDouyinDetailContext()) return null;
    try {
      const scripts = document.querySelectorAll('script#RENDER_DATA, script[id*="RENDER"]');
      for (const s of scripts) {
        let raw = s.textContent || '';
        // 更严：超过约 400KB 直接放弃，避免 JSON.parse 卡死标签
        if (raw.length > 400_000) continue;
        try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
        if (raw.length > 400_000) continue;
        if (!raw.includes(String(awemeId))) continue;
        if (!raw.includes('chapter_list') && !raw.includes('subtitle')) continue;
        const j = JSON.parse(raw);
        const found = findAwemeInObj(j, awemeId);
        if (found) return packDouyinDetail(found, false);
      }
    } catch (e) {
      log('embedded douyin fail', e);
    }
    return null;
  }

  function findAwemeInObj(obj, awemeId, depth = 0, state = { n: 0 }) {
    if (!obj || depth > 8 || state.n > 6000) return null;
    if (typeof obj !== 'object') return null;
    state.n += 1;
    const id = obj.aweme_id || obj.awemeId || obj.group_id || obj.awemeIdStr;
    if (awemeId && id && String(id) === String(awemeId)) {
      if (obj.chapter_list || obj.chapter_data || obj.desc != null || obj.video || obj.subtitle_infos) return obj;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const hit = findAwemeInObj(v, awemeId, depth + 1, state);
        if (hit) return hit;
      }
    }
    return null;
  }

  /** 扩展隔离世界无页面 Cookie；经 page-bridge 在主世界请求 */
  function ensurePageBridge() {
    if (!IS_EXT || typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
      return Promise.resolve();
    }
    if (window.__MAS_BRIDGE_INJECTED__) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/page-bridge.js');
      s.onload = () => {
        window.__MAS_BRIDGE_INJECTED__ = true;
        resolve();
      };
      s.onerror = () => reject(new Error('page-bridge inject fail'));
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function pageFetchJson(url) {
    if (!IS_EXT || typeof chrome === 'undefined' || !chrome.runtime?.id) {
      const res = await fetch(url, { credentials: 'include' });
      const text = await res.text();
      const trimmed = (text || '').trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(text); } catch { /* fallthrough */ }
      }
      return text;
    }
    await ensurePageBridge();
    return new Promise((resolve, reject) => {
      const id = `mas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('page fetch timeout'));
      }, 15000);
      function onMsg(ev) {
        if (ev.source !== window || !ev.data || ev.data.source !== 'mas-page-bridge') return;
        if (ev.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (ev.data.ok) resolve(ev.data.data);
        else reject(new Error(ev.data.error || 'page fetch fail'));
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'mas-content', type: 'MAS_PAGE_FETCH', id, url }, '*');
    });
  }

  function getDouyinAwemeId() {
    // 作者主页弹窗：必须优先 modal_id，否则会抓到侧边推荐视频
    const modal = location.href.match(/[?&#]modal_id=(\d+)/);
    if (modal) return modal[1];
    const mNum = location.pathname.match(/\/video\/(\d+)/);
    if (mNum) return mNum[1];
    const m2 = location.href.match(/aweme_id=(\d+)/);
    if (m2) return m2[1];
    // 仅当前激活卡片，不用满页 a[href*=/video/]（会串台）
    const activeSelectors = [
      '[data-e2e="feed-active-video"] a[href*="/video/"]',
      '.swiper-slide-active a[href*="/video/"]',
    ];
    for (const sel of activeSelectors) {
      const a = document.querySelector(sel);
      const hm = (a?.getAttribute('href') || a?.href || '').match(/\/video\/(\d+)/);
      if (hm) return hm[1];
    }
    const v = getVideoEl();
    const root = v?.closest('[data-e2e="feed-active-video"], .swiper-slide-active, li, article') || null;
    const near = root?.querySelector?.('a[href*="/video/"]');
    const hm2 = (near?.getAttribute('href') || near?.href || '').match(/\/video\/(\d+)/);
    if (hm2) return hm2[1];
    return null;
  }

  /** 详情页 / 弹窗详情：才允许重分析与读 RENDER_DATA */
  function isDouyinDetailContext() {
    return /\/video\/\d+/.test(location.pathname)
      || /[?&#]modal_id=\d+/.test(location.href);
  }

  /** 推荐流未登录首页不要做片内分析（易在水合阶段崩） */
  function shouldAnalyzeDouyinInVideo() {
    if (!cfg.douyinInVideo) return false;
    if (isDouyinDetailContext()) return true;
    const v = getVideoEl();
    const dur = v?.duration;
    return !!(v && Number.isFinite(dur) && dur >= 45);
  }

  /** 进度条附近的「第N章：标题」 */
  function readDomChapterHint() {
    const root = document.querySelector('.xgplayer')
      || document.querySelector('[data-e2e="feed-active-video"]');
    const text = lightText(root, 600, 50);
    const m = text.match(/第\s*(\d+)\s*章\s*[:：]\s*([^\n\r]{1,24})/);
    if (!m) return null;
    return { n: parseInt(m[1], 10), label: m[2].replace(/\s+/g, ' ').trim() };
  }

  function chaptersMatchPage(chapterList, pageHint) {
    if (!pageHint?.label || !chapterList?.length) return true;
    const lab = pageHint.label;
    return chapterList.some((c) => {
      const d = String(c.desc || c.detail || '');
      return d.includes(lab) || lab.includes(d) || d.replace(/\s/g, '') === lab.replace(/\s/g, '');
    });
  }

  function collectDouyinJumpTexts() {
    const items = [];
    const push = (text, time) => {
      const t = String(text || '').trim();
      if (!t || t.length > 80) return;
      items.push({ text: t, time: typeof time === 'number' ? time : undefined });
    };
    const nodes = document.querySelectorAll(
      '[data-e2e*="danmaku"], [data-e2e="comment-item"]',
    );
    const max = Math.min(nodes.length, 40);
    for (let i = 0; i < max; i += 1) {
      const t = (nodes[i].textContent || '').split('\n')[0];
      push(t);
    }
    const title = document.querySelector('h1')?.textContent || '';
    const desc = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')?.textContent || '';
    push(title);
    push(desc);
    return items;
  }

  async function douyinAnalyzeInVideo() {
    if (isBlockedVideo()) {
      setStatus('本视频已禁用');
      activeSeg = null;
      activeSegs = [];
      return;
    }
    if (!cfg.douyinInVideo) return;
    if (!shouldAnalyzeDouyinInVideo()) {
      setStatus(isDouyinDetailContext()
        ? '等待播放器…'
        : '推荐流待命（片内分析需进视频页；直播划走默认关）');
      return;
    }
    const v = getVideoEl();
    const duration = v?.duration && Number.isFinite(v.duration) ? v.duration : 0;
    if (duration && duration < 45) {
      setStatus('短视频，仅信息流/跳过按钮');
      return;
    }

    setStatus('分析看点/作者标注…');
    const awemeId = getDouyinAwemeId();
    const domHint = readDomChapterHint();
    let chapterSegs = [];
    let detailPack = null;
    if (awemeId) {
      detailPack = await fetchDouyinChapters(awemeId);
      if (detailPack) {
        // 按 aweme_id 拉到的官方详情可信；仅内嵌兜底数据才用 DOM 防串台
        const matched = detailPack.fromApi
          || !!(detailPack.adIndexes && detailPack.adIndexes.length)
          || chaptersMatchPage(detailPack.chapterList, domHint);
        log('douyin chapters', detailPack.chapterList?.length, 'adIdx', detailPack.adIndexes, 'subs', detailPack.subtitleInfos?.length, 'id', awemeId, 'fromApi', detailPack.fromApi, 'domHint', domHint, 'match', matched);
        if (!matched) {
          setStatus(`看点与本片不符(id ${awemeId})，已忽略串台数据`);
        } else {
          chapterSegs = detectFromDouyinAdChapters(
            detailPack.chapterList,
            detailPack.adIndexes,
            (detailPack.durationMs || 0) / 1000 || duration,
          ) || [];
          const timeline = (detailPack.chapterList || [])
            .map((c) => `${formatTime((c.timestamp || 0) / 1000)} ${c.desc || ''}`)
            .join('\n');
          const fromMarks = detectFromCreatorMarks(`${detailPack.desc || ''}\n${timeline}`, duration);
          if (fromMarks) chapterSegs.push(fromMarks);
        }
      } else {
        log('douyin chapters empty', awemeId);
      }
    }

    if (chapterSegs.length) {
      activeSegs = chapterSegs;
      activeSeg = chapterSegs[0];
      skippedKeys = new Set();
      const tip = chapterSegs
        .map((s) => `${formatTime(s.start)}→${formatTime(s.end)}${s.label ? '(' + s.label + ')' : ''}`)
        .join(' · ');
      setStatus(`看点广告 ${tip}`);
      if (cfg.autoSkip) {
        const kick = () => skipIfPlayingInSegs();
        if (!kick()) {
          setTimeout(kick, 400);
          setTimeout(kick, 1200);
        }
      } else {
        showSkipToast(activeSeg);
      }
      return;
    }

    const title = lightText(document.querySelector('h1'), 200, 12);
    const descNode = document.querySelector(
      '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]',
    );
    const desc = `${lightText(descNode, 500, 30)}\n${title}`;
    const jumpItems = collectDouyinJumpTexts();
    const comments = [];
    const commentNodes = document.querySelectorAll('[data-e2e="comment-item"]');
    const maxComments = Math.min(commentNodes.length, 10);
    for (let i = 0; i < maxComments; i += 1) {
      const text = lightText(commentNodes[i], 160, 12);
      if (text) comments.push({ text });
    }
    const creatorText = [desc, comments.map((c) => c.text).join('\n')].join('\n');

    // 无看点时：用定时字幕估口播段
    let subtitleLines = [];
    if (detailPack?.subtitleInfos?.length) {
      setStatus('分析字幕轨…');
      subtitleLines = await fetchDouyinSubtitleLines(detailPack.subtitleInfos);
    }
    if (subtitleLines.length >= 5) {
      const subSeg = detectFromSubtitles(subtitleLines, jumpItems, duration);
      if (subSeg && (validSeg(subSeg, duration || 9999) || (subSeg.end > subSeg.start && subSeg.end - subSeg.start >= 8))) {
        activeSeg = subSeg;
        activeSegs = [subSeg];
        skippedKeys = new Set();
        setStatus(`跳点 ${formatTime(subSeg.start)}→${formatTime(subSeg.end)} · ${subSeg.source}`);
        if (cfg.autoSkip) {
          if (!skipIfPlayingInSegs()) setTimeout(() => skipIfPlayingInSegs(), 400);
        } else {
          showSkipToast(subSeg);
        }
        return;
      }
    }

    const pipeline = [
      () => detectFromCreatorMarks(creatorText, duration),
      () => detectFromJumpTexts(jumpItems.length ? jumpItems : comments, duration),
      () => detectFromKeywords(
        jumpItems
          .filter((x) => typeof x.time === 'number')
          .concat(comments.map((x) => ({ ...x, time: 0 }))),
        duration,
      ),
    ];

    for (const step of pipeline) {
      const seg = step();
      if (seg && (validSeg(seg, duration || 9999) || (seg.end > seg.start && seg.end - seg.start >= 8))) {
        activeSeg = seg;
        activeSegs = [seg];
        skippedKeys = new Set();
        setStatus(`跳点 ${formatTime(seg.start)}→${formatTime(seg.end)} · ${seg.source}`);
        if (!cfg.autoSkip) showSkipToast(seg);
        else if (!skipIfPlayingInSegs()) setTimeout(() => skipIfPlayingInSegs(), 400);
        return;
      }
    }

    const shopBlob = title + desc + jumpItems.map((x) => x.text).join('');
    const looksShop = brandList().some((k) => shopBlob.includes(k))
      || /(苹果|手机|ProMax|回收|山楂|购物|橱窗|优惠券|广告|恰饭|赞助|3100|甲方)/i.test(shopBlob);
    if (!awemeId) {
      setStatus(looksShop
        ? '未拿到视频ID（推荐流？点进视频页再试）'
        : '未识别视频ID，无法拉看点');
      return;
    }
    if (looksShop) {
      softOralReady = true;
      const sec = softSkipSec();
      const noSub = !subtitleLines.length;
      setStatus(noSub
        ? `疑似口播 · 无看点/无字幕可估 · 听到时点「跳过约${sec}秒」`
        : `疑似口播 · 字幕未命中品牌 · 听到时点「跳过约${sec}秒」`);
      showSoftOralHint();
      return;
    }
    setStatus('未发现片内跳点（仍监视跳过按钮）');
  }

  // -------------------- boot --------------------
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('重新分析广告', () => {
      resetPlaybackState();
      if (IS_BILI) runBilibili();
      else douyinAnalyzeInVideo();
    });
    GM_registerMenuCommand('显示/隐藏浮动面板', () => {
      cfg.showPanel = !cfg.showPanel;
      saveCfg();
      if (cfg.showPanel) ensurePanel();
      else hidePanel();
    });
    GM_registerMenuCommand('切换自动跳过', () => {
      cfg.autoSkip = !cfg.autoSkip;
      saveCfg();
      setStatus(`自动跳过: ${cfg.autoSkip ? '开' : '关'}`);
      if (cfg.showPanel) {
        ensurePanel();
        const input = panelEl?.querySelector('input[data-k="autoSkip"]');
        if (input) input.checked = cfg.autoSkip;
      }
    });
  }

  function observeSpa(cb) {
    let key = location.pathname + location.search;
    let lastAweme = '';
    let awemeProbeAt = 0;
    setInterval(() => {
      if (document.hidden) return;
      const nextKey = location.pathname + location.search;
      let changed = nextKey !== key;
      // 抖音：不在推荐流每 800ms 扫 DOM 取 aweme；详情页再探
      if (IS_DOUYIN && isDouyinDetailContext() && Date.now() - awemeProbeAt > 1500) {
        awemeProbeAt = Date.now();
        const id = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
        if (id && id !== lastAweme) {
          lastAweme = id;
          changed = true;
        }
      }
      if (!changed) return;
      key = nextKey;
      cb();
    }, IS_DOUYIN ? 1200 : 800);
    // 抖音勿劫持 history：与站点 SPA 抢 pushState 易整页崩
    if (!IS_DOUYIN) {
      const wrap = (fn) => function (...args) {
        const r = fn.apply(this, args);
        queueMicrotask(cb);
        return r;
      };
      history.pushState = wrap(history.pushState.bind(history));
      history.replaceState = wrap(history.replaceState.bind(history));
    }
    window.addEventListener('popstate', cb);
  }

  function bindExtCommands() {
    if (!IS_EXT || !chrome.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (!msg || msg.type !== 'MAS_CMD') return false;
      (async () => {
        try {
          switch (msg.cmd) {
            case 'status':
              sendResponse({
                ok: true,
                status: statusText,
                seg: activeSeg,
                videoId: IS_DOUYIN && typeof getDouyinAwemeId === 'function'
                  ? getDouyinAwemeId()
                  : currentVideoId(),
                blocked: isCurrentVideoBlocked(),
              });
              break;
            case 'reanalyze':
              resetPlaybackState();
              if (IS_BILI) await runBilibili();
              else await douyinAnalyzeInVideo();
              sendResponse({ ok: true, status: statusText, blocked: isCurrentVideoBlocked() });
              break;
            case 'undo':
              undoLastSkip();
              sendResponse({ ok: true, status: statusText });
              break;
            case 'block':
              blockCurrentVideo(msg.videoId);
              sendResponse({ ok: true, status: statusText, blocked: true });
              break;
            case 'unblock':
              unblockCurrentVideo(msg.videoId);
              sendResponse({
                ok: true,
                status: statusText,
                blocked: isCurrentVideoBlocked(),
              });
              break;
            case 'skipNow':
              if (activeSeg) doSkip(activeSeg, true);
              else if (softOralReady) softSkipForward();
              else setStatus('暂无跳点');
              sendResponse({ ok: true, status: statusText });
              break;
            case 'wrong':
              await reportWrongMark();
              sendResponse({ ok: true, status: statusText });
              break;
            default:
              sendResponse({ ok: false, error: 'unknown cmd' });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
        }
      })();
      return true;
    });
  }

  let feedTimer = null;
  function startFeedPoll() {
    if (feedTimer) {
      clearInterval(feedTimer);
      feedTimer = null;
    }
    if (!IS_DOUYIN) return;
    feedTimer = setInterval(douyinFeedTick, Math.max(400, cfg.feedPollMs || 600));
  }

  function boot() {
    bindExtCommands();

    if (IS_BILI) {
      ensureToastStyles();
      ensurePanel();
      registerMenu();
      watchPlayback();
      setStatus('B站模式');
      const kick = () => {
        resetPlaybackState();
        setStatus('切换视频…');
        setTimeout(() => runBilibili(), 800);
      };
      kick();
      observeSpa(kick);
      return;
    }

    if (IS_DOUYIN) {
      // 只在抖音站启用；延后启动减轻首页水合压力（与是否登录无关）
      setStatus('抖音模式');
      const kick = () => {
        resetPlaybackState();
        if (!shouldAnalyzeDouyinInVideo()) {
          setStatus('推荐流待命（点进视频页再分析片内广告）');
          return;
        }
        setStatus('切换视频…');
        setTimeout(() => douyinAnalyzeInVideo(), 1500);
      };
      const start = () => {
        ensureToastStyles();
        ensurePanel();
        registerMenu();
        watchPlayback();
        startFeedPoll();
        kick();
        observeSpa(kick);
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => setTimeout(start, 1800), { timeout: 4000 });
      } else {
        setTimeout(start, 2200);
      }
      return;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

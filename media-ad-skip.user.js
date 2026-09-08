// ==UserScript==
// @name         Media Ad Skip (B站 + 抖音)
// @namespace    https://github.com/hualeide/media-ad-skip
// @version      1.5.74
// @description  像绯红之王一样删除广告时间 · B站/抖音片内与信息流跳过
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
  const HOST = location.hostname;
  const IS_BILI = HOST.includes('bilibili.com');
  const IS_DOUYIN = HOST.includes('douyin.com');
  const IS_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  // 扩展 / 油猴分桶，避免共用 __MAS_VER__ 互相挡住
  const MAS_VER_KEY = IS_EXT ? '__MAS_VER_EXT__' : '__MAS_VER_GM__';
  if (window[MAS_VER_KEY] === '1.5.74') return;
  window[MAS_VER_KEY] = '1.5.74';
  window.__MAS_VER__ = '1.5.74';

  // 非目标站一律不跑（双重保险；扩展/油猴 match 已限定）
  if (!IS_BILI && !IS_DOUYIN) return;
  window.__MAS_LOADED__ = true;

  // --- 阈值（与 src/config.mjs 对齐；改配置后请跑 build）---
  const MIN_AD_SEC = 8;           // 广告段最短秒数
  const MAX_AD_SEC = 420;         // 广告段最长秒数
  const MIN_SEG_START_SEC = 3;    // 非作者自标不允许更早起点
  const SEG_TAIL_GUARD_SEC = 3;   // 终点须距片尾
  const JUMP_VOTE_MIN_SCORE = 1.8;// 弹幕时间戳投票门槛
  const CONF_LANG_TIP = 1.5;      // 「谢谢X分Y郎」
  const CONF_COLON_JUMP = 1.25;   // 带空降词的 mm:ss
  const CONF_COLON_WEAK = 0.35;   // 裸 mm:ss
  const MAX_FEED_BODY = 350_000;  // feed 响应体上限，防崩
  const MAX_DANMAKU_XML = 600_000;
  const MAX_RENDER_DATA = 250_000;
  const MAX_PAGE_FETCH = 600_000;
  const MAX_SUBTITLE_AD_SEC = 75; // 字幕估段最长；过宽会早跳进正片
  const AD_CTX_RE = /(赞助|恰饭|商单|广告|软广|金主|优惠券|领券|下单|购买|带货|橱窗|链接|折扣|满减|安利)/;

  // 品牌默认表：构建时由 src/config.mjs 同步；勿手改中间内容
  /* BRAND_KW_START */
  const DEFAULT_BRAND_KW = [
    "转转", "爱回收", "闲鱼", "瓜子", "萤石", "山楂树下", "真我",
    "神奇小鹿", "小鹿冰被", "躺岛", "蓝盒子", "半日闲", "时光存折", "栖作",
    "甜秘密", "华味坊", "酸汤面叶", "劲仔", "卫龙", "盐津铺子", "三只松鼠",
    "良品铺子", "王小卤", "认养一头牛", "妙界", "赫恩", "海洋至尊", "溪木源",
    "博乐达", "蜜丝婷", "盖世小鸡", "飞智", "北通", "黑白调", "骁骑",
    "瑞幸", "安克", "酷态科", "得物",
  ];
  /* BRAND_KW_END */
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
    useDanmakuDetect: false, // 弹幕空降/关键词误伤太多，默认关
    useCreatorMarks: false, // 简介很少写恰饭轴，默认关
    showUndoToast: true,
    statsEnabled: false,
    brandKeywords: DEFAULT_BRAND_KW.slice(),
    blockBvids: [],
    blockMids: [],
  };

  const AD_START = ['广告开始', '开始恰饭', '恰饭开始', '广告来了', '开始推广', '金主来了', '广告时间'];
  const AD_END = ['广告结束', '欢迎回来', '恰饭结束', '回来了', '广告完了', '正片开始', '回归正片'];
  /* 弹幕泛词 + 品牌：见 generalKw() */
  const SKIP_BTN_TEXT = ['跳过广告', '关闭广告', 'Skip Ad', 'Skip Ads'];

  /** 章节/时间轴是否广告：须与 src/detect-core.mjs#labelLooksAd 保持同构 */
  function labelLooksAd(text) {
    const raw = String(text || '');
    if (/(广告|广告时间|恰饭|赞助|商单|推广|软广)/.test(raw)) return true;
    return /\bads?\b|\bsponsors?\b|\bsponsored\b|\badvert(?:s|ising|isement)?\b/i.test(raw);
  }

  const ZH_NUM = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };

  /** @type {typeof DEFAULTS} */
  let cfg = loadCfg();
  let panelEl = null;
  let panelDragHandlers = null;
  let statusText = '待命';
  let activeSeg = null; // { start, end, source } 当前优先段
  let activeSegs = []; // 多段（SponsorBlock）
  let skippedKeys = new Set();
  /** 用户撤销过的段 key：本片内禁止再自动跳（重分析清空 skippedKeys 后仍生效） */
  let undoneKeys = new Set();
  /** 撤销段时间窗，兜底 key 因重检略变 */
  let undoneRange = null;
  let lastKey = '';
  let lastSkip = null;
  let softOralReady = false;
  /** 换片/重置时递增；异步分析结束后若对不上则丢弃，避免串台误跳 */
  let analyzeGen = 0;

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

  /** 弹幕稠密簇专用：去掉裸「广告/购买」，防吐槽弹幕把正片簇成广告段 */
  function generalCueKw() {
    return ['已买', '购入', '接广', '广子', '感谢金主', '商单', '恰饭', '下单', '买买买', ...brandList()];
  }

  function isWeakAdGossip(text) {
    const t = String(text || '');
    return /不[是算]?广告|没有(?:这么短的)?广告|广告吗|广告吧|隔壁|删了|剪了|别的平台|感觉不像|没法判断|玩梗/.test(t);
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
    const skipped = lastSkip || (seg ? { key: segKey(seg), seg } : null);
    if (lastSkip) undoLastSkip();
    else if (seg) skippedKeys.add(segKey(seg));
    if (skipped) rejectSegForever(skipped);
    if (typeof recordStat === 'function') recordStat({ wrong: 1 });
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
    // 换片/「本视频已禁用」才该清撤销记忆；重分析不清（见 runBilibili）
    undoneKeys = new Set();
    undoneRange = null;
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
    const skipped = lastSkip;
    // 先作废进行中的跳转确认 / 延迟 seek，再撤回
    if (pendingSkip?.timer) clearInterval(pendingSkip.timer);
    pendingSkip = null;
    clearTimeout(doSkip._toastT);
    if (seekTo(skipped.fromTime)) {
      markSegUndone(skipped);
      const seg = skipped.seg;
      if (seg && seg.start != null && seg.end != null) {
        setStatus(`已撤销 ${formatTime(seg.start)} → ${formatTime(seg.end)}`);
      } else {
        setStatus(`已撤销，回到 ${formatTime(skipped.fromTime)}`);
      }
      lastSkip = null;
      dismissMasToast(document.getElementById('mas-undo-toast'));
      if (typeof recordStat === 'function') recordStat({ undo: 1 });
    }
  }

  function dismissMasToast(el) {
    if (!el) return;
    clearTimeout(el._hideT);
    clearTimeout(el._hideAnim);
    clearTimeout(el._outT);
    el.style.display = 'none';
    el.classList.remove('mas-toast-in', 'mas-toast-out');
  }

  /** 右下角 toast：纯色瞬显，无 transform/will-change（dump 显示 GPU/合成层 FATAL） */
  function ensureToastStyles() {
    let style = document.getElementById('mas-toast-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'mas-toast-style';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
      #mas-undo-toast,#mas-skip-toast,#mas-feed-toast{
        position:fixed;right:16px;bottom:20px;z-index:2147483646;
        padding:10px 12px;border-radius:10px;
        font:500 12.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
        color:rgba(245,245,247,.9);display:none;
        max-width:min(260px,calc(100vw - 32px));
        background:rgba(28,28,30,.88);border:0;
        box-shadow:0 4px 12px rgba(0,0,0,.2);
      }
      #mas-feed-toast{
        padding:7px 10px;border-radius:8px;font-weight:500;font-size:12px;
        background:rgba(22,22,24,.78);box-shadow:0 2px 10px rgba(0,0,0,.16);
        max-width:min(220px,calc(100vw - 32px));
      }
      #mas-undo-toast .mas-toast-title,#mas-skip-toast .mas-toast-title{font-weight:600;font-size:13px}
      #mas-feed-toast .mas-toast-title{font-weight:500;font-size:12px;opacity:.92}
      #mas-undo-toast .mas-toast-sub,#mas-skip-toast .mas-toast-sub{
        margin-top:3px;font-weight:400;font-size:11.5px;opacity:.7;
      }
      #mas-feed-toast .mas-toast-sub{margin-top:2px;font-weight:400;font-size:11px;opacity:.62}
      #mas-undo-toast .mas-toast-actions,#mas-skip-toast .mas-toast-actions,#mas-feed-toast .mas-toast-actions{
        margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;
      }
      #mas-undo-toast .mas-btn,#mas-skip-toast .mas-btn,#mas-feed-toast .mas-btn{
        appearance:none;-webkit-appearance:none;cursor:pointer;border:0;border-radius:7px;
        padding:5px 10px;font:600 12px/1.2 inherit;
      }
      #mas-undo-toast .mas-btn-primary,#mas-skip-toast .mas-btn-primary,#mas-feed-toast .mas-btn-primary{background:#0a84ff;color:#fff}
      #mas-undo-toast .mas-btn-ghost,#mas-skip-toast .mas-btn-ghost,#mas-feed-toast .mas-btn-ghost{
        background:rgba(44,44,46,.85);color:#f5f5f7;border:0;
      }
    `;
  }

  function revealToast(toast) {
    ensureToastStyles();
    clearTimeout(toast._outT);
    toast.classList.remove('mas-toast-out', 'mas-toast-in');
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
    const withActions = !!opts.withActions;
    toast.innerHTML = `<div class="mas-toast-title">即将跳过广告</div>
      <div class="mas-toast-sub"></div>
      ${withActions ? `<div class="mas-toast-actions">
        <button type="button" data-mas-act="go" class="mas-btn mas-btn-primary">立即跳过</button>
        <button type="button" data-mas-act="no" class="mas-btn mas-btn-ghost">忽略</button>
      </div>` : ''}`;
    const sub = toast.querySelector('.mas-toast-sub');
    if (sub) {
      sub.textContent = range;
      if (seg.label) {
        const span = document.createElement('span');
        span.textContent = ` · ${String(seg.label)}`;
        sub.appendChild(span);
      }
    }
    revealToast(toast);
    if (withActions) {
      bindMasActions(toast, {
        go: () => { doSkip(seg, true); dismissMasToast(toast); },
        no: () => {
          dismissMasToast(toast);
          rejectSegForever({ key: segKey(seg), seg });
        },
      });
    }
    armToastAutoHide(toast, toastStayMs(withActions));
  }

  function showUndoToast() {
    if (!cfg.showUndoToast || !lastSkip) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-skip-toast'));
    dismissMasToast(document.getElementById('mas-feed-toast'));
    let toast = document.getElementById('mas-undo-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-undo-toast';
      document.documentElement.appendChild(toast);
    }
    const end = lastSkip.seg ? formatTime(lastSkip.seg.end) : formatTime(lastSkip.toTime);
    const start = lastSkip.seg
      ? formatTime(lastSkip.seg.start)
      : formatTime(lastSkip.fromTime);
    // 偶尔玩梗：约 1/4 次显示「时间已被删除」
    const title = Math.random() < 0.25 ? '时间已被删除。' : '已跳过广告';
    toast.innerHTML = `<div class="mas-toast-title">${title}</div>
      <div class="mas-toast-sub">${start} → ${end}</div>
      <div class="mas-toast-actions">
        <button type="button" data-mas-act="undo" class="mas-btn mas-btn-primary" title="这是一场试炼……">撤销</button>
        <button type="button" data-mas-act="never" class="mas-btn mas-btn-ghost">本段不再跳</button>
        <button type="button" data-mas-act="block" class="mas-btn mas-btn-ghost">本集不跳</button>
        <button type="button" data-mas-act="wrong" class="mas-btn mas-btn-ghost">标错了</button>
      </div>`;
    revealToast(toast);
    bindMasActions(toast, {
      undo: () => undoLastSkip(),
      never: () => {
        if (lastSkip) rejectSegForever(lastSkip);
        dismissMasToast(toast);
      },
      block: () => { blockCurrentVideo(); dismissMasToast(toast); },
      wrong: () => { reportWrongMark(); dismissMasToast(toast); },
    });
    armToastAutoHide(toast, toastStayMs(true));
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

  /** Toast 可点时长：默认至少 10s，悬停暂停关闭 */
  function toastStayMs(withActions) {
    if (!withActions) return 1800;
    return Math.max(10, Number(cfg.countdownSec) || 3) * 1000;
  }

  function armToastAutoHide(toast, ms) {
    if (!toast) return;
    const hide = () => dismissMasToast(toast);
    const clear = () => clearTimeout(toast._hideT);
    clear();
    toast._hideT = setTimeout(hide, ms);
    toast.onmouseenter = clear;
    toast.onmouseleave = () => {
      clear();
      toast._hideT = setTimeout(hide, ms);
    };
  }

  /**
   * 捕获阶段绑定 data-mas-act，挡住站点抢点击（抖音/B站常见）。
   * handlers: { undo(){}, block(){}, ... }
   */
  function bindMasActions(root, handlers) {
    if (!root || !handlers) return;
    const run = (e) => {
      const btn = e.target?.closest?.('[data-mas-act]');
      if (!btn || !root.contains(btn)) return;
      const act = btn.getAttribute('data-mas-act');
      if (!act || typeof handlers[act] !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      try { handlers[act](); } catch (err) { log('mas-act fail', act, err); }
    };
    if (root._masActBound) {
      root.removeEventListener('pointerdown', root._masActBound, true);
      root.removeEventListener('click', root._masActBound, true);
    }
    root._masActBound = run;
    root.addEventListener('pointerdown', run, true);
    root.addEventListener('click', run, true);
  }

  /** 本地轻量计数：成就看板默认记账，防抖写盘，不存明细 */
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
  let statsMem = { ...EMPTY_STATS };
  let statsLoaded = false;
  let statsQueue = [];
  let statsDirty = false;
  let statsFlushTimer = 0;
  let statsLoading = false;

  function applyStatDelta(s, delta) {
    if (delta.skip) s.skipCount += delta.skip;
    if (delta.undo) s.undoCount += delta.undo;
    if (delta.wrong) s.wrongCount += delta.wrong;
    if (delta.feed) s.feedSwipeCount += delta.feed;
    if (delta.feedAd) s.feedAdCount += delta.feedAd;
    if (delta.feedLive) s.feedLiveCount += delta.feedLive;
    if (delta.feedShop) s.feedShopCount += delta.feedShop;
    if (delta.savedSec) s.savedSec += Math.max(0, Number(delta.savedSec) || 0);
    if (s.savedSec > 1e9) s.savedSec = 1e9;
  }

  function feedSwipeStatDelta(reason) {
    const d = { feed: 1 };
    if (reason === '直播卡') d.feedLive = 1;
    else if (reason === '购物卡') d.feedShop = 1;
    else d.feedAd = 1;
    return d;
  }

  function flushStats() {
    if (!statsDirty) return;
    if (!statsLoaded) {
      ensureStatsLoad();
      return;
    }
    statsDirty = false;
    const snap = { ...statsMem };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
        chrome.storage.local.set({ masStats: snap }, () => {
          try { void chrome.runtime?.lastError; } catch { /* ignore */ }
        });
        return;
      }
      localStorage.setItem('mas-stats', JSON.stringify(snap));
    } catch { /* ignore */ }
  }

  function scheduleStatsFlush(delayMs) {
    const ms = Math.max(0, Number(delayMs) || 250);
    clearTimeout(statsFlushTimer);
    statsFlushTimer = setTimeout(() => {
      statsFlushTimer = 0;
      flushStats();
    }, ms);
  }

  function ensureStatsLoad() {
    if (statsLoaded || statsLoading) return;
    statsLoading = true;
    const finish = (base) => {
      statsMem = { ...EMPTY_STATS, ...(base && typeof base === 'object' ? base : {}) };
      for (const d of statsQueue) applyStatDelta(statsMem, d);
      statsQueue = [];
      statsLoaded = true;
      statsLoading = false;
      statsDirty = true;
      flushStats(); // 读完立刻落盘，弹窗才能看到
    };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        chrome.storage.local.get(['masStats'], (data) => {
          try {
            if (chrome.runtime?.lastError) {
              finish({});
              return;
            }
          } catch { /* ignore */ }
          finish(data?.masStats);
        });
        return;
      }
      finish(JSON.parse(localStorage.getItem('mas-stats') || '{}'));
    } catch {
      finish({});
    }
  }

  /** @param {{ skip?: number, undo?: number, wrong?: number, feed?: number, feedAd?: number, feedLive?: number, feedShop?: number, savedSec?: number }} delta */
  function recordStat(delta) {
    if (!delta) return;
    applyStatDelta(statsMem, delta);
    statsDirty = true;
    if (!statsLoaded) {
      statsQueue.push(delta);
      if (statsQueue.length > 40) statsQueue = statsQueue.slice(-20);
      ensureStatsLoad();
      return;
    }
    // 划走/跳过马上写盘；其它稍抖
    const urgent = !!(delta.feed || delta.feedAd || delta.feedLive || delta.feedShop || delta.skip || delta.savedSec);
    scheduleStatsFlush(urgent ? 80 : 400);
  }

  try {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushStats();
    });
    window.addEventListener('pagehide', () => flushStats());
  } catch { /* ignore */ }

  /** 信息流划走后的 toast（放 utils 后，避免扩展构建剥掉） */
  function showFeedSwipeToast(reason) {
    if (cfg.showUndoToast === false) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-skip-toast'));
    dismissMasToast(document.getElementById('mas-undo-toast'));
    let toast = document.getElementById('mas-feed-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-feed-toast';
      document.documentElement.appendChild(toast);
    }
    const title = reason === '直播卡' ? '已划走直播' : (reason === '购物卡' ? '已划走购物' : '已划走广告');
    let sub = '';
    if (reason === '直播卡') {
      sub = `累计 ${Math.max(0, Number(statsMem.feedLiveCount) || 0)}`;
    } else if (reason === '购物卡') {
      sub = `累计 ${Math.max(0, Number(statsMem.feedShopCount) || 0)}`;
    } else {
      sub = `累计 ${Math.max(0, Number(statsMem.feedAdCount) || 0)}`;
    }
    toast.innerHTML = `<div class="mas-toast-title">${title}</div>
      <div class="mas-toast-sub">${sub}</div>`;
    revealToast(toast);
    clearTimeout(showFeedSwipeToast._t);
    showFeedSwipeToast._t = setTimeout(() => dismissMasToast(toast), 1400);
  }

  /** 先滑走，确认换卡后再记账+轻提示（提示晚于划走动画） */
  function afterFeedSwiped(beforeId, reason) {
    const done = (afterId) => {
      if (afterId) lastSkippedAwemeId = afterId;
      else if (beforeId) lastSkippedAwemeId = beforeId;
      recordStat(feedSwipeStatDelta(reason));
      setStatus(`已划走${reason}`);
      // 等画面切走再弹，避免「提示先出、还没滑」
      setTimeout(() => {
        if (typeof showFeedSwipeToast === 'function') showFeedSwipeToast(reason);
      }, 260);
    };
    setTimeout(() => {
      const afterId = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
      const moved = !beforeId || (!!afterId && afterId !== beforeId);
      if (moved) {
        done(afterId);
        return;
      }
      if (typeof swipeToNextFeed === 'function') swipeToNextFeed({ hard: true });
      setTimeout(() => {
        const after2 = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
        if (!beforeId || (!!after2 && after2 !== beforeId)) {
          done(after2);
          return;
        }
        lastFeedSkipKey = '';
        lastSkippedAwemeId = '';
        setStatus(`检测到${reason}·未滑出，将重试`);
      }, 380);
    }, 300);
  }

  /** 检测到直播但开关关着：一键开启 */
  function showEnableLiveSwipeToast() {
    if (cfg.showUndoToast === false) return;
    ensureToastStyles();
    dismissMasToast(document.getElementById('mas-skip-toast'));
    dismissMasToast(document.getElementById('mas-undo-toast'));
    let toast = document.getElementById('mas-feed-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mas-feed-toast';
      document.documentElement.appendChild(toast);
    }
    toast.innerHTML = `<div class="mas-toast-title">检测到直播卡</div>
      <div class="mas-toast-sub">「划走直播」当前是关的</div>
      <div class="mas-toast-actions">
        <button type="button" data-mas-act="enable" class="mas-btn mas-btn-primary">开启并划走</button>
        <button type="button" data-mas-act="no" class="mas-btn mas-btn-ghost">忽略</button>
      </div>`;
    revealToast(toast);
    bindMasActions(toast, {
      enable: () => {
        cfg.douyinFeedLive = true;
        try { saveCfg(); } catch { /* ignore */ }
        dismissMasToast(toast);
        setStatus('已开启划走直播');
        lastFeedSkipKey = '';
        lastFeedSkipAt = 0;
        const beforeId = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
        swipeToNextFeed();
        afterFeedSwiped(beforeId, '直播卡');
      },
      no: () => dismissMasToast(toast),
    });
    armToastAutoHide(toast, 8000);
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
    const auto = !!(cfg.softOralAuto && cfg.autoSkip);
    let left = Math.max(3, Number(cfg.countdownSec) || 3);
    const render = () => {
      toast.innerHTML = auto
        ? `<div class="mas-toast-title">疑似口播 · ${left}s 后软跳约${sec}秒</div>
          <div class="mas-toast-sub">无看点/字幕终点时，从当前进度跳过。可取消。</div>
          <div class="mas-toast-actions">
            <button type="button" data-mas-act="soft" class="mas-btn mas-btn-primary">立即跳</button>
            <button type="button" data-mas-act="no" class="mas-btn mas-btn-ghost">取消</button>
          </div>`
        : `<div class="mas-toast-title">口播无时间戳</div>
          <div class="mas-toast-sub">听到广告时点下方，从当前进度跳过约 ${sec} 秒</div>
          <div class="mas-toast-actions">
            <button type="button" data-mas-act="soft" class="mas-btn mas-btn-primary">跳过约${sec}秒</button>
            <button type="button" data-mas-act="no" class="mas-btn mas-btn-ghost">关闭</button>
          </div>`;
      revealToast(toast);
      bindMasActions(toast, {
        soft: () => {
          clearInterval(showSoftOralHint._tick);
          dismissMasToast(toast);
          softSkipForward();
        },
        no: () => {
          clearInterval(showSoftOralHint._tick);
          dismissMasToast(toast);
        },
      });
    };
    clearInterval(showSoftOralHint._tick);
    render();
    if (auto) {
      showSoftOralHint._tick = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(showSoftOralHint._tick);
          dismissMasToast(toast);
          softSkipForward();
          return;
        }
        render();
      }, 1000);
    } else {
      armToastAutoHide(toast, 12000);
    }
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
    if (m) return { time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), conf: CONF_LANG_TIP };

    m = t.match(/(\d{1,2})[:;：；](\d{2})(?!\d)/);
    if (m) {
      const sec = parseInt(m[2], 10);
      if (sec < 60) {
        const time = parseInt(m[1], 10) * 60 + sec;
        const hasJump = /(空降(?!兵)|跳过|快进|广告|恰饭|指路|进度条|mark|标记|正片|指挥部)/i.test(raw + t);
        return { time, conf: hasJump ? CONF_COLON_JUMP : CONF_COLON_WEAK };
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

    m = (raw + t).match(/(\d{1,3}[:：]\d{2}).{0,6}(?:mark|标记)/i)
      || (raw + t).match(/(?:mark|标记).{0,6}(\d{1,3}[:：]\d{2})/i);
    if (m) {
      const p = m[1].match(/(\d{1,3})[:：](\d{2})/);
      if (p) return { time: parseInt(p[1], 10) * 60 + parseInt(p[2], 10), conf: 1.2 };
    }

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

  /** 段是否可跳：长度 / 起点 / 片尾守卫（阈值见文件顶 MIN_*） */
  function validSeg(seg, duration) {
    if (!seg || seg.start == null || seg.end == null) return false;
    const len = seg.end - seg.start;
    if (len < MIN_AD_SEC || len > MAX_AD_SEC) return false;
    if (seg.start < 0) return false;
    // 作者自标允许片头广告
    if (!String(seg.source || '').startsWith('creator') && seg.start < MIN_SEG_START_SEC) return false;
    if (duration > 0 && seg.end >= duration - SEG_TAIL_GUARD_SEC) return false;
    return true;
  }

  let pendingSkip = null; // { key, target, timer }
  /** 每次 seek 递增；抖音延迟重试若对不上则作废，避免撤销后又被拽回终点 */
  let seekSerial = 0;

  function getActiveFeedRoot() {
    if (!IS_DOUYIN) return null;
    return document.querySelector(
      '[data-e2e="feed-active-video"], .swiper-slide-active',
    );
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
    const serial = ++seekSerial;
    try {
      if (Math.abs((v.currentTime || 0) - target) < 0.35) return true;
      v.currentTime = target;
      if (IS_DOUYIN) {
        const retry = () => {
          if (serial !== seekSerial) return;
          const v2 = getVideoEl();
          if (v2 && Math.abs(v2.currentTime - target) > 1.5) {
            try { v2.currentTime = target; } catch { /* ignore */ }
          }
        };
        setTimeout(retry, 300);
        setTimeout(retry, 750);
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

  // 字幕硬 CTA（已去掉「合作/限时/入手/安利」等游戏口播高频误伤词）
  const AD_CONTENT_KW = [
    '赞助', '冠名', '商单', '蓝链', '二维码', '口令',
    '领券', '优惠券', '优惠码', '兑换码', '首充', '应用商店',
  ];

  /** 字幕聚类：按间隙拆簇 + 轻 padding，防早段误命中导致还没到广告就跳 */
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
        text,
        weight: brands.length ? 2 + brands.length : 1,
      });
    }
    if (!hits.length) return null;

    const brandHits = hits.filter((h) => h.brands.length);
    const hasAdCtx = hits.some((h) => h.matched.length || AD_CTX_RE.test(h.text || ''));
    const longBrand = hits.some((h) => h.brands.some((b) => b.length >= 4));
    const hasBrand = brandHits.length > 0 && (hasAdCtx || brandHits.length >= 2 || longBrand);
    if (hits.length < 2 && !hasBrand) return null;

    const PAD_START = 2;
    const PAD_END = 8;
    const CLUSTER_GAP = 28;

    function splitClusters(list, gapSec) {
      const out = [];
      let cur = [];
      for (const h of list) {
        if (cur.length && h.from - cur[cur.length - 1].to > gapSec) {
          out.push(cur);
          cur = [];
        }
        cur.push(h);
      }
      if (cur.length) out.push(cur);
      return out;
    }

    function densestSubspan(list, maxSpan) {
      if (!list.length) return null;
      let bestW = -1;
      let bestI = 0;
      let bestJ = 0;
      let i = 0;
      for (let j = 0; j < list.length; j++) {
        while (list[j].from - list[i].from > maxSpan) i += 1;
        let w = 0;
        for (let k = i; k <= j; k++) w += list[k].weight;
        const span = list[j].to - list[i].from;
        const bestSpan = list[bestJ].to - list[bestI].from;
        const better = w > bestW
          || (w === bestW && span < bestSpan)
          || (w === bestW && span === bestSpan && list[i].from > list[bestI].from);
        if (better) {
          bestW = w;
          bestI = i;
          bestJ = j;
        }
      }
      return { weight: bestW, start: list[bestI].from, end: list[bestJ].to };
    }

    const clampSub = (seg) => {
      if (!seg || seg.end <= seg.start) return null;
      if (seg.end - seg.start > MAX_SUBTITLE_AD_SEC) {
        seg.start = Math.max(0, seg.end - MAX_SUBTITLE_AD_SEC);
      }
      return validSeg(seg, duration) ? seg : null;
    };

    const pool = hasBrand && brandHits.length ? brandHits : hits;
    let best = null;
    for (const c of splitClusters(pool, CLUSTER_GAP)) {
      const d = densestSubspan(c, MAX_SUBTITLE_AD_SEC);
      if (!d || d.weight < 2) continue;
      if (!best
        || d.weight > best.weight
        || (d.weight === best.weight && (d.end - d.start) < (best.end - best.start))) {
        best = d;
      }
    }

    if (best && best.end > best.start) {
      let start = Math.max(0, best.start - (hasBrand ? PAD_START : 0));
      let end = best.end + (hasBrand ? PAD_END : 0);
      if (duration > 0) end = Math.min(duration - SEG_TAIL_GUARD_SEC - 0.1, end);
      return clampSub({
        start,
        end,
        source: hasBrand ? 'subtitle-brand' : 'subtitle',
      });
    }

    const strong = hits.find((h) => (hasBrand && h.brands.length) || h.matched.length >= 2);
    if (strong) {
      let start = Math.max(0, strong.to - 45);
      if (danmaku?.length) {
        const win = danmaku.filter((d) => d.time >= strong.to - 90 && d.time <= strong.to);
        for (const d of win) {
          if (AD_START.some((k) => d.text.includes(k)) || generalKw().some((k) => d.text.includes(k))) {
            start = Math.min(start, d.time);
          }
        }
      }
      let end = strong.to;
      if (hasBrand && strong.brands.length) {
        start = Math.max(0, strong.from - PAD_START);
        end = duration > 0
          ? Math.min(duration - SEG_TAIL_GUARD_SEC - 0.1, strong.to + PAD_END)
          : strong.to + PAD_END;
      }
      return clampSub({
        start,
        end,
        source: (hasBrand && strong.brands.length) ? 'subtitle-brand' : 'subtitle-cta',
      });
    }
    return null;
  }

  function skipIfPlayingInSegs() {
    const v = getVideoEl();
    if (!v || !Number.isFinite(v.currentTime)) return false;
    const t = v.currentTime;
    const pool = activeSegs.length ? activeSegs : (activeSeg ? [activeSeg] : []);
    for (const seg of pool) {
      // 勿 force：否则会清掉 skippedKeys / 绕过撤销禁跳
      if (isAutoSkipBlocked(seg)) continue;
      if (t >= seg.start - 0.6 && t < seg.end - 0.4) {
        doSkip(seg, false);
        return true;
      }
    }
    return false;
  }

  function statusForUi() {
    // 撤销后以 statusText 为准，勿再被 lastSkip 盖成「已跳过」
    if (/^已撤销|^无可撤销/.test(statusText)) return statusText;
    if (lastSkip?.seg) {
      const s = lastSkip.seg;
      return `已跳过 ${formatTime(s.start)} → ${formatTime(s.end)} (${s.source || ''})`;
    }
    return statusText;
  }

  function setStatus(text) {
    statusText = text;
    const el = document.getElementById('mas-status');
    if (el) el.textContent = text;
  }

  function hidePanel() {
    if (panelDragHandlers) {
      window.removeEventListener('mousemove', panelDragHandlers.move);
      window.removeEventListener('mouseup', panelDragHandlers.up);
      panelDragHandlers = null;
    }
    if (!panelEl) return;
    panelEl.remove();
    panelEl = null;
  }

  function resetPlaybackState() {
    analyzeGen += 1;
    seekSerial += 1;
    lastKey = '';
    activeSeg = null;
    activeSegs = [];
    skippedKeys = new Set();
    // 撤销语义：本片内禁止再自动跳；仅「本集不跳」会连同 undoneKeys 一起清空
    lastSkip = null;
    softOralReady = false;
    if (pendingSkip?.timer) clearTimeout(pendingSkip.timer);
    pendingSkip = null;
    dismissMasToast(document.getElementById('mas-undo-toast'));
    dismissMasToast(document.getElementById('mas-skip-toast'));
  }

  function currentBvidFromUrl() {
    const m = location.pathname.match(/\/video\/(BV[\w]+)/i);
    return m ? m[1] : '';
  }

  /** SPA 监听键：B站忽略 t=/追踪参数，避免播放进度改 URL 时反复清空跳点 */
  function spaWatchKey() {
    if (IS_BILI) {
      const id = currentBvidFromUrl()
        || (String(location.hash || '').match(/BV[\w]+/i) || [])[0]
        || (location.pathname.match(/\/bangumi\/play\/([^/?#]+)/i) || [])[1]
        || location.pathname;
      const p = new URLSearchParams(location.search).get('p') || '';
      return `${String(id).toUpperCase()}|${p}`;
    }
    return location.pathname + location.search;
  }

  function analysisStillCurrent(gen, expectBvid) {
    if (gen !== analyzeGen) return false;
    if (!expectBvid || !IS_BILI) return true;
    const live = currentBvidFromUrl();
    if (!live) return true;
    return live.toUpperCase() === String(expectBvid).toUpperCase();
  }

  // -------------------- time-text clustering (shared) --------------------
  /**
   * 从文本列表里找「跳到某时刻」的共识终点，再估广告段。
   * @param {{time?:number,text:string}[]} items  time=弹幕出现时刻；评论可无 time
   * @param {number} duration
   */
  function detectFromJumpTexts(items, duration) {
    const votes = new Map(); // endSec -> score
    const ctxScore = new Map();
    const pairs = [];
    const seenText = new Set();

    for (const it of items) {
      const info = extractTimeFromText(it.text);
      if (!info) continue;
      const end = Math.round(info.time);
      if (end <= 0 || (duration > 0 && end >= duration - 5)) continue;
      const text = String(it.text || '').replace(/\s+/g, '');
      const dedupeKey = `${end}|${text}`;
      if (seenText.has(dedupeKey)) continue;
      seenText.add(dedupeKey);

      let score = info.conf;
      const adCtx = /(广告|恰饭|赞助|商单|正片|金主|软广)/.test(text);
      const langTip = /(?:谢谢|感谢).{0,12}分|(?:\d)\s*分\s*\d{1,2}\s*(?:郎|君)/.test(text);
      if (/(空降(?!兵)|跳过|快进|广告|恰饭|指路|谢谢|感谢)/.test(text)) {
        score += adCtx || langTip ? 0.8 : 0.25;
      }
      votes.set(end, (votes.get(end) || 0) + score);
      if (adCtx || langTip) ctxScore.set(end, (ctxScore.get(end) || 0) + score);

      if (typeof it.time === 'number' && !Number.isNaN(it.time)) {
        pairs.push({ start: it.time, end, score });
      }
    }

    if (votes.size === 0) return null;

    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [bestEnd, bestScore] = ranked[0];
    // 弱票（裸时间戳）再多也难过门槛；要空降词/郎体等抬分
    if (bestScore < JUMP_VOTE_MIN_SCORE) return null;

    // 用弹幕出现时刻估广告起点；否则默认 end-60
    let start = Math.max(0, bestEnd - 60);
    const related = pairs.filter((p) => Math.abs(p.end - bestEnd) <= 2 && p.end - p.start >= 20);
    if (related.length) {
      related.sort((a, b) => a.start - b.start);
      start = related[0].start + 2;
    }

    // 纯剧透空降（无广告/郎语境）禁止拉超长段
    if ((ctxScore.get(bestEnd) || 0) < 0.9 && bestEnd - start > MAX_SUBTITLE_AD_SEC) return null;

    const seg = { start, end: bestEnd, source: 'timestamp' };
    return validSeg(seg, duration) ? seg : null;
  }

  function detectFromKeywords(items, duration) {
    const starts = [];
    const ends = [];
    const generals = [];
    const cueKw = generalCueKw();

    for (const it of items) {
      const t = (it.text || '').trim();
      const time = typeof it.time === 'number' ? it.time : null;
      if (time == null) continue;
      if (AD_START.some((k) => t.includes(k))) starts.push(time);
      if (AD_END.some((k) => t.includes(k))) ends.push(time);
      if (isWeakAdGossip(t)) continue;
      if (cueKw.some((k) => t.includes(k))) generals.push(time);
    }

    const sc = findDenseCluster(starts, 20, 2);
    const ec = findDenseCluster(ends, 20, 2);
    if (sc && ec && ec.center > sc.center) {
      const seg = { start: sc.start, end: ec.end, source: 'keyword' };
      if (validSeg(seg, duration)) return seg;
    }

    // 泛词簇：窗口收紧 + 至少 4 条，避免「广告吗」吐槽刷屏误跳
    const gc = findDenseCluster(generals, 50, 4);
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
        <button type="button" data-mas-act="skip" id="mas-skip-now" class="mas-btn mas-btn-primary">立即跳过</button>
        <button type="button" data-mas-act="reanalyze" id="mas-reanalyze" class="mas-btn mas-btn-ghost">重新分析</button>
        <button type="button" data-mas-act="undo" id="mas-undo" class="mas-btn mas-btn-ghost" title="这是一场试炼……">撤销跳过</button>
        <button type="button" data-mas-act="block" id="mas-block" class="mas-btn mas-btn-ghost">本集不跳</button>
        <button type="button" data-mas-act="wrong" id="mas-wrong" class="mas-btn mas-btn-ghost">标错了</button>
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
    bindMasActions(panelEl, {
      skip: () => {
        if (activeSeg) doSkip(activeSeg, true);
        else if (softOralReady) softSkipForward();
        else setStatus(statusText.includes('分析') ? '还在分析，稍后再点' : '暂无跳点（本片未识别到广告段）');
      },
      reanalyze: () => {
        resetPlaybackState();
        if (IS_BILI) runBilibili();
        else douyinAnalyzeInVideo();
      },
      undo: () => undoLastSkip(),
      block: () => blockCurrentVideo(),
      wrong: () => { reportWrongMark(); },
    });

    // 简易拖拽（window 监听挂引用，hidePanel 时移除，防反复开关堆积）
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
    panelDragHandlers = {
      move: (e) => {
        if (!dragging || !panelEl) return;
        panelEl.style.left = `${Math.max(0, e.clientX - ox)}px`;
        panelEl.style.top = `${Math.max(0, e.clientY - oy)}px`;
        panelEl.style.right = 'auto';
      },
      up: () => { dragging = false; },
    };
    window.addEventListener('mousemove', panelDragHandlers.move);
    window.addEventListener('mouseup', panelDragHandlers.up);
  }

  function showSkipToast(seg) {
    showUpcomingToast(seg, { withActions: true });
  }

  function segKey(seg) {
    return `${Math.round(seg.start)}-${Math.round(seg.end)}`;
  }

  function markSegUndone(skipped) {
    if (!skipped) return;
    const key = skipped.key || (skipped.seg ? segKey(skipped.seg) : '');
    if (key) {
      skippedKeys.add(key);
      undoneKeys.add(key);
    }
    const seg = skipped.seg;
    if (seg && seg.start != null && seg.end != null) {
      undoneRange = { start: seg.start - 1, end: seg.end + 1 };
    }
  }

  /** 本片永久拒绝的段 key：chrome.storage.local / localStorage，按视频 ID 分桶 */
  let rejectSegMap = null;
  let rejectMapLoading = false;
  let rejectMapLoadingAt = 0;

  function writeRejectMap(map) {
    rejectSegMap = map;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ masRejectSegs: map });
        return;
      }
      localStorage.setItem('mas-reject-segs', JSON.stringify(map));
    } catch { /* ignore */ }
  }

  function ensureRejectMap(cb) {
    if (rejectSegMap) {
      cb?.(rejectSegMap);
      return;
    }
    if (rejectMapLoading) {
      // storage 永不回调时兜底空表，防 80ms 无限重试
      if (Date.now() - rejectMapLoadingAt > 4000) {
        rejectSegMap = {};
        rejectMapLoading = false;
        cb?.(rejectSegMap);
        return;
      }
      setTimeout(() => ensureRejectMap(cb), 80);
      return;
    }
    rejectMapLoading = true;
    rejectMapLoadingAt = Date.now();
    const finish = (raw) => {
      rejectSegMap = raw && typeof raw === 'object' ? raw : {};
      rejectMapLoading = false;
      cb?.(rejectSegMap);
    };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['masRejectSegs'], (data) => finish(data?.masRejectSegs));
        return;
      }
      finish(JSON.parse(localStorage.getItem('mas-reject-segs') || '{}'));
    } catch {
      finish({});
    }
  }

  function applyRejectsToSession(videoId) {
    if (!videoId) return;
    ensureRejectMap((map) => {
      const list = map[String(videoId)] || [];
      for (const k of list) {
        undoneKeys.add(k);
        skippedKeys.add(k);
      }
    });
  }

  function rejectSegForever(skipped) {
    markSegUndone(skipped);
    const vid = currentVideoId();
    const key = skipped?.key || (skipped?.seg ? segKey(skipped.seg) : '');
    if (!vid || !key) {
      setStatus('已标记本段不再跳（仅本次）');
      return;
    }
    ensureRejectMap((map) => {
      const id = String(vid);
      const list = Array.isArray(map[id]) ? map[id].slice() : [];
      if (!list.includes(key)) list.push(key);
      map[id] = list.slice(-40);
      const ids = Object.keys(map);
      if (ids.length > 80) {
        for (const old of ids.slice(0, ids.length - 80)) delete map[old];
      }
      writeRejectMap(map);
      setStatus('已记住：本段不再自动跳');
    });
  }

  function forgetRejectKey(videoId, key) {
    if (!videoId || !key) return;
    ensureRejectMap((map) => {
      const id = String(videoId);
      const list = Array.isArray(map[id]) ? map[id].filter((k) => k !== key) : [];
      if (list.length) map[id] = list;
      else delete map[id];
      writeRejectMap(map);
    });
  }

  function isAutoSkipBlocked(seg) {
    if (!seg) return false;
    const key = segKey(seg);
    if (skippedKeys.has(key) || undoneKeys.has(key)) return true;
    if (undoneRange && seg.end > undoneRange.start && seg.start < undoneRange.end) return true;
    return false;
  }

  function doSkip(seg, force) {
    if (!seg) return;
    const key = segKey(seg);
    if (!force && isAutoSkipBlocked(seg)) return;
    if (force) {
      skippedKeys.delete(key);
      undoneKeys.delete(key);
      if (undoneRange && seg.end > undoneRange.start && seg.start < undoneRange.end) {
        undoneRange = null;
      }
      forgetRejectKey(currentVideoId(), key);
    }
    if (pendingSkip?.key === key) {
      const target = pendingSkip.target;
      if (pendingSkip.timer) clearInterval(pendingSkip.timer);
      if (seekTo(target)) {
        const fromTime = getVideoEl()?.currentTime ?? seg.start;
        skippedKeys.add(key);
        lastSkip = { fromTime, toTime: target, key, seg };
        pendingSkip = null;
        setStatus(`已跳过 ${formatTime(seg.start)} → ${formatTime(seg.end)}`);
      }
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
      const startLabel = formatTime(seg.start ?? fromTime);
      setStatus(`已跳过 ${startLabel} → ${formatTime(seg.end)} (${seg.source || ''})`);
      const saved = Math.max(0, (seg.end ?? target) - (seg.start ?? fromTime));
      recordStat({ skip: 1, savedSec: saved });
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
      if (document.hidden) return;
      if (!activeSegs.length && !activeSeg) return;
      const v = getVideoEl();
      if (!v) return;
      const t = v.currentTime;
      const pool = activeSegs.length ? activeSegs : (activeSeg ? [activeSeg] : []);
      for (const seg of pool) {
        const key = segKey(seg);
        if (isAutoSkipBlocked(seg) || pendingSkip?.key === key) continue;
        if (t >= seg.start - 0.4 && t < seg.end - 1) {
          activeSeg = seg;
          if (cfg.autoSkip) doSkip(seg, false);
          else showSkipToast(seg);
          break;
        }
      }
    };
    setInterval(tick, IS_DOUYIN ? 1200 : 800);
  }

  // ==================== Bilibili ====================
  async function biliFetchJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    return res.json();
  }

  async function biliGetVideoMeta() {
    const state = window.__INITIAL_STATE__ || {};
    const p = Math.max(1, parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1);

    let bvid = (location.pathname.match(/\/video\/(BV[\w]+)/i) || [])[1]
      || (String(location.hash || '').match(/BV[\w]+/i) || [])[0]
      || state.bvid
      || state.videoData?.bvid
      || state.epInfo?.bvid
      || null;

    // 番剧 ep/ss：优先 INITIAL_STATE，再打 pgc API
    if (!bvid) {
      const epId = (location.pathname.match(/\/bangumi\/play\/ep(\d+)/i) || [])[1]
        || state.epInfo?.id
        || state.epInfo?.ep_id;
      if (epId) {
        try {
          const epJson = await biliFetchJson(
            `https://api.bilibili.com/pgc/view/web/season?ep_id=${encodeURIComponent(epId)}`,
          );
          const view = epJson?.result || epJson?.data;
          const ep = view?.episodes?.find((e) => String(e.id) === String(epId))
            || view?.episodes?.find((e) => String(e.ep_id) === String(epId))
            || state.epInfo;
          bvid = ep?.bvid || view?.bvid || null;
          if (ep?.cid && bvid) {
            return {
              bvid,
              cid: ep.cid,
              mid: view?.up_info?.mid || ep.up_info?.mid || null,
              desc: view?.evaluate || view?.alias || '',
              duration: ep.duration ? ep.duration / 1000 : (ep.durationSeconds || 0),
              title: ep.long_title || ep.share_copy || view?.title || '',
            };
          }
        } catch (e) {
          log('bangumi meta fail', e);
        }
      }
    }

    if (!bvid && state.epInfo?.cid) {
      return {
        bvid: state.epInfo.bvid || `ep${state.epInfo.id || state.epInfo.ep_id || ''}`,
        cid: state.epInfo.cid,
        mid: state.mediaInfo?.up_info?.mid || null,
        desc: state.mediaInfo?.evaluate || '',
        duration: (state.epInfo.duration || 0) / (state.epInfo.duration > 10000 ? 1000 : 1),
        title: state.epInfo.long_title || state.mediaInfo?.title || '',
      };
    }

    if (!bvid) return null;
    const json = await biliFetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const pages = Array.isArray(d.pages) ? d.pages : [];
    const page = pages[p - 1] || pages[0];
    return {
      bvid,
      cid: page?.cid || d.cid,
      aid: d.aid || null,
      mid: d.owner?.mid ?? d.owner_mid ?? null,
      desc: d.desc || '',
      duration: page?.duration || d.duration || 0,
      title: d.title || '',
      page: p,
    };
  }

  async function biliFetchDanmaku(cid, duration) {
    // 优先 XML（兼容性好）
    try {
      const res = await fetch(`https://comment.bilibili.com/${cid}.xml`);
      const text = await res.text();
      // 超大弹幕 XML 同步 parse 会卡死主线程 → 标签页崩溃
      if (text.length > MAX_DANMAKU_XML) {
        log('danmaku xml too large, skip', text.length);
        return [];
      }
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const nodes = doc.getElementsByTagName('d');
      const max = Math.min(nodes.length, 1800);
      const list = [];
      for (let i = 0; i < max; i += 1) {
        const d = nodes[i];
        list.push({
          time: parseFloat((d.getAttribute('p') || '0').split(',')[0]),
          text: d.textContent || '',
        });
      }
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
      // type 1 = UP主官方报备的广告时段（播放器左上角「广告」标），最高精度
      if (ch.type === 1 || labelLooksAd(ch.content)) {
        return { start: ch.from, end: ch.to, source: ch.type === 1 ? 'chapter-official-ad' : 'chapter' };
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
  function detectFromCreatorMarks(text, duration, opts) {
    if (!text) return null;
    const raw = String(text);
    // timelineOnly：只认结构化时间轴列表（评论用），不跑单行松散正则
    const timelineOnly = !!opts?.timelineOnly;
    const AD = /(广告|恰饭|赞助|商单|推广|软广|合作方|金主|片头广告)/i;
    const OK = /(正片|正文|开始|开讲|上车|回归|谢谢收看)/i;

    if (!timelineOnly) {
      // 区间：广告 1:00-2:30 / 1:00~2:30 恰饭 / 【广告】0:00—1:20
      let m = raw.match(/(?:广告|恰饭|赞助|商单|推广|软广)[^0-9]{0,12}(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})/i)
        || raw.match(/(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})[^\n]{0,12}(?:广告|恰饭|赞助|商单|推广)/i);
      if (m) {
        const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
        const seg = { start, end, source: 'creator-range' };
        if (end - start > MAX_AD_SEC) return null;
        if (validSeg(seg, duration) || (end > start && end - start >= 8)) return seg;
      }

      // 结束点：恰饭到 2:15 / 广告结束 1:30 → 片头到该点（勿臆造中插）
      m = raw.match(/(?:广告|恰饭|赞助|商单)[^0-9]{0,8}(?:到|至|结束(?:于|在)?|完(?:于|在)?)[^0-9]{0,6}(\d{1,2})[:：](\d{2})/i);
      if (m) {
        const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const seg = { start: 0.1, end, source: 'creator-end' };
        if (end >= 8 && end <= MAX_AD_SEC && end < (duration || 99999) - 3) return seg;
      }
      // 正片从 2:00 / 正文开始于 1:30（连接词必填，防评论误伤）
      m = raw.match(/(?:正片|正文)\s*(?:从|自|开始于?|起于?|开始)\s*(\d{1,2})[:：](\d{2})/i);
      if (m) {
        const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const seg = { start: 0.1, end, source: 'creator-end' };
        if (end >= 8 && end <= MAX_AD_SEC && end < (duration || 99999) - 3) return seg;
      }
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

    const END_MARK = /(跳过广告|广告结束|广告完了?|正片|回归正片|正片开始)/;
    for (let i = 0; i < entries.length; i++) {
      const label = entries[i].label;
      const isEndMark = END_MARK.test(label);
      const isAd = !isEndMark && (AD.test(label) || labelLooksAd(label));
      // 评论时间轴：标签必须自带广告词，不吃「首行兜底」
      if (!isAd && !isEndMark && (timelineOnly || !(i === 0 && AD.test(raw.slice(0, 80)) && entries[i].start <= 5))) continue;

      // 「01:51 跳过广告」：T 是广告结束点，不是起点
      if (isEndMark) {
        const end = entries[i].start;
        const prev = entries[i - 1];
        const prevIsAdStart = prev && !END_MARK.test(prev.label) && (AD.test(prev.label) || labelLooksAd(prev.label));
        const start = prevIsAdStart ? prev.start : Math.max(0, end - 60);
        const seg = { start, end, source: 'creator-timeline', startEstimated: !prevIsAdStart };
        if (end - start > MAX_AD_SEC) continue;
        if (end > start && end - start >= 8) return seg;
        continue;
      }

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
      if (end - start > MAX_AD_SEC) continue;
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

  /**
   * 置顶/UP自评/热评里的时间轴（「01:51 跳过广告」式）。
   * 高精度：只跑结构化时间轴，不跑松散正则；不受 useCreatorMarks 开关影响。
   */
  async function biliFetchTimelineComment(aid, ownerMid) {
    if (!aid) return '';
    try {
      const res = await fetch(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3&ps=10`);
      const json = await res.json();
      const replies = [
        ...(json?.data?.top_replies || []),
        ...(json?.data?.replies || []),
      ];
      const picked = [];
      for (const r of replies.slice(0, 10)) {
        const msg = String(r?.content?.message || '');
        if (!msg || msg.length > 600) continue;
        const isUp = ownerMid && String(r?.member?.mid) === String(ownerMid);
        const hot = (r?.like || 0) >= 20;
        if (!isUp && !hot && !r?.reply_control?.is_top && !r?.is_top) continue;
        if (!/\d{1,2}[:：]\d{2}/.test(msg)) continue;
        if (!/(广告|恰饭|赞助|商单|正片|跳过)/.test(msg)) continue;
        picked.push(msg);
      }
      return picked.join('\n');
    } catch (e) {
      log('timeline comment fail', e);
      return '';
    }
  }

  async function fetchSponsorBlock(bvid) {
    try {
      if (cfg.useSponsorBlock === false) return [];
      const url = `https://bsbsb.top/api/skipSegments?videoID=${encodeURIComponent(bvid)}&categories=${encodeURIComponent(JSON.stringify(['sponsor']))}`;
      const data = await gmFetchJson(url);
      if (!Array.isArray(data)) return [];
      // 镜像库常见 votes=0；丢掉差评与过短碎片（曾出现 5s「三段」噪音）
      return data
        .filter((s) => s.actionType === 'skip' && s.category === 'sponsor' && (s.votes ?? 0) >= 0)
        .map((s) => ({
          start: s.segment[0],
          end: s.segment[1],
          source: 'sponsorblock',
          votes: s.votes ?? 0,
        }))
        .filter((s) => s.end - s.start >= MIN_AD_SEC && s.end - s.start <= MAX_AD_SEC)
        .sort((a, b) => a.start - b.start);
    } catch (e) {
      log('sponsorblock fail', e);
      return [];
    }
  }

  /**
   * B站主流程：SB → 章节 → 评论时间轴 → 字幕；（可选）简介自标 / 弹幕。
   * 简介与弹幕默认关：多数视频不写恰饭轴，弹幕则易剧透/吐槽误伤。
   * 评论时间轴（置顶/UP/热评的 mm:ss 列表）高精度，始终启用。
   * 全程用 analyzeGen：换片后旧请求回来必须丢弃，否则会串台误跳。
   */
  async function runBilibili(forceKey) {
    const gen = analyzeGen;
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
    if (!analysisStillCurrent(gen, meta?.bvid)) return;
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
    // 重分析不得抹掉本片已撤销段，否则点过撤销会再自动跳
    activeSeg = null;
    activeSegs = [];
    applyRejectsToSession(meta.bvid);

    const wantDm = cfg.useDanmakuDetect === true;
    const [danmaku, player, sbSegs, timelineComment] = await Promise.all([
      wantDm ? biliFetchDanmaku(meta.cid, meta.duration) : Promise.resolve([]),
      biliFetchPlayer(meta.bvid, meta.cid),
      fetchSponsorBlock(meta.bvid),
      biliFetchTimelineComment(meta.aid, meta.mid),
    ]);
    if (!analysisStillCurrent(gen, meta.bvid)) return;
    const { viewPoints, subtitles } = player;
    log('bili', meta.bvid, 'dm', danmaku.length, 'sb', sbSegs.length, 'dmDetect', wantDm, 'tl', !!timelineComment);

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
    if (!analysisStillCurrent(gen, meta.bvid)) return;

    const pipeline = [
      () => detectFromChapters(viewPoints),
      ...(cfg.useCreatorMarks === true ? [() => detectFromDesc(meta.desc, meta.duration)] : []),
      // 置顶/UP/热评时间轴：高精度，独立开关外
      () => (timelineComment ? detectFromCreatorMarks(timelineComment, meta.duration, { timelineOnly: true }) : null),
      () => detectFromSubtitles(subtitleLines, wantDm ? danmaku : [], meta.duration),
      ...(wantDm ? [
        () => detectFromJumpTexts(danmaku, meta.duration),
        () => detectFromKeywords(danmaku, meta.duration),
      ] : []),
    ];

    for (const step of pipeline) {
      let seg = await step();
      if (!analysisStillCurrent(gen, meta.bvid)) return;
      // 结束点时间轴的起点是估的：用「恭喜接广」弹幕校准（此时才按需拉弹幕）
      if (seg?.startEstimated) {
        try {
          const dm = danmaku.length ? danmaku : await biliFetchDanmaku(meta.cid, meta.duration);
          if (!analysisStillCurrent(gen, meta.bvid)) return;
          const hits = dm
            .filter((d) => d.time >= seg.end - 180 && d.time < seg.end
              && /(恭喜接广|恭喜.{0,4}恰饭|接到广|接广了)/.test(d.text || ''))
            .sort((a, b) => a.time - b.time);
          if (hits.length) {
            seg = { ...seg, start: Math.max(0, hits[0].time - 5), startEstimated: false };
          }
        } catch { /* ignore */ }
      }
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
    let nodes;
    try {
      nodes = root.querySelectorAll('button, [role="button"]');
    } catch {
      return null;
    }
    const max = Math.min(nodes.length, 40);
    for (let i = 0; i < max; i += 1) {
      const el = nodes[i];
      const t = lightText(el, 20, 4).replace(/\s+/g, ' ').trim();
      if (!t || t.length > 16) continue;
      if (texts.some((x) => t === x || t.includes(x))) return el;
    }
    return null;
  }

  /** 信息流下一则：先点官方下一条；未换卡再补方向键（勿对 video 派发 wheel，易触 GPU 崩） */
  function swipeToNextFeed(opts = {}) {
    const noRetry = !!opts.noRetry;
    const hard = !!opts.hard;
    const before = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';

    const nextBtn = document.querySelector(
      '[data-e2e="video-switch-next-arrow"], [data-e2e="feed-scroll-down"],'
      + '.xgplayer-playswitch-next, button[aria-label*="下"]',
    );
    let clicked = false;
    if (nextBtn) {
      try {
        nextBtn.click();
        clicked = true;
      } catch { /* ignore */ }
    }

    if (!clicked || hard) pressFeedNextKey();

    if (noRetry) return;
    setTimeout(() => {
      const after = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
      if (before && after === before) swipeToNextFeed({ hard: true, noRetry: true });
    }, 280);
  }

  function pressFeedNextKey() {
    const opts = {
      key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
      bubbles: true, cancelable: true,
    };
    // 只打 body，避免对 video 合成层狂发事件
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch { /* ignore */ }
  }

  /** 有预算地摘文本 */
  function lightText(root, maxLen = 160, maxNodes = 18) {
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

  /** 当前卡是否还有正片短视频（非 LivePlayer 内）——只查节点，不碰 getBoundingClientRect */
  function feedHasMainShortVideo(root) {
    try {
      const scope = root || getActiveFeedRoot();
      if (!scope?.querySelectorAll) return false;
      const videos = scope.querySelectorAll('video');
      const max = Math.min(videos.length, 4);
      for (let i = 0; i < max; i += 1) {
        if (!videos[i].closest?.('[class*="LivePlayer"]')) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  /** 整卡直播：有 LivePlayer 且无并列正片 video（不读布局，防合成层崩） */
  function livePlayerLooksFullFeed(root) {
    if (!root?.querySelector) return false;
    try {
      if (feedHasMainShortVideo(root)) return false;
      return !!root.querySelector('[class*="LivePlayer"]');
    } catch {
      return false;
    }
  }

  /**
   * 弹窗直播闸：正片 video 还在就不划。
   * Crashpad：renderer FATAL raw_hash_map + video-capture GPU；禁止布局探测。
   */
  function isPopupLiveOverlay(root) {
    try {
      return feedHasMainShortVideo(root);
    } catch { /* ignore */ }
    return false;
  }

  /**
   * 已禁用：elementFromPoint 打在视频合成层上会触发 Chrome renderer FATAL
   *（Crashpad: raw_hash_map<>::at / end() iterator + gpu video）。
   */
  function probeViewportText() {
    return [];
  }

  const AD_BADGE_SVG_PREFIX = 'M9.492 2.004';
  function detectAdSvgInRoot(root) {
    if (!root?.querySelector) return false;
    try {
      return !!root.querySelector(`path[d^="${AD_BADGE_SVG_PREFIX}"]`);
    } catch {
      return false;
    }
  }

  /**
   * 推荐流分类：只走选择器 / SVG，禁止 elementFromPoint。
   */
  function classifyActiveFeed(needLive) {
    const out = { ad: false, live: false, shop: false };
    const root = getActiveFeedRoot();
    if (!root) return out;
    if (detectAdSvgInRoot(root)) out.ad = true;
    try {
      if (root.querySelector('[data-e2e="video-cart-entry"]')) out.shop = true;
    } catch { /* ignore */ }

    if (out.ad && !needLive) return out;

    if (needLive && !isPopupLiveOverlay(root) && livePlayerLooksFullFeed(root)) {
      out.live = true;
    }

    try {
      const info = root.querySelector?.('[data-e2e="video-info"], .account');
      if (info) {
        const blob = lightText(info, 80, 10);
        if (/查看详情|立即购买|去购买/.test(blob)) out.shop = true;
      }
    } catch { /* ignore */ }

    if (out.live && feedHasMainShortVideo(root)) out.live = false;
    return out;
  }

  /** feed 接口标记缓存（主路径） */
  const awemeMeta = new Map();
  function rememberAwemeFlags(id, ad, shop, live) {
    if (!id) return;
    awemeMeta.set(id, { ad: !!ad, shop: !!shop, live: !!live, ts: Date.now() });
    if (awemeMeta.size > 180) {
      let n = 0;
      for (const k of awemeMeta.keys()) {
        awemeMeta.delete(k);
        if (++n >= 40) break;
      }
    }
  }

  function ingestFeedJsonLight(text) {
    // 只抽 aweme_id 附近片段打标，禁止整包 JSON.parse
    if (!text || text.length < 40 || text.length > MAX_FEED_BODY) return;
    if (!/"aweme_id"/.test(text)) return;
    const idRe = /"aweme_id"\s*:\s*"?(\d{6,})"?/g;
    let m;
    let count = 0;
    while ((m = idRe.exec(text)) && count < 16) {
      count += 1;
      const id = m[1];
      const i = m.index;
      const slice = text.slice(Math.max(0, i - 280), Math.min(text.length, i + 900));
      rememberAwemeFlags(
        id,
        /"is_ads"\s*:\s*true/.test(slice) || /"raw_ad_data"\s*:/.test(slice),
        /"title_tag"\s*:\s*"购物"/.test(slice) || /brand_ad/.test(slice),
        // 仅整卡直播 aweme_type=101；cell_room 常见于「作者在播」挂件，勿当直播卡
        /"aweme_type"\s*:\s*101/.test(slice),
      );
    }
  }

  function ingestFeedJson(text) {
    if (!text || text.length < 40 || text.length > MAX_FEED_BODY) return;
    const run = () => { try { ingestFeedJsonLight(text); } catch { /* ignore */ } };
    // 尽快打标，划走才跟得上；仍异步，不堵 fetch
    try { setTimeout(run, 0); } catch { try { run(); } catch { /* ignore */ } }
  }

  function looksLikeFeedApiUrl(url) {
    return /\/aweme\/v\d+\/web\/(?:tab\/)?feed/i.test(String(url || ''));
  }

  function feedResponseTooLarge(headersLike) {
    try {
      const raw = headersLike?.get?.('content-length')
        || headersLike?.['content-length']
        || headersLike?.getResponseHeader?.('content-length');
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > MAX_FEED_BODY;
    } catch {
      return false;
    }
  }

  function installDouyinFeedHooks() {
    if (installDouyinFeedHooks._done) return;
    if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop) return;
    installDouyinFeedHooks._done = true;
    try {
      const xo = XMLHttpRequest.prototype.open;
      const xs = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        try { this.__masFeed = looksLikeFeedApiUrl(url); } catch { this.__masFeed = false; }
        return xo.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        if (this.__masFeed && !this.__masFeedHooked) {
          this.__masFeedHooked = true; // 同一 XHR 复用 send 时只挂一次
          this.addEventListener('load', () => {
            try {
              if (feedResponseTooLarge(this)) return;
              const t = this.responseText;
              if (typeof t === 'string' && t.length > 40 && t.length <= MAX_FEED_BODY) ingestFeedJson(t);
            } catch { /* ignore */ }
          });
        }
        return xs.apply(this, args);
      };
    } catch { /* ignore */ }
    try {
      const ofetch = window.fetch;
      if (typeof ofetch !== 'function') return;
      window.fetch = function (...args) {
        const p = ofetch.apply(this, args);
        try {
          const u = String(args[0]?.url || args[0] || '');
          if (looksLikeFeedApiUrl(u)) {
            p.then((r) => {
              try {
                if (!r || feedResponseTooLarge(r.headers)) return '';
                return r.clone().text();
              } catch { return ''; }
            })
              .then((t) => {
                if (typeof t === 'string' && t.length > 40 && t.length <= MAX_FEED_BODY) ingestFeedJson(t);
              })
              .catch(() => {});
          }
        } catch { /* ignore */ }
        return p;
      };
    } catch { /* ignore */ }
  }

  let lastFeedSkipAt = 0;
  let lastFeedSkipKey = '';
  let lastSkippedAwemeId = '';
  let lastFeedAwemeId = '';
  let feedTickBusy = false;

  function scheduleFeedRecheck(awemeId) {
    if (!awemeId) return;
    clearTimeout(scheduleFeedRecheck._t1);
    clearTimeout(scheduleFeedRecheck._t2);
    // 短+中两次：DOM/徽章晚出现时别干等一轮长轮询
    scheduleFeedRecheck._t1 = setTimeout(() => {
      if (getDouyinAwemeId() === awemeId) douyinFeedTick({ urgent: true });
    }, 140);
    scheduleFeedRecheck._t2 = setTimeout(() => {
      if (getDouyinAwemeId() === awemeId && awemeId !== lastSkippedAwemeId) {
        douyinFeedTick({ urgent: true });
      }
    }, 400);
  }

  function douyinFeedTick(opts = {}) {
    if (!IS_DOUYIN || document.hidden || feedTickBusy) return;
    if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop && !cfg.douyinInVideo) return;
    const now = Date.now();
    const urgent = !!opts.urgent;
    const awemeId = getDouyinAwemeId();

    if (awemeId && awemeId === lastSkippedAwemeId && now - lastFeedSkipAt < 700) return;
    if (!urgent && now - lastFeedSkipAt < 450) return;

    if (awemeId && awemeId !== lastFeedAwemeId) {
      lastFeedAwemeId = awemeId;
      if (!urgent) scheduleFeedRecheck(awemeId);
    }

    feedTickBusy = true;
    try {
      // 官方「跳过广告」按钮：仅详情/长视频上下文才扫，推荐流免扫
      if (cfg.douyinInVideo && shouldAnalyzeDouyinInVideo()) {
        const btn = findClickableByText(SKIP_BTN_TEXT);
        if (btn && clickIfVisible(btn)) {
          lastFeedSkipAt = now;
          setStatus('已点跳过广告');
          return;
        }
      }

      if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop) return;

      const meta = awemeId ? awemeMeta.get(awemeId) : null;
      let adHit = !!(meta?.ad);
      let liveHit = !!(meta?.live);
      let shopHit = !!(meta?.shop);

      const needDom = (!adHit && cfg.douyinFeedAd)
        || (!shopHit && cfg.douyinFeedShop)
        || (cfg.douyinFeedLive && !liveHit);
      // 有 API 标记时优先信缓存，减少 elementFromPoint
      if (needDom && !(adHit || shopHit || liveHit)) {
        const card = classifyActiveFeed(!!cfg.douyinFeedLive);
        adHit = adHit || card.ad;
        liveHit = liveHit || card.live;
        shopHit = shopHit || card.shop;
      } else if (needDom) {
        // 缺某一类时只补缺的，且 live 关则不打 live 点
        const card = classifyActiveFeed(!!cfg.douyinFeedLive && !liveHit);
        if (!adHit) adHit = card.ad;
        if (!liveHit) liveHit = card.live;
        if (!shopHit) shopHit = card.shop;
      }

      // 弹窗/浮层/正片仍在：绝不按直播划走
      if (liveHit) {
        const feedRoot = getActiveFeedRoot();
        if (isPopupLiveOverlay(feedRoot) || feedHasMainShortVideo(feedRoot)) {
          liveHit = false;
        }
      }

      let reason = '';
      if (cfg.douyinFeedAd && adHit) reason = '信息流广告';
      else if (cfg.douyinFeedShop && shopHit) reason = '购物卡';
      else if (cfg.douyinFeedLive && liveHit) reason = '直播卡';
      else if (!cfg.douyinFeedLive && liveHit) {
        if (!douyinFeedTick._liveHintAt || now - douyinFeedTick._liveHintAt > 15000) {
          douyinFeedTick._liveHintAt = now;
          setStatus('直播卡 · 请打开「划走直播」');
          showEnableLiveSwipeToast();
        }
        return;
      } else return;

      const key = `${awemeId || ''}:${reason}`;
      if (key === lastFeedSkipKey && now - lastFeedSkipAt < 1600) return;
      lastFeedSkipKey = key;
      lastFeedSkipAt = now;
      const beforeId = awemeId || '';
      // 先滑，确认换卡后再提示
      swipeToNextFeed();
      afterFeedSwiped(beforeId, reason);
    } catch { /* ignore */ } finally {
      feedTickBusy = false;
    }
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
    const cap = (lines) => (lines.length > 800 ? lines.slice(0, 800) : lines);
    if (Array.isArray(payload)) {
      return cap(payload.map((x) => {
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
      }).filter((l) => l.content));
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
    if (text.length > 500_000 || !text.includes('-->')) return [];
    const lines = [];
    const re = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{1,2}:\d{2}|\n\d+\s*\n|$)/g;
    let m;
    while ((m = re.exec(text)) !== null && lines.length < 800) {
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
        // 超过约 MAX_RENDER_DATA 直接放弃，避免 decode+JSON.parse 卡死
        if (raw.length > MAX_RENDER_DATA) continue;
        if (raw.includes('%')) {
          try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
        }
        if (raw.length > MAX_RENDER_DATA) continue;
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
      if (text.length > MAX_PAGE_FETCH) throw new Error('response too large');
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
    // 推荐流：当前卡 class 上的 video_<id>（比链接更稳）
    const active = document.querySelector('[data-e2e="feed-active-video"], .swiper-slide-active');
    const cm = String(active?.className || '').match(/video_(\d{6,})/);
    if (cm) return cm[1];
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

  /** 仅详情/弹窗做片内分析；推荐流(?recommend=1)只划走，避免 creator-end 误跳 */
  function shouldAnalyzeDouyinInVideo() {
    if (!cfg.douyinInVideo) return false;
    return isDouyinDetailContext();
  }

  /** 进度条附近的「第N章：标题」 */
  function readDomChapterHint() {
    const root = document.querySelector('.xgplayer')
      || document.querySelector('[data-e2e="feed-active-video"]');
    const text = lightText(root, 240, 24);
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

  /** 抖音跳点文案：只用标题/简介。评论区平时不可信，易误伤。 */
  function collectDouyinJumpTexts() {
    const items = [];
    const push = (text, time) => {
      const t = String(text || '').trim();
      if (!t || t.length > 80) return;
      items.push({ text: t, time: typeof time === 'number' ? time : undefined });
    };
    const title = document.querySelector('h1')?.textContent || '';
    const desc = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')?.textContent || '';
    push(title);
    push(desc);
    return items;
  }

  async function douyinAnalyzeInVideo() {
    const gen = analyzeGen;
    const awemeAtStart = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
    const stillDouyin = () => {
      if (gen !== analyzeGen) return false;
      if (!awemeAtStart) return true;
      const now = typeof getDouyinAwemeId === 'function' ? (getDouyinAwemeId() || '') : '';
      return !now || now === awemeAtStart;
    };
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
    const awemeId = awemeAtStart || getDouyinAwemeId();
    const domHint = readDomChapterHint();
    let chapterSegs = [];
    let detailPack = null;
    if (awemeId) {
      detailPack = await fetchDouyinChapters(awemeId);
      if (!stillDouyin()) return;
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
          if (cfg.useCreatorMarks === true) {
            const fromMarks = detectFromCreatorMarks(`${detailPack.desc || ''}\n${timeline}`, duration);
            if (fromMarks) chapterSegs.push(fromMarks);
          }
        }
      } else {
        log('douyin chapters empty', awemeId);
      }
    }

    if (chapterSegs.length) {
      if (!stillDouyin()) return;
      activeSegs = chapterSegs;
      activeSeg = chapterSegs[0];
      for (const k of undoneKeys) skippedKeys.add(k);
      applyRejectsToSession(awemeId || currentVideoId());
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
    const creatorText = [title, desc].filter(Boolean).join('\n');

    // 无看点时：用定时字幕估口播段
    let subtitleLines = [];
    if (detailPack?.subtitleInfos?.length) {
      setStatus('分析字幕轨…');
      subtitleLines = await fetchDouyinSubtitleLines(detailPack.subtitleInfos);
      if (!stillDouyin()) return;
    }
    if (subtitleLines.length >= 5) {
      if (!stillDouyin()) return;
      const subSeg = detectFromSubtitles(subtitleLines, jumpItems, duration);
      if (subSeg && subSeg.end - subSeg.start <= MAX_AD_SEC && (validSeg(subSeg, duration || 9999) || subSeg.end - subSeg.start >= 8)) {
        activeSeg = subSeg;
        activeSegs = [subSeg];
        for (const k of undoneKeys) skippedKeys.add(k);
        setStatus(`跳点 ${formatTime(subSeg.start)}→${formatTime(subSeg.end)} · ${subSeg.source}`);
        if (cfg.autoSkip) {
          if (!skipIfPlayingInSegs()) setTimeout(() => skipIfPlayingInSegs(), 400);
        } else {
          showSkipToast(subSeg);
        }
        return;
      }
    }

    // 官方看点 / 字幕优先；简介自标默认关
    const pipeline = [
      ...(cfg.useCreatorMarks === true ? [() => detectFromCreatorMarks(creatorText, duration)] : []),
      () => detectFromJumpTexts(jumpItems, duration),
      () => detectFromKeywords(
        jumpItems.filter((x) => typeof x.time === 'number'),
        duration,
      ),
    ];

    for (const step of pipeline) {
      if (!stillDouyin()) return;
      const seg = step();
      if (seg && seg.end - seg.start <= MAX_AD_SEC && (validSeg(seg, duration || 9999) || seg.end - seg.start >= 8)) {
        activeSeg = seg;
        activeSegs = [seg];
        for (const k of undoneKeys) skippedKeys.add(k);
        setStatus(`跳点 ${formatTime(seg.start)}→${formatTime(seg.end)} · ${seg.source}`);
        if (!cfg.autoSkip) showSkipToast(seg);
        else if (!skipIfPlayingInSegs()) setTimeout(() => skipIfPlayingInSegs(), 400);
        return;
      }
    }

    if (!stillDouyin()) return;
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

  /**
   * SPA 换片监听。
   * 只轮询 BV/p=（及抖音 aweme），禁止劫持 history：B站播放中会狂刷 replaceState，
   * 旧逻辑每次都重拉弹幕 → 标签页崩。
   */
  function observeSpa(cb) {
    let key = spaWatchKey();
    let lastAweme = '';
    let awemeProbeAt = 0;
    const fireIfChanged = () => {
      if (document.hidden) return;
      const nextKey = spaWatchKey();
      let changed = nextKey !== key;
      // 抖音：不在推荐流狂扫 DOM；详情页低频探 aweme
      if (IS_DOUYIN && isDouyinDetailContext() && Date.now() - awemeProbeAt > 2000) {
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
    };
    // 只轮询：禁止劫持 history.pushState/replaceState。
    // B站播放中会狂刷 replaceState（进度/埋点），旧逻辑每次都 kick→重拉弹幕→标签页直接崩。
    setInterval(fireIfChanged, IS_DOUYIN ? 1600 : 1200);
    window.addEventListener('popstate', fireIfChanged);
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
                status: statusForUi(),
                seg: lastSkip?.seg || activeSeg,
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
    let lastId = '';
    let lastBackupAt = 0;
    const pollMs = Math.max(900, Math.min(4000, Number(cfg.feedPollMs) || 1400));
    // 单定时器：多数循环只比 id；换卡才 urgent；约 1.5×poll 保底重检
    feedTimer = setInterval(() => {
      if (document.hidden) return;
      if (!cfg.douyinFeedAd && !cfg.douyinFeedLive && !cfg.douyinFeedShop && !cfg.douyinInVideo) return;
      let id = '';
      try { id = getDouyinAwemeId() || ''; } catch { return; }
      if (id && id !== lastId) {
        lastId = id;
        douyinFeedTick({ urgent: true });
        scheduleFeedRecheck(id);
        return;
      }
      const now = Date.now();
      if (now - lastBackupAt < pollMs * 1.5) return;
      lastBackupAt = now;
      douyinFeedTick({ urgent: false });
    }, pollMs);
  }

  function warnDualInstall() {
    // 油猴与扩展共用 window 标记；同开会导致版本互挡 / 行为重复
    const other = IS_EXT ? window.__MAS_VER_GM__ : window.__MAS_VER_EXT__;
    if (!other) return;
    const tip = IS_EXT
      ? `检测到油猴脚本 v${other}，建议只留扩展或油猴其中一个`
      : `检测到浏览器扩展 v${other}，建议只留扩展或油猴其中一个`;
    setTimeout(() => setStatus(tip), 800);
    log(tip);
  }

  function boot() {
    bindExtCommands();
    warnDualInstall();

    if (IS_BILI) {
      ensureToastStyles();
      ensurePanel();
      registerMenu();
      watchPlayback();
      setStatus('B站模式');
      let kickTimer = 0;
      const kick = () => {
        clearTimeout(kickTimer);
        kickTimer = setTimeout(() => {
          resetPlaybackState();
          setStatus('切换视频…');
          setTimeout(() => runBilibili(), 600);
        }, 200);
      };
      kick();
      observeSpa(kick);
      return;
    }

    if (IS_DOUYIN) {
      // 必须延后：首页水合期装 hooks / 轮询易触发 renderer FATAL（见 Crashpad）
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
        try { ensureStatsLoad(); } catch { /* ignore */ }
        try { installDouyinFeedHooks(); } catch { /* ignore */ }
        ensureToastStyles();
        ensurePanel();
        registerMenu();
        watchPlayback();
        startFeedPoll();
        kick();
        observeSpa(kick);
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => setTimeout(start, 2200), { timeout: 5000 });
      } else {
        setTimeout(start, 2800);
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

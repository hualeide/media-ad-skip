/**
 * 纯检测核心（Node / 浏览器共用逻辑的源）
 * round-test 与自测直接引用；userscript 内嵌同构实现。
 */

import {
  DEFAULT_BRAND_KW,
  MIN_AD_SEC,
  MAX_AD_SEC,
  MIN_SEG_START_SEC,
  SEG_TAIL_GUARD_SEC,
  JUMP_VOTE_MIN_SCORE,
  CONF_LANG_TIP,
  CONF_COLON_JUMP,
  CONF_COLON_WEAK,
  MAX_SUBTITLE_AD_SEC,
  MAX_BRAND_AD_SEC,
} from './config.mjs';

export const ZH_NUM = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 拾: 10,
};

export function convertChineseNumbersToArabic(text) {
  let converted = String(text || '');
  converted = converted.replace(/([一二三四五六七八九壹贰叁肆伍陆柒捌玖])?十([一二三四五六七八九壹贰叁肆伍陆柒捌玖])?/g, (_, tens, ones) => {
    const tensValue = tens ? ZH_NUM[tens] : 1;
    const onesValue = ones ? ZH_NUM[ones] : 0;
    return String(tensValue * 10 + onesValue);
  });
  converted = converted.replace(/([二三四五六七八九贰叁肆伍陆柒捌玖])十/g, (_, tens) => String(ZH_NUM[tens] * 10));
  for (const [c, n] of Object.entries(ZH_NUM)) {
    if (c === '十' || c === '拾') continue;
    converted = converted.split(c).join(String(n));
  }
  return converted;
}

export function zhNumToInt(str) {
  if (!str) return 0;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const converted = convertChineseNumbersToArabic(str);
  if (/^\d+$/.test(converted)) return parseInt(converted, 10);
  return 0;
}

export function extractTimeFromText(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return null;
  if (/发布.{0,4}[分秒钟]|打\s*\d+\s*分|^\d+(\.\d+)?\s*(米|km)/i.test(t)) return null;
  if (/\d+\.\d+.*(更新|版本|预告|我的世界|minecraft)/i.test(t)) return null;
  if (/minecraft|我的世界/i.test(t) && /\d+\.\d+/.test(t)) return null;
  if (/\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日|考古/.test(t)) return null;
  if (/\d{4}\s*[-/,.]\s*\d{1,2}/.test(t)) return null;

  // 先转中文数字，便于「谢谢八分十五郎」
  const raw = t;
  t = convertChineseNumbersToArabic(t);

  // X分Y郎 / 谢谢…郎
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

export function validSeg(seg, duration) {
  if (!seg || seg.start == null || seg.end == null) return false;
  const len = seg.end - seg.start;
  if (len < MIN_AD_SEC || len > MAX_AD_SEC) return false;
  if (seg.start < 0) return false;
  if (!String(seg.source || '').startsWith('creator') && seg.start < MIN_SEG_START_SEC) return false;
  if (duration > 0 && seg.end >= duration - SEG_TAIL_GUARD_SEC) return false;
  return true;
}

/**
 * 章节 / 时间轴标签是否像广告。
 * 英文 ad 必须整词，防 «Sad Songs» / «Fall Apart» 误伤。
 * 油猴同构拷贝在 media-ad-skip.user.js → 改这里后务必同步过去。
 */
export function labelLooksAd(text) {
  const raw = String(text || '');
  if (/(广告|广告时间|恰饭|赞助|商单|推广|软广)/.test(raw)) return true;
  return /\bads?\b|\bsponsors?\b|\bsponsored\b|\badvert(?:s|ising|isement)?\b/i.test(raw);
}

/** 口播商单常见品牌：字幕一旦出现，广告置信远高于泛词 */
export const AD_BRAND_KW = DEFAULT_BRAND_KW.slice();

/** 强广告语境（同句出现才敢信短品牌 / 抬置信） */
export const AD_CTX_RE = /(赞助|恰饭|商单|广告|软广|金主|优惠券|领券|下单|购买|带货|橱窗|链接|折扣|满减|安利)/;

/** 字幕硬 CTA：单独出现也计分（已去掉「合作/限时/入手」等游戏口播高频误伤词） */
export const AD_CONTENT_KW = [
  '赞助', '冠名', '商单', '蓝链', '二维码', '口令',
  '领券', '优惠券', '优惠码', '兑换码', '首充', '应用商店',
];

/**
 * 仅用于品牌段向后延伸（不参与初次命中）。
 * 覆盖「产品功能 / 大促收尾」口播，避免品牌词只出现两次却被 CLUSTER_GAP 截成 12s。
 */
export const AD_PITCH_RE = /(大促|薅羊毛|入手就是|售后|质保|礼盒|热敷|按摩椅|艾绒|马杀鸡|代写贺卡|自用送人|全年底价|养护Buff|驱寒除湿|银离子)/;

function lineLooksAdPitch(text, brands, matched) {
  if (brands?.length || matched?.length) return true;
  const t = String(text || '');
  return AD_CTX_RE.test(t) || AD_PITCH_RE.test(t);
}

/**
 * 字幕关键词/品牌聚类成广告段。
 * 品牌须有广告语境或多次命中；按间隙拆簇，避免早段误命中并入真广告后早跳。
 * 品牌命中后再沿口播话术向前延伸，并并入同窗内其它品牌句。
 */
export function detectFromSubtitles(lines, danmaku, duration) {
  if (!lines || lines.length < 5) return null;
  const hits = [];
  for (const line of lines) {
    const text = String(line.content || '');
    const lower = text.toLowerCase();
    const brands = AD_BRAND_KW.filter((k) => text.includes(k) || lower.includes(k.toLowerCase()));
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
  // 短品牌需语境/多次；≥4 字品牌名单较稳，允许单次
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

  /** 簇内取 ≤maxSpan 的最重子窗；同分偏好更短、更晚（贴口播芯） */
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

  const clampSub = (seg, maxLen = MAX_SUBTITLE_AD_SEC, keepStart = false) => {
    if (!seg || seg.end <= seg.start) return null;
    if (seg.end - seg.start > maxLen) {
      if (keepStart) seg.end = seg.start + maxLen;
      else seg.start = Math.max(0, seg.end - maxLen);
    }
    return validSeg(seg, duration) ? seg : null;
  };

  /** 品牌锚点：沿口播话术前后延伸（非话术句可越过，但间隙 > CLUSTER_GAP 则断） */
  function expandBrandSpan(seedStart, seedEnd) {
    let start = seedStart;
    let end = seedEnd;
    const pitchAt = (line) => {
      const text = String(line.content || '');
      const lower = text.toLowerCase();
      const brands = AD_BRAND_KW.filter((k) => text.includes(k) || lower.includes(k.toLowerCase()));
      const matched = AD_CONTENT_KW.filter((k) => lower.includes(k.toLowerCase()) || text.includes(k));
      return lineLooksAdPitch(text, brands, matched);
    };

    let cursor = seedEnd;
    for (const line of lines) {
      if (line.from < seedStart - 0.5) continue;
      if (line.from > seedStart + MAX_BRAND_AD_SEC) break;
      if (!pitchAt(line)) continue;
      if (line.from - cursor > CLUSTER_GAP) break;
      end = Math.max(end, line.to);
      cursor = line.to;
    }

    cursor = seedStart;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (line.from >= seedStart) continue;
      if (line.from < seedStart - MAX_BRAND_AD_SEC) break;
      if (!pitchAt(line)) continue;
      if (cursor - line.to > CLUSTER_GAP) break;
      start = Math.min(start, line.from);
      cursor = line.from;
    }
    return { start, end };
  }

  // 有品牌时只簇品牌句，避免 CTA/早段闲聊把窗拉太早
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
    if (hasBrand) {
      const expanded = expandBrandSpan(best.start, best.end);
      start = Math.max(0, expanded.start - PAD_START);
      // 口播链已到句尾时只轻垫，避免垫进正片（如「终于下班了」）
      end = expanded.end > best.end ? expanded.end + 2 : expanded.end + PAD_END;
    }
    if (duration > 0) end = Math.min(duration - SEG_TAIL_GUARD_SEC - 0.1, end);
    return clampSub({
      start,
      end,
      source: hasBrand ? 'subtitle-brand' : 'subtitle',
    }, hasBrand ? MAX_BRAND_AD_SEC : MAX_SUBTITLE_AD_SEC, hasBrand);
  }

  const strong = hits.find((h) => (hasBrand && h.brands.length) || h.matched.length >= 2);
  if (strong) {
    let start = Math.max(0, strong.to - 45);
    if (danmaku?.length) {
      const win = danmaku.filter((d) => d.time >= strong.to - 90 && d.time <= strong.to);
      for (const d of win) {
        if (/(广告开始|开始恰饭|恰饭开始|广告来了|已买|购买|接广|广告|商单|恰饭|下单)/.test(d.text || '')) {
          start = Math.min(start, d.time);
        }
      }
    }
    let end = strong.to;
    if (hasBrand && strong.brands.length) {
      const expanded = expandBrandSpan(strong.from, strong.to);
      start = Math.max(0, expanded.start - PAD_START);
      end = expanded.end > strong.to ? expanded.end + 2 : expanded.end + PAD_END;
      if (duration > 0) end = Math.min(duration - SEG_TAIL_GUARD_SEC - 0.1, end);
      return clampSub({
        start,
        end,
        source: 'subtitle-brand',
      }, MAX_BRAND_AD_SEC, true);
    }
    return clampSub({
      start,
      end,
      source: 'subtitle-cta',
    });
  }
  return null;
}

export function detectFromCreatorMarks(text, duration, opts) {
  if (!text) return null;
  const raw = String(text);
  // timelineOnly：只认结构化时间轴（评论用），不跑单行松散正则
  const timelineOnly = !!opts?.timelineOnly;
  const AD = /(广告|恰饭|赞助|商单|推广|软广|合作方|金主|片头广告)/i;
  const OK = /(正片|正文|开始|开讲|上车|回归)/i;

  if (!timelineOnly) {
    let m = raw.match(/(?:广告|恰饭|赞助|商单|推广|软广)[^0-9]{0,12}(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})/i)
      || raw.match(/(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})[^\n]{0,12}(?:广告|恰饭|赞助|商单|推广)/i);
    if (m) {
      const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      if (end > start && end - start >= 8) return { start, end, source: 'creator-range' };
    }

    m = raw.match(/(?:广告|恰饭|赞助|商单)[^0-9]{0,8}(?:到|至|结束(?:于|在)?|完(?:于|在)?)[^0-9]{0,6}(\d{1,2})[:：](\d{2})/i);
    if (m) {
      const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (end >= 8) return { start: 0.1, end, source: 'creator-end' };
    }
    m = raw.match(/(?:正片|正文)\s*(?:从|自|开始于?|起于?|开始)\s*(\d{1,2})[:：](\d{2})/i);
    if (m) {
      const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (end >= 8) return { start: 0.1, end, source: 'creator-end' };
    }
  }

  const entries = [];
  const inline = [...raw.matchAll(/(\d{1,2})[:：](\d{2})\s*([^\d\n]{1,20})/g)];
  for (const it of inline) {
    entries.push({
      start: parseInt(it[1], 10) * 60 + parseInt(it[2], 10),
      label: it[3].trim(),
    });
  }
  const END_MARK = /(跳过广告|广告结束|广告完了?|正片|回归正片|正片开始)/;
  for (let i = 0; i < entries.length; i++) {
    const label = entries[i].label;
    const isEndMark = END_MARK.test(label);
    if (!isEndMark && !AD.test(label) && !labelLooksAd(label)) continue;
    // 「01:51 跳过广告」：T 是广告结束点
    if (isEndMark) {
      const end = entries[i].start;
      const prev = entries[i - 1];
      const prevIsAdStart = prev && !END_MARK.test(prev.label) && (AD.test(prev.label) || labelLooksAd(prev.label));
      const start = prevIsAdStart ? prev.start : Math.max(0, end - 60);
      if (end - start >= 8 && end - start <= MAX_AD_SEC) {
        return { start, end, source: 'creator-timeline', startEstimated: !prevIsAdStart };
      }
      continue;
    }
    let end = i + 1 < entries.length ? entries[i + 1].start : Math.min(duration || entries[i].start + 90, entries[i].start + 90);
    if (i + 1 < entries.length && OK.test(entries[i + 1].label)) end = entries[i + 1].start;
    if (end - entries[i].start >= 8) {
      return { start: entries[i].start, end, source: 'creator-timeline' };
    }
  }
  return null;
}

export function detectFromJumpTexts(items, duration) {
  const votes = new Map();
  const ctxScore = new Map();
  const pairs = [];
  const seenText = new Set(); // 同文案刷屏只计一次，防剧透空降刷分
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
      pairs.push({ start: it.time, end, score, adCtx: adCtx || langTip });
    }
  }
  if (!votes.size) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [bestEnd, bestScore] = ranked[0];
  if (bestScore < JUMP_VOTE_MIN_SCORE) return null;
  let start = Math.max(0, bestEnd - 60);
  const related = pairs.filter((p) => Math.abs(p.end - bestEnd) <= 2 && p.end - p.start >= 20);
  if (related.length) {
    related.sort((a, b) => a.start - b.start);
    start = related[0].start + 2;
  }
  // 纯「空降x:xx」无广告/郎语境：多半是剧透/跳过过程，禁止拉超长段
  const span = bestEnd - start;
  if ((ctxScore.get(bestEnd) || 0) < 0.9 && span > MAX_SUBTITLE_AD_SEC) return null;

  const seg = { start, end: bestEnd, source: 'timestamp', score: bestScore };
  return validSeg(seg, duration) ? seg : null;
}

export function pickSponsorSegments(apiSegs, { minVotes = 3, maxLen = 420 } = {}) {
  if (!Array.isArray(apiSegs)) return [];
  return apiSegs
    .filter((s) => s.actionType === 'skip' && s.category === 'sponsor')
    .filter((s) => (s.votes ?? 0) >= minVotes)
    .map((s) => ({
      start: s.segment[0],
      end: s.segment[1],
      source: 'sponsorblock',
      votes: s.votes ?? 0,
    }))
    .filter((s) => s.end - s.start >= MIN_AD_SEC && s.end - s.start <= maxLen)
    .sort((a, b) => a.start - b.start);
}

export function overlapRatio(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  const inter = Math.max(0, end - start);
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : 0;
}

export async function fetchSponsorSegments(bvid) {
  const url = `https://bsbsb.top/api/skipSegments?videoID=${encodeURIComponent(bvid)}&categories=${encodeURIComponent(JSON.stringify(['sponsor']))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SB HTTP ${res.status}`);
  return res.json();
}

export async function fetchBiliDanmaku(bvid) {
  const view = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)).json();
  if (view.code !== 0) throw new Error(`view ${view.code}`);
  const cid = view.data.pages?.[0]?.cid || view.data.cid;
  const duration = view.data.duration;
  const xml = await (await fetch(`https://comment.bilibili.com/${cid}.xml`)).text();
  const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  const danmaku = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    danmaku.push({ time: parseFloat(m[1].split(',')[0]), text: m[2] });
  }
  return { title: view.data.title, cid, duration, desc: view.data.desc || '', danmaku };
}

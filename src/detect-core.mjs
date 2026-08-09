/**
 * 纯检测核心（Node / 浏览器共用逻辑的源）
 * round-test 与自测直接引用；userscript 内嵌同构实现。
 */

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
  if (len < 8 || len > 420) return false;
  if (seg.start < 0) return false;
  if (!String(seg.source || '').startsWith('creator') && seg.start < 3) return false;
  if (duration > 0 && seg.end >= duration - 3) return false;
  return true;
}

/** 口播商单常见品牌：字幕一旦出现，广告置信远高于泛词 */
export const AD_BRAND_KW = [
  '转转', '爱回收', '闲鱼', '瓜子', '萤石', '山楂树下', '真我',
  '神奇小鹿', '小鹿冰被', '躺岛', '蓝盒子', '半日闲', '时光存折', '栖作', '甜秘密',
  '华味坊', '酸汤面叶', '劲仔', '卫龙', '盐津铺子', '三只松鼠', '良品铺子', '王小卤', '认养一头牛',
  '妙界', '赫恩', '海洋至尊', '溪木源', '博乐达', '蜜丝婷',
  '盖世小鸡', '飞智', '北通', '黑白调', '骁骑',
  '瑞幸', '安克', '酷态科',
];

export const AD_CONTENT_KW = [
  '赞助', '冠名', '推广', '合作', '商单', '评论区', '蓝链', '二维码', '口令',
  '领取', '领券', '优惠券', '优惠码', '兑换码', '下单', '购买', '入手', '抢购',
  '限时', '福利', '首充', '种草', '安利', '应用商店',
];

/**
 * 字幕关键词/品牌聚类成广告段。
 * 品牌词权重更高：单次命中即可成段（并前后垫一点时长）。
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

  const strong = hits.find((h) => h.brands.length || h.matched.length >= 2);
  if (strong) {
    let start = Math.max(0, strong.to - 60);
    if (danmaku?.length) {
      const win = danmaku.filter((d) => d.time >= strong.to - 120 && d.time <= strong.to);
      for (const d of win) {
        if (/(广告开始|开始恰饭|恰饭开始|广告来了|已买|购买|接广|广告|商单|恰饭|下单)/.test(d.text || '')) {
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

export function detectFromCreatorMarks(text, duration) {
  if (!text) return null;
  const raw = String(text);
  const AD = /(广告|恰饭|赞助|商单|推广|软广|合作方|金主|片头广告)/i;
  const OK = /(正片|正文|开始|开讲|上车|回归)/i;

  let m = raw.match(/(?:广告|恰饭|赞助|商单|推广|软广)[^0-9]{0,12}(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})/i)
    || raw.match(/(\d{1,2})[:：](\d{2})\s*[-~—～至到]+\s*(\d{1,2})[:：](\d{2})[^\n]{0,12}(?:广告|恰饭|赞助|商单|推广)/i);
  if (m) {
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (end > start && end - start >= 8) return { start, end, source: 'creator-range' };
  }

  m = raw.match(/(?:广告|恰饭|赞助|商单)[^0-9]{0,8}(?:到|至|结束(?:于|在)?|完(?:于|在)?)[^0-9]{0,6}(\d{1,2})[:：](\d{2})/i)
    || raw.match(/(?:正片|正文)[^0-9]{0,6}(?:从|自|开始|起)?[^0-9]{0,4}(\d{1,2})[:：](\d{2})/i);
  if (m) {
    const end = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const start = Math.max(0, end - 60);
    if (end - start >= 8) return { start: start < 5 && end > 20 ? 0.1 : start, end, source: 'creator-end' };
  }

  const entries = [];
  const inline = [...raw.matchAll(/(\d{1,2})[:：](\d{2})\s*([^\d\n]{1,20})/g)];
  for (const it of inline) {
    entries.push({
      start: parseInt(it[1], 10) * 60 + parseInt(it[2], 10),
      label: it[3].trim(),
    });
  }
  for (let i = 0; i < entries.length; i++) {
    const label = entries[i].label;
    if (!AD.test(label)) continue;
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
  const pairs = [];
  for (const it of items) {
    const info = extractTimeFromText(it.text);
    if (!info) continue;
    const end = Math.round(info.time);
    if (end <= 0 || (duration > 0 && end >= duration - 5)) continue;
    let score = info.conf;
    if (/(空降(?!兵)|跳过|快进|广告|恰饭|指路|谢谢|感谢)/.test(it.text)) score += 0.8;
    votes.set(end, (votes.get(end) || 0) + score);
    if (typeof it.time === 'number' && !Number.isNaN(it.time)) {
      pairs.push({ start: it.time, end, score });
    }
  }
  if (!votes.size) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [bestEnd, bestScore] = ranked[0];
  if (bestScore < 1.8) return null;
  let start = Math.max(0, bestEnd - 60);
  const related = pairs.filter((p) => Math.abs(p.end - bestEnd) <= 2 && p.end - p.start >= 20);
  if (related.length) {
    related.sort((a, b) => a.start - b.start);
    start = related[0].start + 2;
  }
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
    .filter((s) => s.end - s.start >= 5 && s.end - s.start <= maxLen)
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

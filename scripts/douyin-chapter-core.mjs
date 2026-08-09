/**
 * 抖音多视频看点回归（需在已登录的 douyin.com 页里跑，或本机带 cookie）
 * 用法: 浏览器 console / CDP 注入；或 node 仅做纯算法测
 */
export function chapterLabelLooksAd(label, brands = []) {
  const t = String(label || '');
  if (/(广告|恰饭|赞助|商单|推广|软广)/.test(t)) return true;
  return brands.some((k) => t.includes(k));
}

export function detectFromDouyinAdChapters(chapterList, adIndexes, durationSec, brands = []) {
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
      if (gap <= 45 && (chapterLabelLooksAd(nextLab, brands)
        || /(压力|旗舰|性能|续航|优惠|下单|品牌|真我|一加|红米|小米|华为|vivo|OPPO|手机|冰被|回收|零食|方便面|咖啡)/i.test(nextLab))) {
        endIdx += 1;
      }
    }
    let end = endIdx < chapterList.length
      ? (chapterList[endIdx].timestamp || 0) / 1000 + 5
      : Math.min(dur || start + 75, start + 75);
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
      if (!chapterLabelLooksAd(label, brands)) continue;
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

export function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 已知样例：期望至少有广告段、且起止合理 */
export const KNOWN = [
  {
    id: '7580755333623264229',
    name: '幸福时刻/华味坊',
    expectAdLabel: /迎刃而解/,
    expectStartMin: 130,
    expectStartMax: 145,
  },
  {
    id: '7604396796965694373',
    name: '相见恨晚',
    expectStartMin: 120,
    expectStartMax: 140,
  },
  {
    id: '7598105376491721913',
    name: '狂风来袭/真我',
    expectStartMin: 140,
    expectStartMax: 160,
  },
  {
    id: '7631027941770681337',
    name: '无处可逃',
    expectAdLabel: /仗义出手/,
    expectStartMin: 110,
    expectStartMax: 125,
  },
  {
    id: '7639282080258245114',
    name: '三伯公/萤石',
    expectAdLabel: /查看情况/,
    expectStartMin: 120,
    expectStartMax: 135,
  },
  {
    id: '7585462573778423077',
    name: '订哪里啊/瓜子',
    expectAdLabel: /翔妈解释/,
    expectStartMin: 130,
    expectStartMax: 145,
  },
  {
    id: '7601156820678454385',
    name: '忠肝义胆',
    expectAdLabel: /互相交流/,
    expectStartMin: 110,
    expectStartMax: 125,
  },
];

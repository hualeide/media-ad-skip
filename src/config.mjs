/**
 * 共享配置：品牌词 + 检测阈值。
 * 改这里 → build 会同步到扩展头 / shared/config.js；油猴源里常量应对齐。
 */

/** 口播商单常见品牌（字幕命中即高置信） */
export const DEFAULT_BRAND_KW = [
  '转转', '爱回收', '闲鱼', '瓜子', '萤石', '山楂树下', '真我',
  '神奇小鹿', '小鹿冰被', '躺岛', '蓝盒子', '半日闲', '时光存折', '栖作', '甜秘密',
  '华味坊', '酸汤面叶', '劲仔', '卫龙', '盐津铺子', '三只松鼠', '良品铺子', '王小卤', '认养一头牛',
  '妙界', '赫恩', '海洋至尊', '溪木源', '博乐达', '蜜丝婷',
  '盖世小鸡', '飞智', '北通', '黑白调', '骁骑',
  '瑞幸', '安克', '酷态科', '得物',
];

/** 广告段长度与投票阈值（秒 / 分数） */
export const MIN_AD_SEC = 8;
export const MAX_AD_SEC = 420;
/** 非作者自标：起点早于此时秒数则丢弃（防误跳片头） */
export const MIN_SEG_START_SEC = 3;
/** 终点须距片尾至少这么多秒 */
export const SEG_TAIL_GUARD_SEC = 3;
/** 弹幕时间戳投票：总分低于此不采纳 */
export const JUMP_VOTE_MIN_SCORE = 1.8;
/** 「谢谢X分Y郎」类高置信 */
export const CONF_LANG_TIP = 1.5;
/** 带空降/广告等词的 mm:ss */
export const CONF_COLON_JUMP = 1.25;
/** 裸 mm:ss（弱） */
export const CONF_COLON_WEAK = 0.35;
/** 字幕估段最长（防游戏口播误拉超长段；过宽会早跳进正片） */
export const MAX_SUBTITLE_AD_SEC = 75;
/** 品牌口播可再拉长一点（单品牌贯穿整段商单，常 >75s） */
export const MAX_BRAND_AD_SEC = 90;

/** 防崩：响应体体积上限（字符） */
export const MAX_FEED_BODY = 350_000;
export const MAX_DANMAKU_XML = 600_000;
export const MAX_RENDER_DATA = 250_000;
export const MAX_PAGE_FETCH = 600_000;
export const MAX_BG_FETCH = 800_000;

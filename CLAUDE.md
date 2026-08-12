# Claude 审阅指引（Media Ad Skip）

> 给 Claude / 其它 agent：先读本文，再动代码。当前版本以 `extension/manifest.json` / `@version` 为准（推送时多为 **1.5.64+**）。

## 这是什么

B站 + 抖音**网页版**广告时间跳过工具：MV3 扩展 + Tampermonkey 同源。  
**不是**通用广告拦截；**只**在 bilibili / douyin 匹配页注入。

仓库：https://github.com/hualeide/media-ad-skip

## 铁律（改之前必看）

1. **唯一手改运行时源**：`media-ad-skip.user.js`  
   - 改完必须：`node scripts/build-extension-content.mjs`  
   - **禁止手改**生成物 `extension/content/content.js`（会被覆盖）。
2. **检测纯逻辑**可同步改：`src/detect-core.mjs` + `src/config.mjs`（自测 / Node 用；油猴里常有同构拷贝，两边要对齐）。
3. **防崩优先于检测召回**（Crashpad 已实锤）：
   - 禁止对视频合成层 `document.elementFromPoint`
   - 禁止在视频上 `backdrop-filter` / 重 transform toast
   - 抖音：延迟 `start`（idle + ~2.2s）；信息流勿全页扫 DOM；`feedPollMs` 默认偏慢（~1400）
   - 静态闸：`node scripts/crash-guard-check.mjs` 必须过
4. **范围控制**：只改任务相关文件；用户未要求勿 commit / push。
5. 回复用户默认 **简体中文、精简**。

## 目录速查

| 路径 | 作用 |
|------|------|
| `media-ad-skip.user.js` | 油猴 + 扩展 content 的源 |
| `extension/` | 可加载的 MV3 包（选这一层加载） |
| `extension/content/page-bridge.js` | 抖音页内桥（体积/钩子受限） |
| `extension/background.js` | SW：配置迁移、更新检查 |
| `src/detect-core.mjs` | 字幕/弹幕/作者标记等检测核心 |
| `src/config.mjs` | 阈值、品牌词、体积上限 |
| `scripts/build-extension-content.mjs` | user.js → content.js |
| `scripts/crash-guard-check.mjs` | 防崩静态检查 |
| `scripts/self-test.mjs` | 时间戳 / 字幕品牌 / 章节标签自测 |
| `scripts/read-crash-dumps.mjs` | 读本机 Chrome Crashpad 摘要 |
| `docs/index.html` | GitHub Pages 安装页 |

## 逻辑怎么走（审 bug 时跟这条链）

### B站片内

管道大致顺序（见 `analyze` / pipeline）：作者自标 → 章节 `view_points` → 弹幕时间戳 → 字幕品牌/CTA → SponsorBlock 等。  
命中后 `doSkip`；用户撤销后本片禁再自动跳同段（`undoneKeys`）。

**已知误伤（已修，回归勿回退）：**

- `subtitle-brand`：早段品牌铺垫 + 90s 滑窗 → 跳太早。现：间隙拆簇、轻 padding、最长 ~75s。
- `chapter`：`includes('ad')` 误伤歌名 **Sad …**（BV1J4un6mEV1 跳了 18:47→24:53）。现：`labelLooksAd()`，英文 `ad` **整词**。

### 抖音

- 推荐流 `?recommend=1`：**只划走**，不做片内长分析。
- 详情 / `modal_id`：可走片内。
- 直播卡：默认关；正片 `video` 还在时绝不按直播划走（勿再对 video 狂读 `getBoundingClientRect`）。

## 本地验证命令

```bash
node scripts/self-test.mjs
node scripts/build-extension-content.mjs
node scripts/crash-guard-check.mjs
# 可选
node scripts/crash-stress.mjs
node scripts/read-crash-dumps.mjs   # 需本机有 Chrome Crashpad
```

改版本时对齐三处：`media-ad-skip.user.js` 的 `@version` + `__MAS_VER_*__`，以及 `extension/manifest.json` 的 `version`（build 会把 ver 写进 content）。

## 建议审阅顺序（给 Claude）

1. 读本文件 + `README.md` 原理/安装约束。  
2. `src/detect-core.mjs`：`detectFromSubtitles`、`validSeg`、作者标记。  
3. `media-ad-skip.user.js`：`labelLooksAd` / `detectFromChapters`、抖音 `classifyActiveFeed`、toast、delayed `start`。  
4. `scripts/crash-guard-check.mjs`：当前禁止项是否仍合理。  
5. 若任务是「又崩了」：先跑 `read-crash-dumps.mjs`，看 URL 是否在扩展 match 内；京东/B站动态等**不注入**页的崩不要怪本扩展。Dark Reader 等全局扩展曾与同款 FATAL 同框出现。

## 不要做的事

- 为提速恢复 `elementFromPoint` 打视频区、全页 `querySelectorAll('*')`、缩短抖音 start 到亚秒级装 hook。  
- 把 `content.js` 当源文件长期手改。  
- 提交 `scripts/chunk*`、`push*.json`、临时 smoke 注入垃圾。  
- 扩大 host 到非 B站/抖音（隐私与崩溃面都会炸）。

## 给人类的一句话

装扩展请加载 **`extension/`** 目录；改源后 rebuild 再在扩展页点重新加载，并**新开**视频标签。

# 架构

审计日：2026-09-24。只读，未改运行代码。跳过 `node_modules/`、`dist/`、`.venv`（仓库内未见前两者外的依赖目录；`dist/` 是打包产物）。

CodeGraph：`codegraph_status`（`projectPath=C:\Users\LENOVO\Projects\media-ad-skip`）返回 **database is locked**。`codegraph_files` 未调用成功。符号与行号来自源码通读，图索引 **未确认**。

版本锚点：油猴 `@version`、`window.__MAS_VER__`、`extension/manifest.json` 的 `version` 均为 **1.5.74**。

## 模块清单

| 模块 | 角色 |
|---|---|
| `src/config.mjs` | 品牌词与阈值的数字源。build 写入油猴 `BRAND_KW_*` 与 `extension/shared/config.js`。 |
| `src/detect-core.mjs` | 纯函数检测。只被 `scripts/self-test.mjs`、`scripts/round-test.mjs` import。**扩展与油猴运行时不加载此文件。** |
| `media-ad-skip.user.js` | 运行时真源（约 3306 行，IIFE）。Tampermonkey 直接跑；build 从这里切出扩展内容脚本。 |
| `scripts/build-extension-content.mjs` | 同步品牌表，切片生成 `extension/content/content.js`，把油猴 storage/boot 换成 `chrome.storage`。 |
| `extension/manifest.json` | MV3。content script 只注入 B 站视频/稍后再看/番剧与抖音；`page-bridge.js` 仅抖音 web_accessible。 |
| `extension/content/content.js` | **生成物**。头是 build 模板，检测函数体来自油猴切片。勿手改。 |
| `extension/content/page-bridge.js` | 页面主世界。带 Cookie `fetch`，`postMessage` 回内容脚本。 |
| `extension/background.js` | Service worker。GitHub 更新检查；`MAS_FETCH` 代发（无 Cookie，800000 字符上限）。 |
| `extension/popup/popup.js` | 弹窗。`chrome.tabs.sendMessage` 发 `MAS_CMD`。不向页面热注入脚本。 |
| `extension/options/options.js` | 选项页。`chrome.storage.sync.cfg` + `local` 品牌/黑名单/统计。品牌默认读 `shared/config.js`。 |
| `extension/shared/config.js` | 生成物。`MAS_DEFAULT_BRAND_KW`。选项页 `options.html:133` 引入。 |
| `scripts/douyin-chapter-core.mjs` | 抖音看点算法的 Node 副本 + `KNOWN` 样例。运行时看点在油猴 `detectFromDouyinAdChapters`，**不是** import 此文件。 |
| `scripts/self-test.mjs` | 离线断言，并抽查油猴源里若干正则/函数名是否还在。 |
| `scripts/round-test.mjs` | 单元 + 在线拉 SponsorBlock / B 站弹幕，写 `test-results/`。 |
| `scripts/crash-guard-check.mjs` | 静态防崩：版本三处对齐、禁 `history` 劫持、禁 `elementFromPoint`、体积闸、抖音延迟启动。 |
| `scripts/crash-stress.mjs` | 大字符串早退与 `spaWatchKey` / `analyzeGen` 语义的本地复刻，不 import 运行时。 |
| `scripts/live-bili-test.mjs` | 在线弹幕试跑。内嵌**另一份** `extractTimeFromText`，不 import `detect-core`。 |
| `scripts/check-ext.mjs` | 生成后的 `content.js` 冒烟（按钮 id、黑名单、watchlater）。 |
| `scripts/pack-extension.mjs` | 把 `extension/` 打成 `dist/*.zip`（PowerShell `Compress-Archive`，失败则 `tar`）。 |
| `scripts/serve.js` | `127.0.0.1:8765` 静态吐油猴脚本。 |
| `scripts/read-crash-dumps.mjs` | 读本机 Chrome Crashpad `.dmp` 抽字符串。路径绑 `%LOCALAPPDATA%`。 |
| `.github/workflows/test.yml` | Node 20：self-test、crash-guard、crash-stress、build、再 guard + `node --check`。 |

`docs/index.html`：安装说明静态页。行为 **未逐行读，未确认**。`test-results/` 是跑测产物，不是模块。

无 `package.json`。运行与测试只用 Node 内置模块（`fs` / `path` / `http` / `child_process` / `url`）。

## 数据流

两条形态，检测意图同源，**字节不同源**：油猴整文件执行；扩展先 build，内容脚本 = 生成头 + 油猴自 `const AD_START` 起的切片（`build-extension-content.mjs:68-70`）。油猴的 `loadCfg` / `boot` 段被删，改由生成头里的 `loadCfgAsync` 与改写后的 `async function boot` 接管。

### 配置

- 扩展：`chrome.storage.sync.cfg`（开关、轮询间隔）与 `chrome.storage.local`（`brandKeywords`、`blockBvids`、`blockMids`、`masStats`、`feedbackLog`、`updateMeta`）。安装默认与版本迁移旗标在 `background.js:110-198`。
- 油猴：`GM_getValue('cfg')`，否则 `localStorage['mas-cfg']`（`media-ad-skip.user.js:428-441`）。build 会把这段从扩展产物里拿掉。

弹窗改开关只写 storage。内容脚本听 `chrome.storage.onChanged`（仅生成后的 boot，`build-extension-content.mjs:95-111`）。命令走 `MAS_CMD`：`popup.js:51-58` → `bindExtCommands`（`user.js:3143`）。

### B 站片内

`boot`（`user.js:3244`）→ `watchPlayback` 800ms（`user.js:1598-1617`）+ `observeSpa` 1200ms 只看 BV/`p=`（`user.js:3116`，**不**改 `history`）。

`runBilibili`（`user.js:2040`）：

1. 本集/UP 黑名单或 `biliInVideo` 关则停。
2. `biliGetVideoMeta`（`user.js:1626`）：`__INITIAL_STATE__`、番剧 `pgc/view/web/season`、否则 `api.bilibili.com/x/web-interface/view`。
3. 并行：弹幕（默认关）、`x/player/wbi/v2` 章节与字幕列表、SponsorBlock、置顶/热评时间轴。
4. **有 SB 段就直接采用并 return**（`user.js:2088-2093`），不再跑字幕。
5. 否则管道：官方章节 `type===1` →（可选）简介自标 → 评论时间轴 `timelineOnly` → 字幕聚类 →（可选）弹幕时间戳 / 关键词。
6. `analyzeGen` 变了则丢弃过期响应（`analysisStillCurrent`，`user.js:1179`）。
7. 播放头落入 `[start-0.4, end-1)` 且 `autoSkip`：`doSkip` 把 `currentTime` 设到 `end+0.3`（`user.js:1552-1554`）。抖音多一次 450ms 确认轮询；B 站确认后立即 commit。

跨域 JSON（SB）：油猴 `GM_xmlhttpRequest`（`gmFetchJson`，`user.js:1962`）；扩展改成 `proxyFetchJson` → background `MAS_FETCH`（`build-extension-content.mjs:82-85`，`background.js:229`）。B 站页面 API 在内容脚本里直接 `fetch`（`biliFetchJson`，`user.js:1621`，`credentials: 'include'`）。

### 抖音

`requestIdleCallback` 后再 `setTimeout(start, 2200)`（`user.js:3280-3295`）才装 hook / 开轮询。

信息流：`installDouyinFeedHooks`（`user.js:2376`）包一层 `XMLHttpRequest` 与 `window.fetch`，URL 像 `/aweme/vN/web/(tab/)?feed` 时用正则切片打 `awemeMeta`（`is_ads` / 购物 / `aweme_type=101`），**不** `JSON.parse` 整包。`startFeedPoll`（`user.js:3205`）在 aweme id 变化时 `douyinFeedTick`：详情页先点「跳过广告」；否则 API 标记优先、DOM（广告 SVG、购物车、整卡直播）补缺；命中则 `swipeToNextFeed`（下一条按钮，不够再对 `document.body` 发 ArrowDown）。推荐流（非 `/video/` 且无 `modal_id`）**不做**片内分析（`shouldAnalyzeDouyinInVideo`，`user.js:2881`）。

片内：`douyinAnalyzeInVideo`（`user.js:2920`）。`pageFetchJson`（`user.js:2813`）→ 主世界 `page-bridge.js` 带 Cookie 打 `aweme/detail`。看点 `ad_chapter_index_list` → 字幕轨 →（可选）简介 → 标题/简介时间戳 → 软跳提示（不自动 seek）。短于 45s 只走信息流/按钮。

### 更新

`background.js` 每 24h `alarms` 打 GitHub Releases，没有则 tags。有新版只改 badge，不自动安装。弹窗/选项用 `MAS_CHECK_UPDATE` / `MAS_GET_UPDATE`。

## 关键符号

| 符号 | 位置 |
|---|---|
| 阈值 / `DEFAULT_BRAND_KW` | `src/config.mjs:7-41` |
| `labelLooksAd` / `detectFromSubtitles`（测试用，含 `expandBrandSpan`） | `src/detect-core.mjs:122`、`157`、`237` |
| `detectFromCreatorMarks` / `detectFromJumpTexts` / `pickSponsorSegments`（`minVotes=3`） | `src/detect-core.mjs:333`、`395`、`440` |
| `fetchSponsorSegments` → `bsbsb.top` | `src/detect-core.mjs:463` |
| 油猴 `detectFromSubtitles`（无品牌延伸） | `media-ad-skip.user.js:976` |
| `doSkip` / `watchPlayback` | `media-ad-skip.user.js:1521`、`1598` |
| `runBilibili` | `media-ad-skip.user.js:2040` |
| `fetchSponsorBlock`（`votes >= 0`） | `media-ad-skip.user.js:2011` |
| `detectFromChapters`（`ch.type === 1`） | `media-ad-skip.user.js:1844` |
| `installDouyinFeedHooks` / `ingestFeedJsonLight` / `douyinFeedTick` | `media-ad-skip.user.js:2376`、`2331`、`2447` |
| `swipeToNextFeed` | `media-ad-skip.user.js:2175` |
| `douyinAnalyzeInVideo` / `pageFetchJson` / `ensurePageBridge` | `media-ad-skip.user.js:2920`、`2813`、`2796` |
| `boot` | `media-ad-skip.user.js:3244` |
| `bindExtCommands` | `media-ad-skip.user.js:3143` |
| 页面桥 `MAS_PAGE_FETCH` | `extension/content/page-bridge.js:6-27` |
| `MAS_FETCH` / `checkForUpdate` | `extension/background.js:216`、`67` |
| 切片锚点 `AD_START`、`gmFetchJson`→`proxyFetchJson` | `scripts/build-extension-content.mjs:68`、`82` |
| 生成头里的 `MAX_BRAND_AD_SEC` / `AD_PITCH_RE`（内容脚本函数体未使用，见脆弱点 1） | `extension/content/content.js:30`、`32` |
| 选项 `save` | `extension/options/options.js:142` |
| 弹窗 `sendCmd` | `extension/popup/popup.js:51` |

`extension/content/content.js` 内函数行号会随 build 漂移；上表运行时行为以油猴行号为准。

## 外部依赖

浏览器：Chrome / Edge 等 MV3；Firefox ≥ 121（`manifest.json:31`）。权限 `storage`、`activeTab`、`alarms`。油猴需 `GM_getValue`、`GM_setValue`、`GM_registerMenuCommand`、`GM_xmlhttpRequest`；`@connect` 只声明了 `bsbsb.top`、`api.bilibili.com`、`comment.bilibili.com`（`user.js:23-25`）。

网络（host 见 `manifest.json:35-48`）：

- `https://bsbsb.top/api/skipSegments` — SponsorBlock 镜像，只要 `sponsor` + `skip`
- `https://api.bilibili.com/x/web-interface/view`、`/pgc/view/web/season`、`/x/player/wbi/v2`、`/x/v2/dm/web/seg.so`、`/x/v2/reply/main`
- `https://comment.bilibili.com/{cid}.xml`
- 字幕 URL 来自播放器接口（协议相对时补 `https:`）
- `https://www.douyin.com/aweme/v1/web/aweme/detail/`
- 抖音 feed：`/aweme/vN/web/(tab/)?feed`（页面自己的 XHR/fetch，脚本只旁路读 body）
- `https://api.github.com/repos/hualeide/media-ad-skip/releases/latest` 与 `/tags`
- Release zip：`github.com/hualeide/media-ad-skip/releases/latest/download/media-ad-skip-extension.zip`
- 油猴更新：`raw.githubusercontent.com/hualeide/media-ad-skip/master/media-ad-skip.user.js`

CI：`actions/checkout@v4`、`actions/setup-node@v4`、Node 20。无 npm 包。

## 三处脆弱点

1. **测的字幕算法不是上线的那份。** `src/detect-core.mjs:237` 的 `expandBrandSpan` 用 `AD_PITCH_RE` 把品牌口播拉到最长 `MAX_BRAND_AD_SEC`（90s）。`self-test.mjs:105-128` 的「妙界」用例锁的是这个行为。油猴 `detectFromSubtitles`（`user.js:976-1099`）没有 `expandBrandSpan` / `AD_PITCH_RE` / `MAX_BRAND_AD_SEC`，超长一律裁成 75s 且从段尾往回切（`user.js:1044-1048`）。build 把这两个常量写进 `content.js` 头（`content.js:30-32`），函数体仍是油猴切片，常量空挂。同文件另一处阈值也不齐：运行时 SB 接受 `votes >= 0`（`user.js:2019`），`pickSponsorSegments` 默认 `minVotes = 3`（`detect-core.mjs:440`）。`live-bili-test.mjs:17` 又抄了第三份时间解析。`self-test` 只对油猴做字符串在场检查（`labelLooksAd`、`mark`、`ch.type === 1`），盖不住函数体漂移。

2. **扩展内容脚本靠正则切片，不是模块边界。** `build-extension-content.mjs:68-114` 依赖油猴里仍有 `const AD_START`、一段从 `let cfg = loadCfg()` 到 `// --- utils` 的块、以及 `function boot() { bindExtCommands();` 这句原文。锚点改一个字，build 抛错或把旧 boot 留在产物里。版本靠三处字面量，靠 `crash-guard-check.mjs:27` 事后才失败。`content.js` 与油猴约 12 万字节各一份，手改生成物会被下次 build 盖掉。

3. **抖音路径改页面网络栈，并用主世界带 Cookie 拉详情。** `installDouyinFeedHooks`（`user.js:2376-2422`）替换 `XMLHttpRequest.prototype.open/send` 和 `window.fetch`，进程内只装一次（`_done`）。别的脚本后装会盖掉这层；先装的会被叠在外面。`pageFetchJson`（`user.js:2840`）对 `'*'` `postMessage`，`page-bridge.js:7-11` 在主世界 `credentials: 'include'`。同页任何脚本都能听 `mas-content` / `mas-page-bridge`。体积闸在读完 body 之后（桥 `page-bridge.js:17`，feed 在 `clone().text()` 之后比 `MAX_FEED_BODY`）。抖音必须延迟到 idle+2200ms 才 `start`（`user.js:3291`）；`crash-guard-check.mjs:71-77` 把这件事当成崩因。推荐流 DOM 选择器（`data-e2e`、广告 SVG 前缀 `user.js:2277`）一改版，划走就哑，API 标记缺失时没有第二数据源。

## 未确认

- CodeGraph 文件树与调用图（索引锁）。
- `docs/index.html` 与 `extension/options/options.css`、图标的行为（非逻辑路径，未逐行读）。
- `detect-core.fetchBiliDanmaku`（`detect-core.mjs:470`）与运行时 `biliFetchDanmaku`（含 protobuf 兜底，`user.js:1723` 起）是否逐字段一致：只读到 XML 主路径，protobuf 段 **未逐行对照**。
- 油猴 `decodeDanmakuProto`（`user.js:1739`）字节布局 **未逐行审**。
- 线上 `bsbsb.top`、B 站、抖音接口当前契约 **未请求**。

# Media Ad Skip

B站 + 抖音**网页版**片内/信息流广告跳过工具。提供 **Chrome/Edge 扩展（MV3）** 与 **油猴脚本** 两种形态，核心逻辑同源。

> 当前版本 **1.5.12** · [隐私说明](extension/PRIVACY.md) · [商店文案](extension/STORE.md)

## 作用

看视频时尽量少点「跳过」：到广告段自动 `seek` 到正片，误跳可撤销。

| 平台 | 做什么 |
|------|--------|
| **B 站** | 跳片内恰饭段：SponsorBlock 社区标注优先；辅以章节/简介、字幕品牌词、弹幕时间戳 |
| **抖音** | 跳长视频口播广告：官方「广告看点」、字幕轨估跳、页面「跳过广告」按钮；信息流可划走广告/直播卡 |
| **通用** | 右下角 toast：撤销 / 本集不跳 / 标错了；设置页可改品牌词、黑名单、软跳秒数、SponsorBlock 等 |

**不做什么**：不破解会员、不拦开屏闪屏类系统广告、不上传观看账号或历史。

## 原理（简要）

整体是「**检出广告时间段 → 播放头进入段内则 seek 到段末**」，不改视频文件、不劫持解码。

```
视频页注入脚本
    │
    ├─ 拉取/解析「广告区间」[start, end]
    │     B站：SponsorBlock → 章节/简介 → 字幕+弹幕品牌词
    │     抖音：官方广告看点 → 字幕轨 → 软跳（仅有起点无终点时）
    │
    ├─ 定时读 currentTime，落入区间则 seek 到 end
    │     抖音：seek 后短轮询确认，失败不硬刷页面
    │
    └─ toast 延后弹出（与 seek 不同帧，降低卡顿）
```

### B 站

1. 用 `bvid` 请求 [SponsorBlock](https://bsbsb.top) 公开分段（可关）。
2. 无 SB 或需补充时：解析章节/简介里的「广告开始～结束」、字幕与弹幕中的品牌词/时间戳，合成区间。
3. `watchPlayback` 约每 400ms 检查；进入区间则 `video.currentTime = end`。

### 抖音

1. 从当前激活 feed 卡取 `aweme_id` 与详情里的看点列表；官方标了广告索引的看点优先信任。
2. 区间大致为「广告看点起点 → 下一看点 + 短缓冲」；口播偏长时拉伸到约 32–40s，避免跳太早。
3. 无看点时：若有字幕轨，用品牌词估跳；仍无终点可按设置做一次**软跳**（默认约 35s）。无依据不瞎跳。
4. 信息流：按配置划走广告/直播等卡片（与片内 seek 独立）。

### 双形态

| | 扩展 | 油猴 |
|--|------|------|
| 入口 | [`extension/`](extension/) | [`media-ad-skip.user.js`](media-ad-skip.user.js) |
| 设置 | `chrome.storage` + 选项页/弹窗 | `GM_*` + 菜单 |
| 构建 | 改油猴后执行下方 build，再重载扩展 | 直接改脚本 |

内容脚本由油猴源生成，避免两套逻辑分叉：

```bash
node scripts/build-extension-content.mjs
```

## 安装扩展（推荐）

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库的 [`extension/`](extension/) 目录
4. 打开任意 B站 / 抖音视频页；图标弹窗可快速操作，详细项在「选项」
5. 改代码后：扩展页「重新加载」→ **关掉旧标签再开**（或弹窗「刷新当前页」）

## 油猴（可选）

安装 Tampermonkey 后导入 [`media-ad-skip.user.js`](media-ad-skip.user.js)。

## 自测

```bash
node scripts/self-test.mjs
node scripts/round-test.mjs
```

## 许可

[MIT](LICENSE)

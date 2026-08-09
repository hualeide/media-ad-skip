# Media Ad Skip

[![Version](https://img.shields.io/badge/version-1.5.20-blue.svg)](./extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Sites](https://img.shields.io/badge/Sites-Bilibili%20%2B%20Douyin-green.svg)](#-作用)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

B站 + 抖音**网页版**片内 / 信息流广告跳过工具。提供 **Chrome / Edge 扩展（MV3）** 与 **油猴脚本** 两种形态，核心逻辑同源。

> **仅在 B站、抖音页面注入**；其它网站不会运行。当前 **1.5.20**。隐私与上架文案见 [`extension/PRIVACY.md`](extension/PRIVACY.md)、[`extension/STORE.md`](extension/STORE.md)。

---

## 自动更新（怎么「一次下载长期受益」）

Chrome **不允许**「加载已解压」的扩展像商店插件那样静默自动升级。可选路径：

| 方式 | 体验 | 说明 |
|------|------|------|
| **上架 Chrome / Edge 商店** | 真正自动更新 | 一次安装后由商店推送；见 [`extension/STORE.md`](extension/STORE.md) |
| **本扩展内置检查（已做）** | 半自动 | 每天查 GitHub；有新版本图标角标 **↑**，弹窗/设置页可「去更新」 |
| **git clone 安装** | 半自动 | `git pull` → 扩展页「重新加载」 |
| **油猴** | 自动（脚本管理器） | 已写 `@updateURL`，Tampermonkey 会抽查更新 |

**已解压用户更新步骤：**

1. 弹窗点「去更新」或打开 [Releases](https://github.com/hualeide/media-ad-skip/releases)
2. 下载 ZIP，用新文件**覆盖**本地的 `extension` 目录（或整仓覆盖）
3. `chrome://extensions` → Media Ad Skip → **重新加载**
4. 关掉旧的 B站/抖音标签再开

发布者打版：`node scripts/pack-extension.mjs`，再用 `gh release create …` 挂上 zip。

---

## 🚀 极速上手

本扩展未上架商店，需用浏览器 **开发者模式** 本地加载（和多数开源 MV3 扩展一样）。

### 1. 拿到代码

任选其一：

- **GitHub**：打开 [本仓库](https://github.com/hualeide/media-ad-skip) → 绿色 **Code** → **Download ZIP** → 解压到任意目录  
- **Git**：`git clone https://github.com/hualeide/media-ad-skip.git`

解压后确认存在：`media-ad-skip/extension/manifest.json`（后面要选的是 **`extension` 这一层**，不是仓库根目录）。

### 2. 开发者模式安装（本地加载）

1. 打开 Chrome / Edge，地址栏输入并回车：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 右上角打开 **「开发者模式」**（Developer mode）。
3. 点击 **「加载已解压的扩展程序」**（Load unpacked）。
4. 选中本仓库里的 **`extension`** 文件夹（里面直接有 `manifest.json`、`background.js`、`content/` 等）。
5. 列表里出现 **Media Ad Skip**，状态为已启用即可。
6. 点浏览器工具栏 **拼图** 图标，找到 **Media Ad Skip** → **固定**，方便以后点。

> ⚠️ **常见翻车**：选成了仓库根目录 `media-ad-skip/`（没有直接的 `manifest.json`）会加载失败。必须选 **`extension/`**。

### 3. 开始用

1. 打开 [B站视频页](https://www.bilibili.com/) 或 [抖音网页版](https://www.douyin.com/)（**只有这两个站会注入脚本**）。
2. 点扩展图标：可 **立即跳过 / 撤销 / 本集不跳 / 标错了 / 重新分析**。
3. 详细开关（品牌词、黑名单、软跳秒数、SponsorBlock、信息流划走等）在扩展的 **「选项」** 页。
4. 跳过成功后右下角会出现 toast，可撤销。

### 4. 改代码 / 更新后怎么刷新

1. 若你改的是油猴源 `media-ad-skip.user.js`，先在仓库根目录执行：
   ```bash
   node scripts/build-extension-content.mjs
   ```
2. 回到 `chrome://extensions/`，在 Media Ad Skip 卡片上点 **「重新加载」**。
3. **关掉旧的 B站 / 抖音标签再新开**（或弹窗里点「刷新当前页」），否则可能还在跑旧脚本。

### 5. 装不上时对照表

| 现象 | 处理 |
|------|------|
| 加载报错 / 找不到 manifest | 选的目录不对 → 选 `extension/` |
| 扩展在，但视频页没反应 | 确认是 `bilibili.com` / `douyin.com`；重载扩展后新开标签 |
| 抖音标签卡死、崩 | 选项里先关掉「信息流广告 / 直播卡」；尽量进具体视频页再测 |
| 权限变更后异常 | 扩展页重新加载；必要时移除后按上面步骤再加载一次 |

---

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

```bash
node scripts/build-extension-content.mjs
```

## 油猴（可选）

若你更习惯脚本管理器：安装 Tampermonkey 后导入 [`media-ad-skip.user.js`](media-ad-skip.user.js)。**推荐仍用扩展**（设置页更完整）。

## 自测

```bash
node scripts/self-test.mjs
node scripts/round-test.mjs
```

## 许可

[MIT](LICENSE)

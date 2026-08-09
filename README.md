# Media Ad Skip

B站 + 抖音网页版广告跳过：**Chrome/Edge 扩展** 与油猴脚本双形态。

## 安装扩展（推荐）

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库的 [`extension/`](extension/) 目录
4. 打开任意 B站 / 抖音视频页；用扩展图标操作，详细设置见「选项」
5. 改代码后：扩展页「重新加载」→ **关掉旧标签再开**（或点弹窗「刷新当前页」）

内容脚本由 [`scripts/build-extension-content.mjs`](scripts/build-extension-content.mjs) 从油猴源生成：

```bash
node scripts/build-extension-content.mjs
```

## 油猴（可选）

安装 Tampermonkey 后导入 [`media-ad-skip.user.js`](media-ad-skip.user.js)。

## 能力

| 平台 | 能力 |
|------|------|
| B 站 | SponsorBlock + 章节/简介/字幕品牌词/弹幕时间戳 |
| 抖音 | 官方广告看点、字幕轨估跳、信息流划走、「跳过广告」按钮；无终点口播可软跳 |

弹窗支持：**立即跳过 / 撤销 / 本集不跳 / 标错了**。设置页可改品牌词、黑名单、软跳秒数、SB 开关，并导出标错反馈。隐私与上架文案见 [`extension/PRIVACY.md`](extension/PRIVACY.md)、[`extension/STORE.md`](extension/STORE.md)。

## 自测

```bash
node scripts/self-test.mjs
node scripts/round-test.mjs
```

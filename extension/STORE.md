# Media Ad Skip — Edge 上架指南（推荐）

Chrome 商店要交 **$5** 且国内支付常不好使；**Microsoft Edge 扩展商店注册免费**，用户也不少。本仓库优先走 Edge。

官方文档：[注册开发者](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/create-dev-account) · [发布扩展](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/publish-extension)

---

## 一句话卖点

自动跳过 B站 / 抖音网页版片内广告：社区标注 + 字幕品牌词 + 一键撤销。

## 商店短描述（建议 ≤ 132 字）

看视频时自动跳过恰饭段。B站优先 SponsorBlock，辅以字幕品牌词与弹幕时间戳；抖音支持官方广告看点与信息流广告/直播划走。误跳可撤销，可对本集禁用。设置仅存本地。

## 商店长描述（可粘贴）

Media Ad Skip 帮助你在 **B站、抖音网页版** 少点「跳过广告」。

【B站】
· 优先使用 SponsorBlock 社区广告分段
· 辅以章节/简介、字幕品牌词、弹幕时间戳识别恰饭段
· 进入广告区间自动跳到正片

【抖音】
· 识别官方广告看点并跳过口播段
· 可自动划走推荐流里的广告卡、直播卡
· 支持官方「跳过广告」按钮

【体验】
· 误跳可撤销；可对本集关闭跳过
· 设置页可改品牌词、黑名单、软跳秒数等
· 不上传观看账号与历史；无自建后端

开源：https://github.com/hualeide/media-ad-skip  
隐私：https://github.com/hualeide/media-ad-skip/blob/master/extension/PRIVACY.md

## 权限说明（Partner Center 问答可抄）

| 权限 | 用途 |
|------|------|
| 读取浏览数据（仅匹配站点） | 在 B站/抖音页注入脚本，读取播放进度并 seek |
| `storage` | 本地保存开关、品牌词、黑名单、标错反馈 |
| `alarms` | 定时检查 GitHub 是否有新版本 |
| 访问 bilibili / douyin / bsbsb.top / api.github.com | 公开广告分段、字幕/弹幕、看点、版本检查 |

不收集、不上传登录密码或观看历史。

---

## 你要准备的素材

| 资源 | 要求（Edge） |
|------|----------------|
| 扩展包 | `.zip`，内含 `manifest.json`（即本仓库 `extension/` 打的包） |
| Logo | **300×300** PNG（可用 `icons/icon128.png` 放大，或重导出） |
| 小宣传图 | **440×280** PNG（商店列表用） |
| 截图 | 至少 1 张，建议 **1280×800** 或 **1366×768** |
| 隐私政策 URL | 上面 GitHub `PRIVACY.md` 链接即可 |

### 建议截 4 张

1. B站视频页：刚跳过 / toast「撤销」
2. 扩展弹窗：自动跳过、划走开关
3. 设置页：品牌词列表
4. 抖音推荐流或长视频看点状态（可选）

本地预览设置页：Edge 加载扩展后 → 扩展管理 → Media Ad Skip → 「扩展选项」。

---

## 提交步骤（按这个做）

### 1. 打 zip 包

在仓库根目录：

```bash
node scripts/pack-extension.mjs
```

得到：`dist/media-ad-skip-extension-v*.zip`  
（zip **里面**应直接是 `manifest.json`、`background.js`、`content/`…，不要多套一层 `extension` 文件夹名也行，当前脚本就是把 `extension/*` 打进包。）

### 2. 注册 Partner Center（免费）

1. 打开：https://partner.microsoft.com/dashboard/microsoftedge/overview  
2. 用 **Microsoft 账户**（Outlook / Hotmail / Live）登录  
   - 也可用 **个人 GitHub** 登录后关联（[说明](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/github)）
3. 加入 **Microsoft Edge 程序**，选 **个人 (Individual)** 即可  
4. **无注册费**

公司账号要企业认证，个人更快。

### 3. 新建扩展并上传

1. Partner Center → **Edge 扩展** → **创建新扩展**
2. 上传刚才的 zip
3. 填商店信息（名称、短/长描述用本文上面文案）
4. 上传 Logo、小宣传图、截图
5. 填隐私政策 URL
6. 提交认证审核

审核可能要 **几天**；通过后会出现在 [Edge 加载项](https://microsoftedge.microsoft.com/addons)。

### 4. 以后更新

改代码 → bump `manifest.json` 的 `version` → 再 `pack` → Partner Center 上传新包 → 再审一轮。  
用户从商店安装的，通过后会**自动更新**。

---

## 和「加载已解压」的关系

| | 商店安装 | 本地加载 |
|--|----------|----------|
| 注册费 | Edge：**免费** | 无 |
| 自动更新 | 有 | 无（靠检查更新提示） |
| 适合 | 普通用户 | 你自己开发调试 |

开发时继续用加载已解压；稳定版再推商店。

## Chrome 商店？

可选，但要 **$5 一次性** 且支付麻烦就先不做。文案可复用本文。

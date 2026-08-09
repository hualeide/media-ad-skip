# Media Ad Skip 隐私说明

本扩展（Media Ad Skip）用于在 **B 站** 与 **抖音网页版** 跳过片内/信息流广告。

## 收集与存储

- 设置项（开关、倒计时、品牌词、黑名单）保存在浏览器本地：`chrome.storage.sync` / `chrome.storage.local`。
- **不会**上传你的观看历史、账号密码或弹幕内容到开发者服务器（本项目无自建后端）。

## 网络请求

扩展可能请求：

| 地址 | 用途 |
|------|------|
| `bsbsb.top` | SponsorBlock 社区广告分段 |
| `api.bilibili.com` / `comment.bilibili.com` / `*.hdslb.com` | 视频信息、弹幕、字幕 |
| `www.douyin.com` | 看点/视频详情（仅你打开的页面上下文） |

## 权限

- `storage`：保存设置
- 主机权限：仅限上述站点，用于读取公开接口与注入内容脚本

## 联系

开源仓库见项目 README。若需删除本地数据，可在浏览器扩展管理页「清除数据」或卸载扩展。

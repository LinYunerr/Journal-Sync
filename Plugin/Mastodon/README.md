# Mastodon 插件

用于将日记/笔记同步发送到 Mastodon (长毛象)。

## 配置说明

在 `config.json` 中配置以下信息：

- `instanceUrl`: Mastodon 实例地址，例如 `https://mastodon.social`
- `accessToken`: 访问令牌 (Access Token)，在 Mastodon 设置 -> 开发人员 -> 新建应用 中获取。需要 `write:statuses` 权限。
- `visibility`: 帖子可见性。可选值: `public` (公开), `unlisted` (不公开), `private` (仅关注者), `direct` (直接发送)。默认值为 `unlisted`。

## 功能

提供将纯文本内容发送到 Mastodon 的功能。依赖于主程序的判断逻辑（当开启了日记/笔记的 CMX 发送开关时触发）。

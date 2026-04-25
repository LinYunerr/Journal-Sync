# Mastodon Plugin

将内容发送到 Mastodon。

## Config

在 `config.json` 中配置：

- `instanceUrl`
- `accessToken`
- `visibility`

示例：

```json
{
  "instanceUrl": "https://mastodon.social",
  "accessToken": "YOUR_ACCESS_TOKEN",
  "visibility": "unlisted"
}
```

## Usage

1. 打开 `http://localhost:3000/?open=plugin-center`
2. 在插件中心启用 Mastodon 插件并保存配置
3. 使用插件动作测试连接

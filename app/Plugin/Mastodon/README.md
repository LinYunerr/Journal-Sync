# Mastodon Plugin

将内容发送到 Mastodon。

## Config

在插件中心保存后，配置会写入外层 `Journal-Sync/user-data/plugins/mastodon/config.json`：

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

## Notes

- `Journal-Sync/user-data/plugins/mastodon/config.json` 不应提交到版本控制，也不应随 `app/` 更新包覆盖

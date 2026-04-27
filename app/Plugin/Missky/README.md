# Missky Plugin

将内容发送到 Misskey 实例（`/api/notes/create`）。

## Config

在插件中心保存后，配置会写入外层 `Journal-Sync/user-data/plugins/missky/config.json`：

- `instanceUrl`
- `apiKey`
- `visibility`
- `localOnly`

示例：

```json
{
  "instanceUrl": "https://misskey.io",
  "apiKey": "YOUR_MISSKEY_API_TOKEN",
  "visibility": "public",
  "localOnly": false
}
```

## Usage

1. 打开重构主页中的插件中心启用 `Missky`
2. 填写实例地址和 API Token
3. 点击“测试连通性”

## Notes

- `Journal-Sync/user-data/plugins/missky/config.json` 不应提交到版本控制，也不应随 `app/` 更新包覆盖

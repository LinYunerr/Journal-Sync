# Flomo Plugin

将内容同步到 flomo。

## Config

在插件中心保存后，配置会写入外层 `Journal-Sync/user-data/plugins/flomo/config.json`。如需手工准备，可参考 `config.example.json`：

```json
{
  "apiUrl": "https://flomoapp.com/iwh/your-webhook/"
}
```

## Usage

1. 打开 `http://localhost:3000/?open=plugin-center`
2. 在插件中心启用 Flomo 插件并检查配置

## Notes

- `Journal-Sync/user-data/plugins/flomo/config.json` 不应提交到版本控制，也不应随 `app/` 更新包覆盖
- `apiUrl` 必须是有效的 flomo webhook 地址

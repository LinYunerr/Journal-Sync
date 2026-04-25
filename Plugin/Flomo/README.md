# Flomo Plugin

将内容同步到 flomo。

## Config

复制 `config.example.json` 为 `config.json`：

```json
{
  "apiUrl": "https://flomoapp.com/iwh/your-webhook/"
}
```

## Usage

1. 打开 `http://localhost:3000/?open=plugin-center`
2. 在插件中心启用 Flomo 插件并检查配置

## Notes

- `config.json` 不应提交到版本控制
- `apiUrl` 必须是有效的 flomo webhook 地址

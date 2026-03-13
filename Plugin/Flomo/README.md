# Flomo 插件

## 功能说明

将日记或笔记内容同步到 flomo。

## 配置说明

### 1. 配置文件

复制 `config.example.json` 为 `config.json`，并填入你的配置：

```json
{
  "apiUrl": "你的 flomo API URL"
}
```

### 2. 获取 API URL

1. 登录 flomo 网页版
2. 进入设置 → API
3. 复制 API URL（格式类似：`https://flomoapp.com/iwh/your-webhook/`）

## 使用方法

### 在主程序中启用

1. 访问 http://localhost:3000/plugins.html
2. 启用 flomo 插件
3. 在日记或笔记页面使用 flomo 开关控制是否同步

## 安全提示

- ⚠️ **不要将 `config.json` 提交到版本控制**
- ⚠️ API URL 包含敏感信息，请妥善保管

## 故障排查

### 同步失败

1. 检查 API URL 是否正确
2. 检查网络连接
3. 查看服务器日志获取详细错误信息

---

**版本**: 1.0
**最后更新**: 2026-03-11

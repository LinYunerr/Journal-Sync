# Quick Start

## 1. Install

```bash
npm install
```

## 2. Start

```bash
npm start
```

打开 `http://localhost:3000`。

## 3. Configure

先打开新版插件中心，配置 Obsidian 本地保存插件并启用需要的插件：

- `http://localhost:3000/?open=plugin-center`
- 旧入口 `http://localhost:3000/settings.html` 和 `http://localhost:3000/plugins.html` 会自动跳转

插件敏感信息保存在各插件目录下的 `config.json` 中。

## 4. Use

- 本地保存会写入当天同一个 `YYYY-MM-DD 日记.md`
- 每次保存会以 `## HH:mm:ss` 追加到当天文件，图片默认写入 `assets/`

## 5. Stop

```bash
npm stop
```

## Notes

- 默认端口是 `3000`
- 如需改端口，可使用 `PORT=3001 npm start`
- 运行数据默认写入 `data/`
- 更完整的项目说明见 `README.md`

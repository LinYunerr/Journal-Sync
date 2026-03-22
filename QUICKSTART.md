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

先在设置页配置 Obsidian 路径和需要启用的插件：

- `http://localhost:3000/settings.html`
- `http://localhost:3000/plugins.html`

插件敏感信息保存在各插件目录下的 `config.json` 中。

## 4. Use

- `日记` 会保存到 `YYYY-MM-DD 日记.md`
- `笔记` 会根据标题生成文件名，并按配置决定是否做 AI 分类和整理

## 5. Stop

```bash
npm stop
```

## Notes

- 默认端口是 `3000`
- 如需改端口，可使用 `PORT=3001 npm start`
- 运行数据默认写入 `data/`
- 更完整的项目说明见 `README.md`

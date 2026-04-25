# Obsidian Local Plugin

用于将内容保存到本地 Obsidian 今日日记。

- 独立维护插件配置：日记路径、笔记 Vault 路径、图片保存路径、文件名规则
- 保存逻辑固定为“`YYYY-MM-DD 日记.md` + `## HH:mm:ss` 分段追加”
- 图片默认写入日记路径下的 `assets/`，正文下方使用 `![[filename.png]]` 引用
- 在主页中归属 `save_local` 分区，可在插件中心启用/禁用

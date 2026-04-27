# Journal Sync 便携用户数据目录改造计划

## 执行进度

- [x] 阶段 1：新增统一路径模块
  - 已新增 `src/utils/app-paths.js`。
  - 已支持 `JOURNAL_SYNC_DATA_DIR`。
  - 默认数据目录为当前仓库布局下的 `user-data/`，并兼容未来 `app/ + user-data/` 布局。
  - 已提供 `getUserDataDir()`、`getDataPath()`、`getDataDirPath()`、`getPluginConfigPath()`、目录创建函数和旧数据迁移函数。
- [x] 阶段 2：迁移核心配置和缓存
  - `src/utils/config-manager.js` 已改为使用 `getDataPath('config.json')`。
  - `src/web/server.js` 已改为使用 `getUserDataDir()`、`getDataPath()`、`getDataDirPath('image-cache')`、`getDataDirPath('draft-cache')`。
  - 服务启动时会先执行 `migrateLegacyUserData()`，再创建默认配置，避免默认空配置阻断旧数据迁移。
  - 旧 `data/` 迁移策略为只复制、不删除、不覆盖。
- [x] 阶段 3：迁移插件配置
  - Flomo、Telegram、Mastodon、Missky、Obsidian Local 均已改为读取和保存 `user-data/plugins/<plugin>/config.json`。
  - 插件保存配置前会自动创建对应目录。
  - `migrateLegacyUserData()` 已覆盖旧 `Plugin/*/config.json` 到新插件配置目录的迁移。
  - Telegram Node 插件启动 Python 脚本时会传入 `JOURNAL_SYNC_TELEGRAM_CONFIG_FILE` 和 `TELEGRAM_CHANNELS_FILE`。
  - `Plugin/Telegram-Send/telegram_send.py` 已支持从 `JOURNAL_SYNC_TELEGRAM_CONFIG_FILE` 读取配置路径，频道缓存默认写入 `user-data/plugins/telegram/channels.json`。
- [x] `.gitignore` 调整
  - 已新增 `user-data/` 忽略规则。
  - 已保留旧 `data/` 和 `Plugin/*/config.json` 忽略规则，兼容历史布局。
- [x] 文档调整
  - `README.md`、`QUICKSTART.md`、`PluginGuide.md` 已更新为 `user-data/` 存储口径。
  - Flomo、Telegram、Mastodon、Missky、Obsidian Local 插件 README 已更新配置保存位置。
  - 文档已说明更新软件时应保留 `user-data/`。
- [x] 基础验证
  - `npm test` 通过。
  - 已新增 `app/test/app-paths.test.js`，覆盖 `app/ + user-data/` 默认路径、`JOURNAL_SYNC_DATA_DIR` 覆盖、用户数据探测、旧数据迁移和不覆盖已有 `user-data/`。
  - 已用临时 `JOURNAL_SYNC_DATA_DIR=/tmp/...` 验证主配置和插件配置会写入自定义数据目录。
  - 已用临时 `JOURNAL_SYNC_DATA_DIR=/tmp/...` 验证旧 `data/` 和旧插件配置会迁移到自定义数据目录。
- [x] 阶段 4：目录重组为 `app/ + user-data/`
  - 已将程序文件移动到 `app/`：`src/`、`public/`、`Plugin/`、`test/`、`package.json`、`package-lock.json`、`stop.sh`。
  - 核心项目文档保留在根目录：`README.md`、`QUICKSTART.md`、`PluginGuide.md`、`LICENSE`。
  - `src/utils/app-paths.js` 在 `app/` 布局下会把默认数据目录解析为外层 `Journal-Sync/user-data/`。
  - 迁移逻辑同时检查旧根目录 `data/`、`Plugin/*/config.json`，以及 `app/data/`、`app/Plugin/*/config.json` 中可能残留的历史数据。
  - 文档已改为从 `app/` 内执行 `npm install`、`npm start`、`npm test`。
- [x] 阶段 5：分发和更新流程
  - 当前分发边界已明确为只替换 `Journal-Sync/app/`。
  - 运行时数据统一保留在外层 `Journal-Sync/user-data/`，不进入更新包。
  - 根 `.gitignore` 已忽略 `user-data/`、旧 `data/`、`app/data/`、旧插件配置和 `app/Plugin/*/config.json`。
  - 根目录 README / QUICKSTART 已说明更新时只替换 `app/` 并保留 `user-data/`。

## 背景

当前项目把程序文件和用户数据混放在同一个源码目录里：

```text
Journal-Sync/
  src/
  public/
  Plugin/
  data/
```

其中 `data/` 和 `Plugin/*/config.json` 被 `.gitignore` 忽略，不会进入分发包或 Git 仓库。这对开发是正确的，但对普通用户更新软件不够友好：

- 如果用户下载新版并解压到一个新文件夹，旧版里的配置、历史、缓存不会自动出现。
- 如果用户直接删除旧文件夹再使用新版，旧数据会一起丢失。
- 插件配置目前分散在 `Plugin/<plugin>/config.json`，更新插件目录时容易误覆盖用户配置。

目标是保留“一个软件总文件夹”的使用体验，同时把程序文件和用户数据分开，让用户更新软件时只替换程序本体，不动历史数据。

## 目标目录结构

改造后的推荐结构：

```text
Journal-Sync/
  app/
    src/
    public/
    Plugin/
    package.json
    package-lock.json
    stop.sh
  README.md
  QUICKSTART.md
  PluginGuide.md
  LICENSE
  user-data/
    config.json
    history.json
    tasks.json
    mem0_insights.json
    mem0_vectors/
    image-cache/
    draft-cache/
    plugins/
      flomo/config.json
      telegram/config.json
      telegram/channels.json
      mastodon/config.json
      missky/config.json
      obsidian-local/config.json
```

更新原则：

- 新版本只替换 `Journal-Sync/app/`。
- `Journal-Sync/user-data/` 永远不随更新包覆盖。
- 用户仍然只需要管理一个总文件夹 `Journal-Sync/`。

## 核心设计

新增一个统一路径管理模块，例如：

```text
app/src/utils/app-paths.js
```

这个模块负责回答所有“用户数据应该放在哪里”的问题。业务代码不再自己拼：

```js
path.join(__dirname, '../../data/config.json')
path.join(__dirname, 'config.json')
```

而是统一调用类似能力：

```js
getUserDataDir()
getDataPath('config.json')
getDataDirPath('image-cache')
getPluginConfigPath('flomo')
```

这样以后如果要从便携模式切换到系统目录，或支持环境变量自定义数据目录，只需要改一个模块。

## 数据目录解析规则

建议按下面优先级决定用户数据目录：

1. 如果存在环境变量 `JOURNAL_SYNC_DATA_DIR`，使用它。
2. 否则使用便携目录：`Journal-Sync/user-data/`。

其中 `Journal-Sync/user-data/` 可以通过当前程序目录向上推导：

```text
Journal-Sync/app/src/utils/app-paths.js
                    ↑
                 app/
                    ↑
              Journal-Sync/
```

开发阶段为了减少一次性改动，也可以先支持当前仓库布局：

```text
Journal-Sync/
  src/
  public/
  Plugin/
  user-data/
```

等路径改造稳定后，再做最终的 `app/` 目录重组。

## 需要迁移的数据

旧位置：

```text
data/config.json
data/history.json
data/tasks.json
data/mem0_insights.json
data/mem0_vectors/
data/image-cache/
data/draft-cache/
Plugin/Flomo/config.json
Plugin/Telegram-Send/config.json
Plugin/Mastodon/config.json
Plugin/Missky/config.json
Plugin/Obsidian-Local/config.json
```

新位置：

```text
user-data/config.json
user-data/history.json
user-data/tasks.json
user-data/mem0_insights.json
user-data/mem0_vectors/
user-data/image-cache/
user-data/draft-cache/
user-data/plugins/flomo/config.json
user-data/plugins/telegram/config.json
user-data/plugins/mastodon/config.json
user-data/plugins/missky/config.json
user-data/plugins/obsidian-local/config.json
```

## 自动迁移策略

第一次启动新版时执行迁移：

1. 检查 `user-data/` 是否已经存在有效数据。
2. 如果新目录没有数据，再检查旧目录是否存在 `data/` 或 `Plugin/*/config.json`。
3. 将旧数据复制到 `user-data/`。
4. 复制完成后写入一个迁移标记文件：

```text
user-data/.migration.json
```

示例内容：

```json
{
  "from": "legacy-project-layout",
  "migratedAt": "2026-04-28T00:00:00.000Z",
  "version": 1
}
```

迁移原则：

- 只复制，不删除旧数据。
- 如果新位置已经有用户数据，不用旧数据覆盖新数据。
- 迁移前可以创建备份目录：

```text
user-data/backups/pre-migration-2026-04-28-000000/
```

## 需要修改的代码位置

### 1. 核心配置

当前文件：

```text
src/utils/config-manager.js
```

当前硬编码：

```js
const CONFIG_FILE = path.join(__dirname, '../../data/config.json');
```

改造目标：

```js
const CONFIG_FILE = getDataPath('config.json');
```

### 2. Web 服务缓存目录

当前文件：

```text
src/web/server.js
```

当前涉及：

```text
../../data
../../data/image-cache
../../data/draft-cache
```

改造目标：

```js
getUserDataDir()
getDataDirPath('image-cache')
getDataDirPath('draft-cache')
```

### 3. 插件配置

当前文件：

```text
Plugin/Flomo/index.js
Plugin/Telegram-Send/index.js
Plugin/Mastodon/index.js
Plugin/Missky/index.js
Plugin/Obsidian-Local/index.js
Plugin/Telegram-Send/telegram_send.py
```

当前插件大多使用：

```js
const CONFIG_FILE = path.join(__dirname, 'config.json');
```

改造目标：

```js
const CONFIG_FILE = getPluginConfigPath('flomo');
```

Python 脚本可以通过环境变量接收配置文件路径：

```text
JOURNAL_SYNC_TELEGRAM_CONFIG_FILE
```

由 Node 插件启动 Python 脚本时传入。

### 4. Obsidian 本地插件图片缓存

当前文件：

```text
Plugin/Obsidian-Local/index.js
```

当前涉及：

```text
../../data/image-cache
```

改造目标：

```js
getDataDirPath('image-cache')
```

## `.gitignore` 调整

改造后应忽略：

```gitignore
user-data/
data/
app/user-data/
app/data/
Plugin/*/config.json
app/Plugin/*/config.json
```

旧规则可以先保留一段时间，方便兼容历史布局：

```gitignore
data/
app/data/
Plugin/*/config.json
app/Plugin/*/config.json
```

等项目完全切换到 `app/ + user-data/` 后，再考虑清理旧规则。

## 文档调整

需要更新：

```text
README.md
QUICKSTART.md
PluginGuide.md
app/Plugin/*/README.md
```

重点说明：

- 用户数据统一保存在 `user-data/`。
- 更新软件时只替换 `app/`。
- 不要删除 `user-data/`，除非用户明确想清空配置和历史。
- 插件配置不再写在 `Plugin/<plugin>/config.json`，而是写在 `user-data/plugins/<plugin>/config.json`。

## 分阶段实施计划

### 阶段 1：新增统一路径模块

- 新增 `src/utils/app-paths.js`。
- 支持 `JOURNAL_SYNC_DATA_DIR`。
- 默认返回项目内的 `user-data/`。
- 添加必要的目录创建函数。

验收标准：

- 可以通过一个模块拿到所有用户数据路径。
- 暂时不改变现有行为也可以，但新模块必须可用。

### 阶段 2：迁移核心配置和缓存

- 修改 `src/utils/config-manager.js`。
- 修改 `src/web/server.js` 中的 `data/`、`image-cache/`、`draft-cache/`。
- 增加旧 `data/` 到新 `user-data/` 的自动迁移。

验收标准：

- 新安装用户的数据写入 `user-data/`。
- 老用户启动后，旧 `data/` 会被复制到 `user-data/`。
- 草稿恢复、图片上传、图片预览仍然正常。

### 阶段 3：迁移插件配置

- 修改各插件的配置路径。
- 把 `Plugin/*/config.json` 迁移到 `user-data/plugins/<plugin>/config.json`。
- Telegram Python 脚本改为从环境变量读取配置路径。

验收标准：

- 插件设置保存后写入 `user-data/plugins/`。
- 老插件配置可以自动迁移。
- Flomo、Telegram、Mastodon、Misskey、Obsidian Local 的配置读取和保存正常。

### 阶段 4：目录重组为 `app/ + user-data/`

- 将程序文件移动到 `app/`。
- 调整启动脚本和文档。
- 确认 `npm start` 或最终启动方式从 `app/` 内运行。
- 确认 `user-data/` 位于 `app/` 的同级目录。

验收标准：

- 用户可以在 `Journal-Sync/` 下看到清晰的 `app/` 和 `user-data/`。
- 删除并替换 `app/` 后，旧 `user-data/` 仍能被新版读取。

### 阶段 5：分发和更新流程

- 分发包只包含 `app/`，不包含真实 `user-data/`。
- 可以包含一个空目录说明文件：

```text
user-data/.keep
```

但更新包不应覆盖用户已有的 `user-data/`。

推荐用户更新方式：

```text
1. 退出 Journal Sync
2. 删除或替换 Journal-Sync/app/
3. 保留 Journal-Sync/user-data/
4. 启动新版
```

后续如果有自动更新器，也应只更新 `app/`。

## 测试清单

### 新用户测试

- 删除 `data/` 和 `user-data/`。
- 启动应用。
- 保存基础配置。
- 配置插件。
- 上传图片。
- 写入草稿。
- 确认所有运行时数据都进入 `user-data/`。

### 老用户迁移测试

- 准备旧布局：

```text
data/config.json
data/draft-cache/home-v2.json
data/image-cache/*
Plugin/Flomo/config.json
Plugin/Telegram-Send/config.json
```

- 启动新版。
- 确认自动生成 `user-data/`。
- 确认配置、草稿、图片缓存、插件设置均可读取。
- 确认旧数据没有被删除。

### 更新测试

- 使用新版运行一段时间，产生 `user-data/`。
- 用另一份新版 `app/` 替换旧 `app/`。
- 启动应用。
- 确认配置、草稿、插件设置和历史记录仍然存在。

### 环境变量测试

- 设置 `JOURNAL_SYNC_DATA_DIR=/tmp/journal-sync-test-data`。
- 启动应用。
- 确认所有数据写入该目录，而不是默认 `user-data/`。

## 风险和注意事项

- 如果用户删除整个 `Journal-Sync/` 文件夹，`user-data/` 也会被删除。这是便携模式的自然代价。
- 更新包不能包含会覆盖用户数据的真实 `user-data/` 内容。
- 插件配置里可能包含敏感密钥，迁移和备份都不能打印完整密钥到日志。
- 路径迁移期间应保留旧路径 fallback，避免一次更新导致老用户配置丢失。
- 如果未来做成 macOS `.app` 或 Windows 安装器，程序目录可能不可写；届时可以继续通过 `JOURNAL_SYNC_DATA_DIR` 或系统数据目录解决。

## 当前最终状态

当前已完成程序和用户数据的物理分离：

```text
Journal-Sync/
  app/
  README.md
  QUICKSTART.md
  PluginGuide.md
  LICENSE
  user-data/
```

更新时只替换 `app/`，保留 `user-data/`，从而实现“只更新软件本体，历史数据自然保留”。

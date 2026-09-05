# Journal Sync Bridge: AI Working Context

## Purpose

This repository is the source for **Journal Sync**, an Obsidian plugin (`journal-sync-bridge`). It lets users create timestamped daily-journal entries in their vault and publish selected text, a `##` heading block, or a full note to flomo, Telegram, Mastodon, Misskey, Bluesky, Weibo, Notion, and Threads.

The plugin runs entirely in Obsidian. It must not require a separate backend service. Images referenced from the vault can be sent with content; Telegram uploads them directly through the Bot API.

## Release Status

- This plugin is published in the public GitHub repository `Journal-Sync`.
- The current source version is `1.0.8` (`manifest.json` / `package.json`). Treat that as the working version; GitHub Releases may lag until the user explicitly publishes.
- The repository includes both source code and the generated `main.js`; GitHub Releases attach `main.js`, `manifest.json`, and `styles.css`.
- Publication status is context, not standing permission to write Git history. Do not commit, tag, push, or create a GitHub Release unless the user explicitly requests Git publication in the current task.
- Continue to use the existing build and verification flow for ordinary changes. A completed build does not imply that Git operations should follow.

## Read This First

Do not scan the whole repository at the start of a task. Start with this file, then read only the source files directly related to the requested behavior.

Use `README.md` and `README.zh-CN.md` for installation and user-facing behavior. Use `docs/development.md` for public architecture, build, and release guidance; keep this file focused on agent constraints. Treat the following as the normal source of truth:

| Area | Files |
| --- | --- |
| Plugin lifecycle, commands, journal creation, content extraction, adapter dispatch, vault image resolution | `src/main.js` |
| Publishing dialog, target presets, image grid, Telegram channel selection, send orchestration | `src/ui/send-modal.js` |
| Unified payload builder (content + images), used by send-modal.js | `src/core/payload.js` |
| Telegraph API client, used by telegram.js | `src/core/telegraph.js` |
| Settings page shell, enable toggles, manifest-driven generic rendering, debounced persistence | `src/ui/settings-tab.js` |
| Platform adapter registry | `src/core/adapter-registry.js` |
| Shared MIME type inference (image + video), used by payload.js and adapters | `src/core/mime.js` |
| Shared multipart/form-data body builder (mastodon, missky) | `src/core/multipart.js` |
| Diary filename/heading placeholder rendering (date/sanitize helpers) | `src/core/diary.js` |
| Vault path normalization/join/dirname, image/URL detection | `src/core/vault-path.js` |
| Markdown image-ref parsing (`@图片N` token source) | `src/core/image-refs.js` |
| Rich-draft builder from uploaded image refs | `src/core/rich-draft.js` |
| Editor content extraction (selection / page / heading scope) | `src/core/content.js` |
| Settings deep-merge (upgrade never resets user config) | `src/core/settings.js` |
| Per-platform manifests, settings schema or custom panels, HTTP requests and validation | `src/adapters/flomo.js`, `telegram.js`, `mastodon.js`, `missky.js`, `notion.js`, `bluesky.js`, `weibo.js`, `threads.js` |
| Plugin metadata | `manifest.json` |
| Plugin styling | `styles.css` |
| Build configuration | `esbuild.config.mjs`, `package.json` |

## Architecture

- `src/main.js` is the CommonJS plugin entry point. It registers the three commands: `journal-sync-new`, `journal-sync-send`, and `journal-sync-log`.
- `src/adapters/` contains isolated adapters. Each adapter exposes a `manifest` (including its settings schema) and an `execute()` implementation, then is registered in `src/main.js`; the full export contract is described in Settings Architecture below.
- Pure logic (diary filename/heading, vault paths, image-ref parsing, rich-draft, content extraction, settings deep-merge, MIME, multipart) lives in `src/core/` as standalone modules, not inside `src/main.js`. `src/main.js` keeps only lifecycle, command registration, and vault/adapter orchestration. This keeps the pure helpers unit-testable and reusable.

## Payload And Send Pipeline

`src/core/payload.js` is the only payload builder. `send-modal.js` must call `buildPayload()`; adapters must not reconstruct attachments or plain text themselves.

```js
{
  content: string,          // Markdown; local image positions are `@图片N` tokens
  plainText: string,        // Markdown image syntax and `@图片N` tokens removed
  title: string,            // send-scope / note title
  attachments: [{
    token: '@图片1',
    filename: string,
    vaultPath: string,
    mimeType: string,
    kind: 'image'
  }],
  readAttachment: (vaultPath) => Promise<ArrayBuffer> | ArrayBuffer | null
}
```

Invariants:

1. New adapters depend only on this payload and their own `config`. They must not read the send-modal DOM or platform-specific UI fields.
2. Image tokens may be non-contiguous (`@图片1` then `@图片10`). Match by token, never by array index. `payload.js` keeps only tokens still referenced in `content` and must not treat `@图片1` as a prefix of `@图片10`.
3. Pasted images exist only as in-memory Blobs until the send finishes; do not clear them during a send.
4. `readAttachment` takes a vault-relative path. Do not introduce OS absolute paths or Node filesystem APIs.
5. Flomo publishes `plainText` (plus remote image URLs extracted from original content). Never send leftover `@图片N` tokens in Flomo body text.

Send flow in `send-modal.js`:

1. Rebuild referenced images from the current editor body.
2. `buildPayload()`.
3. `getAttachmentWarnings(targetAdapters, payload)` using each adapter's `manifest.capabilities`.
4. On warning, the publish button enters a 5-second confirm state; after timeout the next click must re-check, not send.
5. After confirm, `validateAll(targetAdapters, payload, configs)`: `error` blocks the send, `warning` is a Notice.
6. Close the modal and call `executeAdapter(id, payload, extraConfig)` in the background, in target order.
7. Results are aggregated per adapter. Telegram multi-channel results are expanded; partial success is allowed. No rollback or automatic retry.

Telegram channel selection, send mode, and Telegraph title are send-modal-only. Pass them once as `extraConfig`; do not persist them. When a Telegraph account is created during send, persist only `{ telegraphAccessToken }` through `saveConfig`.

`telegram.runAction('discoverChannels' | 'testConnection', ...)` must return `{ success, message, data: { channels } }`. `settings-tab.js` reads `result.data.channels`. Changing that shape requires updating the caller and clicking through the settings page.

Attachment limits (`maxAttachments`, `maxAttachmentSize`, `warnOnAttachmentCount`, `warnOnAttachmentSize`) live on `manifest.capabilities`. Count/size execute thresholds must be read from those fields, not duplicated constants. Current behavior: Flomo does not warn on local images; Mastodon / Misskey / Telegram warn then send the first 4 / 16 / 9 images; Notion 5 MB is a confirm-and-continue warning (compression stays adapter-owned), not a hard stop. Notion's 100-image declaration has no UI warning or truncation.

Multi-platform sends may succeed on some targets and fail on others. Do not add rollback or automatic retry.

## Settings Architecture

The settings page is registry-driven. `src/ui/settings-tab.js` renders one tab per adapter from `adapterRegistry.getAll()`, sorted by `manifest.displayOrder` ascending (missing values last, ties keep registration order); the tab label is `manifest.name`. The main settings area is unchanged. The enable toggle (`启用 <name>`) is rendered once by the settings page; adapter panels must not render their own toggle.

- Dispatch: an adapter that exports `renderSettings(containerEl, ctx)` gets a custom panel; otherwise the UI is generated from `manifest.settings.fields`.
- Generic field types (`_renderGenericAdapterSettings`): `text` / `password` (placeholder, desc, 400 ms debounced merged save, trimmed), `toggle` (immediate save), `select` (`options` as `[{value, label}]`, immediate save), `action` (button calling `adapter.runAction(field.action, config, ctx.requestUrl)`; success Notices `result.message` and re-renders, failure Notices the error), `info` (static row). Unrecognized types are skipped.
- Panel context: `ctx = { plugin, containerEl, scheduleConfigSave(patch), saveConfig(patch), refresh(), requestUrl }`. `scheduleConfigSave` merges into memory and persists with a 400 ms debounce; `saveConfig` is an async immediate merge-and-save; `refresh()` flushes pending saves and re-renders the settings page.
- Default values are derived in `main.js buildDefaultSettings` (the registry is built before settings merge): `adaptersEnabled[id] = manifest.enabledByDefault === true`; `adaptersConfig[id]` starts from each `manifest.settings.fields[*].default` and is overridden by an exported `defaultConfig`. `deepMergeSettings` keeps existing `data.json` values, so upgrades never reset user configuration.
- Adapter export contract: `manifest` (`id` / `name` / `displayOrder` / `enabledByDefault` / `capabilities` / `settings.fields`), `execute`, `validate`, optional `runAction`, optional `renderSettings` (custom panel), optional `defaultConfig`.

Registered adapters:

| Adapter | `displayOrder` | Settings panel |
| --- | --- | --- |
| flomo | 10 | manifest schema |
| telegram | 20 | custom (channel discovery/selection, Telegraph account management) |
| mastodon | 30 | custom (multi-account cards; removing an account cleans up `publishPresets` references) |
| missky | 40 | manifest schema; visibility is `public` / `home` / `followers` only. Do not reintroduce `specified` (direct message) — that option requires `visibleUserIds` which this plugin does not collect |
| bluesky | 50 | manifest schema including a `testConnection` action field; pure helpers live in `src/adapters/bluesky-core.js`, covered by `npm run test:bluesky` |
| weibo | 60 | custom (OAuth authorization flow) |
| notion | 70 | custom (sections expand conditionally on `targetType` / `pageWriteMode`) |
| threads | 80 | custom (OAuth authorization flow, test connection, reply-control). Phase 1 is plain text only |

Documented special cases:

- Telegraph heading levels are capped by the global send scope. The clamp lives in `_renderMainSettings`' send-scope `onChange` (comment-marked), and the telegram panel's title-level dropdown computes its options from `sendScope`. This is the only cross-adapter settings coupling in the plugin.
- The send modal (`src/ui/send-modal.js`) still special-cases telegram (channel picker) and mastodon (multi-account picker) target rendering, and hard-excludes both ids from the generic adapter target list. The settings refactor did not touch the send modal.
- `main.js` keeps the one-time Mastodon single-account to multi-account migration (comment-marked for removal after a few versions).
- **Telegram rich mode does not fall back to plain send.** `sendRichMessage` is not a public Bot API method. If it fails, report the error and stop that send. Do not silently retry as `sendPhoto` / `sendMediaGroup` / `sendMessage`. Changing this needs an explicit user decision.

## Build And Verification

Run the production build after changes that can affect the plugin or its output, including `src/`, `styles.css`, `manifest.json`, build configuration, or package dependencies:

```bash
npm run build
```

Do not rebuild for Markdown-only changes such as plans, notes, `README.md`, or `AGENTS.md`. This production build writes `main.js` and removes `console` and `debugger` calls. There is currently no `lint` script; `npm test` runs the full unit-test suite (`tests/bluesky.test.js` over the pure helpers in `src/adapters/bluesky-core.js`, and `tests/core.test.js` over the `src/core/` pure helpers — payload token matching, `deepMergeSettings`, diary filename/heading, MIME, multipart). For source changes, also inspect the relevant changed code and build output; test the affected flow manually in Obsidian when practical.

### After-Build Report

After **every build**, explicitly report which files need to be copied to the user's Obsidian plugin folder. Obsidian loads only `main.js`, `manifest.json`, and `styles.css` from its installed plugin directory, and not all three necessarily change with each build. Determine which of these three files were modified by this build (e.g. via `git status`, `git diff --name-only`, or by comparing build timestamps), and list exactly those files in the final response so the user knows what to move. Never assume all three changed, and do not tell the user to copy `data.json` or `src/` files.

For iterative local development, use `npm run dev`. Do not leave the watch process running unless requested.

## Obsidian Constraints

- Use Obsidian APIs (`Plugin`, `Modal`, `Setting`, `Notice`, `requestUrl`, vault APIs) rather than Node-only APIs in runtime code.
- The esbuild target is browser/CJS. `obsidian`, Electron, CodeMirror, and Lezer packages are external, not bundled.
- Preserve mobile compatibility unless the change specifically needs a desktop-only capability. `manifest.json` has `isDesktopOnly: false`.
- Use vault-relative paths for vault files. Resolve image links through the vault and metadata cache instead of assuming an OS path.

## Security And Data Handling

- Never add real tokens, webhook URLs, access keys, channel IDs, or user-specific defaults to source, documentation, logs, tests, or commits.
- Keep credentials in Obsidian-managed settings (`data.json`) entered by the user. Do not print request headers, settings objects, or API responses that could reveal them.
- If existing source or generated files contain credentials, do not reproduce them. Flag the exposure and move them to runtime settings when modifying that area.


## Change Guidelines

- Make the smallest compatible change.
- Keep platform-specific networking inside its adapter and shared formatting/upload logic in `src/core/`.
- When adding a platform, create `src/adapters/<id>.js` with a `manifest` (including `settings.fields`) plus `execute`/`validate` and optional `runAction`; export `renderSettings` and `defaultConfig` only for panels the schema cannot express. Then add one `require` line to `ADAPTER_MODULES` in `src/main.js` and rebuild. No changes to `settings-tab.js` or `DEFAULT_SETTINGS` are needed.
- Keep `package.json`, `manifest.json`, and `versions.json` aligned when releasing. The release tag must exactly match `manifest.json.version` and must not use a `v` prefix.
- Do not manually alter generated `main.js`; verify it changes only as a result of `npm run build`.
- `.github/workflows/release.yml` builds tagged versions and attaches only `main.js`, `manifest.json`, and `styles.css` to the GitHub Release. Release notes are extracted from `CHANGELOG.md` (section matching the tag), falling back to a plain title if no changelog entry exists.
- To trigger the release workflow, push a git tag matching `manifest.json.version` (no `v` prefix). The workflow verifies version alignment across tag, `manifest.json`, `package.json`, and `versions.json`, then builds and creates the GitHub Release automatically—no manual release steps.
- Every release must have a corresponding `## [version]` section in `CHANGELOG.md` with human-readable update notes; the release workflow uses it as the GitHub Release body.

## Known Issues And Improvement Backlog

From the 2026-09-06 full-pipeline review, with user decisions recorded 2026-09-06. Items marked **[user decision pending]** must not be implemented without a new explicit user decision; the rest is agreed direction for future work.

### Send atomicity rule (user decision, 2026-09-06)

The user has decided the atomicity policy for all adapters:

- **Across platforms: partial success is allowed.** If a send targets multiple platforms and one fails, the other platforms' sends still proceed. (Already current behavior; keep it.)
- **Within a single platform target: all-or-nothing.** A platform target is a single adapter execution — for multi-account adapters, one account; for Telegram, one channel. If any step inside one target fails (image read, image upload, text post), that target must publish **nothing**: no text-only post, no partial image set. Fail the whole target and report it.

Current conformance:

- Mastodon conforms (upload failure aborts before the status post; the error already states 未发送任何内容). Note: images uploaded before the failure remain orphaned server-side; this is accepted, not a bug to fix.
- Telegram plain mode **does not conform**: it sends images in chunks of up to 10, so a failure on a later chunk leaves earlier chunks already posted; and when text exceeds the 1024-char caption limit, text is sent as a separate message after images, so a text failure leaves images posted (and vice versa). Aligning Telegram plain mode to the all-or-nothing rule is **[user decision pending]** on *how* (e.g. pre-flight validation vs. restructure), because Telegram's API has no transactional send and any alignment adds failure modes.
- Telegram rich mode conforms (single API call).
- Telegram Telegraph mode conforms (page creation and channel posts are sequential, but a channel-post failure aborts remaining channels; already-posted channels stay — this is cross-target partial success, allowed).

### Product decisions pending

2. **[implemented 2026-09-06, branch `logcreate`]** Send-result review: the `JournalSync-Log` command opens a send-log modal listing the last 10 send snapshots (each click of 发布 that reached dispatch, plus failed pre-dispatch attempts marked 未发出). Each entry has a single 重新编辑 button that reopens the send modal prefilled from the snapshot (content and image tokens restored verbatim — no token renumbering; target selection restored via preset pointer only, never channel lists; Telegram one-shot options restored). Snapshots live in `<plugin-dir>/send-log/<dir>/snapshot.json` with cached copies of all referenced images, capped at 10 entries. The snapshot's diagnostics layer records per-target results (adapter/channel/account, success, error) for debugging but is not surfaced in the UI. Decisions: pre-warning first-click confirmations are not logged; log write failure only Notices and never affects the send; restoring a deleted preset falls back to the current active preset.
3. **[user decision pending]** Telegram plain-mode chunked image sending violates the all-or-nothing rule above. Any fix changes send behavior for large image sets; needs a decision on approach.
4. **[declined by user, 2026-09-06]** CI on push/PR (former item 8): not pursued for now. Do not add CI workflows without a new explicit request.

### Agreed technical debt

Numbering here is independent of the "Product decisions pending" section above (item numbers restart per section). The user understands items 4 and 5 as the same class of problem ("same logic copied into many files") and wants it tracked as one effort. Local working notes live in `docs/tech-debt.md` (git-ignored; do not commit).

4. ~~`getMimeType` is declared five times (`core/payload.js`, `mastodon.js`, `misskey.js`, `notion.js`, `telegram.js`); payload.js already exports it. Mastodon and misskey also duplicate near-identical multipart body construction. Extract shared versions into `src/core/` and import them from adapters; do not re-declare.~~ **[implemented 2026-09-06]** Unified `getMimeType` (image + video) in `src/core/mime.js`; shared `buildMultipartBody` in `src/core/multipart.js`. payload.js, mastodon, missky, notion, telegram all import from core now. Telegram keeps a thin `telegramImageMimeType` wrapper because its plain-mode fallback is `image/jpeg`, not `application/octet-stream`.
5. ~~Pure helpers are stranded inside `src/main.js` (`parseImageRefs`, `getSelectedOrBlockContent`, `buildDiaryFilename` with its date/sanitize helpers, `deepMergeSettings`, `buildRichDraftFromUploadedMarkdown`). They have no dependency on the Plugin class and cannot be unit-tested in place. Direction: move them into `src/core/` modules and require them from main.js. This is the prerequisite for item 6.~~ **[implemented 2026-09-06]** Moved to `src/core/`: `diary.js` (filename/heading + date/sanitize), `vault-path.js`, `image-refs.js`, `rich-draft.js`, `content.js`, `settings.js`. `src/main.js` now imports them and keeps only lifecycle + orchestration.
6. ~~Core invariants have no test coverage (only Bluesky is tested). Once item 5 lands, add tests for: payload token matching (`@图片1` is not a prefix of `@图片10`; non-contiguous tokens; unreferenced tokens filtered out), `deepMergeSettings` semantics (non-empty user arrays never absorb default arrays; empty-string/null/undefined scalars are replaced by defaults — intentional upgrade behavior), and diary filename/heading placeholder rendering.~~ **[implemented 2026-09-06]** `tests/core.test.js` covers payload token matching, `deepMergeSettings`, diary filename/heading, MIME, and multipart. `npm test` runs it alongside `tests/bluesky.test.js`.
7. Minor: `package.json` declares `"obsidian": "latest"` (pin a caret range instead); `send-modal.js` (~1530 lines) mixes preset management, image grid, telegram/telegraph UI, and send orchestration — split it when next touched for other reasons, not as a standalone refactor.

### Completed 2026-09-06

- Failure result Notice duration extended 10 s → 20 s (success stays 6 s); dead `id === 'Telegram'` branch in send-modal result aggregation removed.
- `plugin.requestUrl` pass-through in main.js removed (verified single caller — the settings-tab panel context — which now imports obsidian's `requestUrl` directly; adapters were already direct). No behavior change.
- Backlog items 4, 5, 6 implemented (see Agreed technical debt above): unified MIME + multipart in `src/core/`, pure helpers moved out of `src/main.js` into `src/core/`, and `tests/core.test.js` added. `npm test` runs both test files.

Remaining backlog: item 3 (Telegram plain-mode atomicity, user decision pending) and item 7 (minor: pin `obsidian` dep, split `send-modal.js` when next touched).


# Journal Sync Bridge: AI Working Context

## Purpose

This repository is the source for **Journal Sync**, an Obsidian plugin (`journal-sync-bridge`). It lets users create timestamped daily-journal entries in their vault and publish selected text, a `##` heading block, or a full note to flomo, Telegram, Mastodon, Misskey, Bluesky, Weibo, and Notion.

The plugin runs entirely in Obsidian. It must not require a separate backend service. Images referenced from the vault can be sent with content; Telegram uploads them directly through the Bot API.

## Release Status

- This plugin is published in the public GitHub repository `Journal-Sync`.
- The current published version is `1.0.2`.
- The repository includes both source code and the generated `main.js`; GitHub Releases attach `main.js`, `manifest.json`, and `styles.css`.
- Publication status is context, not standing permission to write Git history. Do not commit, tag, push, or create a GitHub Release unless the user explicitly requests Git publication in the current task.
- Continue to use the existing build and verification flow for ordinary changes. A completed build does not imply that Git operations should follow.

## Read This First

Do not scan the whole repository at the start of a task. Start with this file, then read only the source files directly related to the requested behavior.

Use `README.md` and `README.zh-CN.md` for installation and user-facing behavior. Use `docs/development.md` for public architecture, build, and release guidance; keep this file focused on agent constraints. Treat the following as the normal source of truth:

| Area | Files |
| --- | --- |
| Plugin lifecycle, commands, journal creation, content extraction, adapter dispatch, vault image resolution | `src/main.js` |
| Send dialog and send-target selection | `src/ui/send-modal.js` |
| Settings page shell, enable toggles, manifest-driven generic rendering, debounced persistence | `src/ui/settings-tab.js` |
| Platform adapter registry | `src/core/adapter-registry.js` |
| Unified payload builder (content + images), used by send-modal.js | `src/core/payload.js` |
| Telegraph API client, used by telegram.js | `src/core/telegraph.js` |
| Per-platform manifests, settings schema or custom panels, HTTP requests and validation | `src/adapters/flomo.js`, `telegram.js`, `mastodon.js`, `missky.js`, `notion.js`, `bluesky.js`, `weibo.js` |
| Plugin metadata | `manifest.json` |
| Plugin styling | `styles.css` |
| Build configuration | `esbuild.config.mjs`, `package.json` |

## Architecture

- `src/main.js` is the CommonJS plugin entry point. It registers the two commands: `journal-sync-new` and `journal-sync-send`.
- `src/adapters/` contains isolated adapters. Each adapter exposes a `manifest` (including its settings schema) and an `execute()` implementation, then is registered in `src/main.js`; the full export contract is described in Settings Architecture below.
- `src/core/` contains reusable, platform-independent logic.
- `src/ui/` contains Obsidian UI components and receives the plugin instance for settings and adapter execution.
- `main.js` in this directory is generated code. Do not edit it manually; edit `src/` and rebuild.
- Obsidian loads only `main.js`, `manifest.json`, and `styles.css` from its installed plugin directory.
- Runtime settings are saved by Obsidian in `data.json`. This file can contain credentials and must never be treated as safe to expose, log, copy, or commit.

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
| missky | 40 | manifest schema (its `specified` visibility option was never shown by the old hand-written UI and is now rendered — an expected fix) |
| bluesky | 50 | manifest schema including a `testConnection` action field; pure helpers live in `src/adapters/bluesky-core.js`, covered by `npm run test:bluesky` |
| weibo | 60 | custom (OAuth authorization flow) |
| notion | 70 | custom (sections expand conditionally on `targetType` / `pageWriteMode`) |

`src/adapters/threads.js` exists (manifest schema and `runAction`) but is not yet registered in `ADAPTER_MODULES`; registering it needs one `require` line plus a `displayOrder`.

Documented special cases:

- Telegraph heading levels are capped by the global send scope. The clamp lives in `_renderMainSettings`' send-scope `onChange` (comment-marked), and the telegram panel's title-level dropdown computes its options from `sendScope`. This is the only cross-adapter settings coupling in the plugin.
- The send modal (`src/ui/send-modal.js`) still special-cases telegram (channel picker) and mastodon (multi-account picker) target rendering, and hard-excludes both ids from the generic adapter target list. The settings refactor did not touch the send modal.
- `main.js` keeps the one-time Mastodon single-account to multi-account migration (comment-marked for removal after a few versions).

## Build And Verification

Run the production build after changes that can affect the plugin or its output, including `src/`, `styles.css`, `manifest.json`, build configuration, or package dependencies:

```bash
npm run build
```

Do not rebuild for Markdown-only changes such as plans, notes, `README.md`, or `AGENTS.md`. This production build writes `main.js` and removes `console` and `debugger` calls. There is currently no `lint` script; `npm run test:bluesky` runs the Bluesky adapter unit tests (`tests/bluesky.test.js` over the pure helpers in `src/adapters/bluesky-core.js`). For source changes, also inspect the relevant changed code and build output; test the affected flow manually in Obsidian when practical.

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

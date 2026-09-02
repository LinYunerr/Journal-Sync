# Journal Sync development guide

[Back to README](../README.md) · [中文说明](../README.zh-CN.md)

This document contains the implementation, build, and release information that is intentionally kept out of the user-facing READMEs.

## Design constraints

- Journal Sync runs entirely inside Obsidian. Runtime code must use Obsidian and browser APIs rather than require a separate service or Node-only APIs.
- The build target is browser/CommonJS. Obsidian, Electron, CodeMirror, and Lezer packages remain external to the bundle.
- Vault files are addressed by vault-relative paths. Local images are resolved through the vault and metadata cache, never by assuming an operating-system path.
- Platform-specific networking belongs in its adapter. Formatting, image ordering, and other cross-platform behavior belong in `src/core/`.
- Mobile compatibility should be preserved unless a feature explicitly requires a desktop-only API.

## Repository map

| Area | Source of truth |
| --- | --- |
| Plugin lifecycle, commands, journal creation, content extraction, dispatch, and vault image resolution | `src/main.js` |
| Publishing dialog, target presets, and Telegram channel selection | `src/ui/send-modal.js` |
| Settings page shell: adapter tabs, enable toggles, manifest-driven generic rendering, debounced persistence | `src/ui/settings-tab.js` |
| Adapter registration | `src/core/adapter-registry.js` |
| Rich content and Telegram segment rendering | `src/core/content-renderer.js` |
| Platform manifests, settings schema or custom panels, requests, and validation | `src/adapters/` |
| Plugin metadata and compatibility | `manifest.json` |
| Plugin styles | `styles.css` |
| Build configuration | `esbuild.config.mjs`, `package.json` |

`main.js` at the repository root is generated. Do not edit it directly; change `src/` and rebuild.

Obsidian installs only these runtime files:

```text
main.js
manifest.json
styles.css
```

## Local development

Install the locked dependencies:

```bash
npm ci
```

Create a production bundle:

```bash
npm run build
```

Start the development watcher when iterating locally:

```bash
npm run dev
```

The production build writes `main.js` and removes `console` and `debugger` calls. Source, styles, manifest, dependency, or build-configuration changes require a production build before delivery. Markdown-only documentation changes do not.

There is currently no lint script. `npm run test:bluesky` runs the Bluesky adapter unit tests (`tests/bluesky.test.js` against the pure helpers in `src/adapters/bluesky-core.js`). Verify the affected flow in Obsidian when practical. At minimum, exercise the command or platform path that changed and inspect the resulting notice or published content.

## Settings system

The settings page is registry-driven. `src/ui/settings-tab.js` owns the shell — main settings, adapter tabs, enable toggles, and persistence — while each adapter owns its own configuration surface.

### Adapter tabs and enable toggles

- Tabs are generated from `adapterRegistry.getAll()`, sorted by `manifest.displayOrder` ascending (missing values sort last; ties keep registration order). The tab label is `manifest.name`.
- The settings page renders a single `启用 <name>` enable toggle per adapter. Custom panels must not render their own toggle, and nothing beyond the toggle is shown while the adapter is disabled.

### Dispatch

For the active adapter, the settings page calls `renderSettings(containerEl, ctx)` when the adapter exports it (custom panel); otherwise `_renderGenericAdapterSettings` generates the UI from `manifest.settings.fields`. A rendering error is caught and surfaced as a Notice instead of breaking the page.

### Generic field types

| Type | Behavior |
| --- | --- |
| `text` | Text input. Supports `placeholder` and `desc` (or `description`). Saves through `ctx.scheduleConfigSave` (400 ms debounce, merged), with whitespace trimmed. |
| `password` | Same as `text` with a masked input. |
| `toggle` | Boolean switch saved immediately through `ctx.saveConfig`. |
| `select` | Dropdown built from `field.options` as `[{ value, label }]`; saved immediately. |
| `action` | Button that calls `adapter.runAction(field.action, config, ctx.requestUrl)`. On success it shows a Notice with `result.message` (falling back to `field.successMessage`) and re-renders the settings page; on failure it shows an error Notice. Rendered only when the adapter also exports `runAction`. |
| `info` | Static explanatory row (`label` plus `desc`). |

Fields with unknown `type` values are skipped, so structured configuration values are never overwritten by free text.

### Panel context (`ctx`)

Custom panels receive `ctx = { plugin, containerEl, scheduleConfigSave(patch), saveConfig(patch), refresh(), requestUrl }`:

- `scheduleConfigSave(patch)` merges `patch` into the adapter config in memory and persists it with a 400 ms debounce. Use it for per-keystroke text input.
- `saveConfig(patch)` merges and saves immediately; it is async. Use it for toggles, selects, and async results such as channel discovery.
- `refresh()` flushes pending debounced saves and re-renders the settings page.
- `requestUrl` is the plugin-bound Obsidian `requestUrl`, so actions and panels keep networking inside the adapter.
- `plugin` provides read access to shared state, e.g. `plugin.getAdapterConfig(id)` and `plugin.settings.sendScope`.

### Default value derivation

`buildDefaultSettings` in `src/main.js` derives per-adapter defaults from the registry. The registry is built before settings are merged in `onload`:

- `adaptersEnabled[id] = manifest.enabledByDefault === true`.
- `adaptersConfig[id]` starts from every `manifest.settings.fields[*].default` and is then overridden by the adapter's exported `defaultConfig` (adapter wins).
- The result is deep-merged into the loaded `data.json` via `deepMergeSettings`, which never overwrites existing non-empty values. Upgrades therefore do not reset user configuration.

### Custom panels

Adapters whose configuration is too interactive for the schema export `renderSettings(containerEl, ctx)`:

- `telegram` — channel discovery and selection, Telegraph account management.
- `mastodon` — multi-account cards; removing an account also removes its references from `publishPresets`.
- `weibo` — OAuth authorization flow.
- `notion` — sections that expand conditionally on `targetType` and `pageWriteMode`.

For a worked example, see the Telegram panel in `src/adapters/telegram.js`: it reads `ctx.plugin.getAdapterConfig('telegram')`, saves text input with `ctx.scheduleConfigSave`, runs channel discovery through `runAction('discoverChannels', ...)` and persists the result with `ctx.saveConfig`, then calls `ctx.refresh()`.

Known coupling: Telegraph heading levels are capped by the global send scope. The clamp lives in the send-scope `onChange` inside `_renderMainSettings` (comment-marked), and the Telegram panel computes its title-level options from `plugin.settings.sendScope`. This is the only documented cross-adapter settings coupling.

## Adding a destination

1. Create `src/adapters/<id>.js`. Export a `manifest` with `id`, `name`, `description`, `displayOrder`, `enabledByDefault`, `capabilities`, and `settings.fields`, plus `execute()` and `validate()` implementations, following an existing adapter with similar capabilities. Add `runAction` when a schema `action` field needs a backend call (for example `testConnection`).
2. Simple platforms stop here: the settings UI is generated from `manifest.settings.fields` (see [Settings system](#settings-system)).
3. For interactive configuration, also export `renderSettings(containerEl, ctx)` and, when defaults are needed beyond `field.default` values (for example account arrays), a `defaultConfig`.
4. Register the adapter by adding one `require('./adapters/<id>')` line to the `ADAPTER_MODULES` array in `src/main.js`. No changes to `src/ui/settings-tab.js` or `DEFAULT_SETTINGS` are required.
5. Add target selection behavior to `src/ui/send-modal.js` only when the generic target flow is insufficient, as telegram (channel picker) and mastodon (multi-account picker) do today.
6. Keep shared rendering or upload behavior in `src/core/`; do not duplicate it inside adapters.
7. Update both user READMEs and run `npm run build`.
8. Manually exercise configuration, enable/disable, selection, request validation, success, and failure behavior in Obsidian.

Work in progress: `src/adapters/threads.js` already exists (manifest schema and `runAction` design) but is not yet registered in `ADAPTER_MODULES`. Under the current architecture, registering it only requires adding one `require` line and a `displayOrder`.

## Settings and security

Obsidian persists runtime settings in `data.json` inside the installed plugin directory. It can contain tokens, webhooks, access keys, channel IDs, and other private values.

- Never commit, publish, log, or copy `data.json` into a release.
- Never put real credentials or user-specific defaults in source, documentation, tests, or generated output.
- Do not log request headers, complete settings objects, or API responses that can expose credentials.
- If a credential is exposed, revoke it at the platform and replace it in Obsidian settings.

## Versioning and releases

`package.json`, `manifest.json`, and `versions.json` must stay aligned. The release tag is the bare `x.y.z` version without a `v` prefix.

Use npm's version command to update the version files:

```bash
npm version patch
npm version minor
npm version major
```

Before creating a release:

1. Run `npm run build`.
2. Verify the changed behavior in Obsidian.
3. Confirm that no credentials, `data.json`, or personal information are staged.
4. Push the version commit and matching tag.

`.github/workflows/release.yml` verifies version alignment, installs locked dependencies, builds the production bundle, attests the build provenance, and creates a GitHub Release containing only `main.js`, `manifest.json`, and `styles.css`.

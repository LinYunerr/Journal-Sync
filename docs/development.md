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
| Obsidian settings UI and persistence | `src/ui/settings-tab.js` |
| Adapter registration | `src/core/adapter-registry.js` |
| Rich content and Telegram segment rendering | `src/core/content-renderer.js` |
| Platform requests and validation | `src/adapters/` |
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

There are currently no automated test or lint scripts. Verify the affected flow in Obsidian when practical. At minimum, exercise the command or platform path that changed and inspect the resulting notice or published content.

## Adding a destination

1. Add an adapter under `src/adapters/`. Export its `manifest` and `execute()` implementation, following an existing adapter with similar capabilities.
2. Require and register the adapter in `src/main.js`.
3. Add its settings to `src/ui/settings-tab.js`.
4. Add target selection behavior to `src/ui/send-modal.js` only when the generic target flow is insufficient.
5. Keep shared rendering or upload behavior in `src/core/`; do not duplicate it inside adapters.
6. Update both user READMEs and run `npm run build`.
7. Manually exercise configuration, selection, request validation, success, and failure behavior in Obsidian.

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

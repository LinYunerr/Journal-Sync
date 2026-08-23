# Journal Sync Bridge: AI Working Context

## Purpose

This repository is the source for **Journal Sync**, an Obsidian plugin (`journal-sync-bridge`). It lets users create timestamped daily-journal entries in their vault and publish selected text, a `##` heading block, or a full note to flomo, Telegram, Mastodon, Misskey, and Notion.

The plugin runs entirely in Obsidian. It must not require a separate backend service. Images referenced from the vault can be sent with content; Telegram uploads them directly through the Bot API.

## Release Status

- This plugin is published in the public GitHub repository `Journal-Sync`.
- The current published version is `1.0.1`.
- The repository includes both source code and the generated `main.js`; GitHub Releases attach `main.js`, `manifest.json`, and `styles.css`.
- Publication status is context, not standing permission to write Git history. Do not commit, tag, push, or create a GitHub Release unless the user explicitly requests Git publication in the current task.
- Continue to use the existing build and verification flow for ordinary changes. A completed build does not imply that Git operations should follow.

## Read This First

Do not scan the whole repository at the start of a task. Start with this file, then read only the source files directly related to the requested behavior.

Use `README.md` for installation and user-facing behavior. Treat the following as the normal source of truth:

| Area | Files |
| --- | --- |
| Plugin lifecycle, commands, journal creation, content extraction, adapter dispatch, vault image resolution | `src/main.js` |
| Send dialog and send-target selection | `src/ui/send-modal.js` |
| Obsidian settings UI and persisted settings changes | `src/ui/settings-tab.js` |
| Platform adapter registry | `src/core/adapter-registry.js` |
| Rich text, image ordering, Telegram segments | `src/core/content-renderer.js` |
| Individual platform HTTP requests and validation | `src/adapters/flomo.js`, `telegram.js`, `mastodon.js`, `missky.js`, `notion.js` |
| Plugin metadata | `manifest.json` |
| Plugin styling | `styles.css` |
| Build configuration | `esbuild.config.mjs`, `package.json` |

## Architecture

- `src/main.js` is the CommonJS plugin entry point. It registers the two commands: `journal-sync-new` and `journal-sync-send`.
- `src/adapters/` contains isolated adapters. Each adapter exposes a `manifest` with an `id` and an `execute()` implementation, then is registered in `src/main.js`.
- `src/core/` contains reusable, platform-independent logic.
- `src/ui/` contains Obsidian UI components and receives the plugin instance for settings and adapter execution.
- `main.js` in this directory is generated code. Do not edit it manually; edit `src/` and rebuild.
- Obsidian loads only `main.js`, `manifest.json`, and `styles.css` from its installed plugin directory.
- Runtime settings are saved by Obsidian in `data.json`. This file can contain credentials and must never be treated as safe to expose, log, copy, or commit.

## Build And Verification

Run the production build after changes that can affect the plugin or its output, including `src/`, `styles.css`, `manifest.json`, build configuration, or package dependencies:

```bash
npm run build
```

Do not rebuild for Markdown-only changes such as plans, notes, `README.md`, or `AGENTS.md`. This production build writes `main.js` and removes `console` and `debugger` calls. There are currently no `test` or `lint` scripts. For source changes, also inspect the relevant changed code and build output; test the affected flow manually in Obsidian when practical.

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
- When adding a platform, add its adapter, register it in `src/main.js`, add settings UI, and rebuild.
- Keep `package.json`, `manifest.json`, and `versions.json` aligned when releasing. The release tag must exactly match `manifest.json.version` and must not use a `v` prefix.
- Do not manually alter generated `main.js`; verify it changes only as a result of `npm run build`.
- `.github/workflows/release.yml` builds tagged versions and attaches only `main.js`, `manifest.json`, and `styles.css` to the GitHub Release.

# Sendrova

Single-user **local Electrobun desktop app** for paced WhatsApp messaging via [Baileys](https://baileys.wiki/introduction).

Public repo: [github.com/nareshjois/sendrova](https://github.com/nareshjois/sendrova)

## Quick start

```bash
bun install
bun run start
```

## Icons

Platform sources (edit these, then optionally `bun run icons`):

| Path | Used for |
| --- | --- |
| `windows/icon-256x256px.ico` | Windows app icon (`build.win.icon`) |
| `macOS/AppIcon.iconset/` | macOS icons when you build mac (`build.mac.icons`) |
| `linux/icon.png` | Linux icon when you build linux (`build.linux.icon`) |
| `src/mainview/assets/app-icon.png` | In-app sidebar icon |

**Releases are Windows-only for now.** mac/linux icon paths stay configured for later; do not expect mac/linux update pipelines yet.

## Windows releases & auto-update

Configured in [`shared/release-config.ts`](./shared/release-config.ts):

- `GITHUB_REPO` = `nareshjois/sendrova`
- `release.baseUrl` = `https://github.com/nareshjois/sendrova/releases/latest/download`

### Publish a Windows stable update

1. Bump `APP_VERSION` in `shared/release-config.ts` (and `package.json` if you want).
2. On a Windows machine: `bun run build:stable`
3. Create a **non-prerelease** GitHub Release (so `/releases/latest` resolves).
4. Upload Electrobun **Windows** artifacts **without renaming**, for example:

   - `stable-win-x64-update.json`
   - `stable-win-x64-<hash>.tar.zst`
   - optional: `stable-win-x64-<prevHash>.patch`

5. Installed apps: **About → Check for updates**

The repository must stay **public** so clients can fetch update files. Dev builds (`bun start` / `electrobun dev`) run on the `dev` channel and skip applying updates.

## Features

- Multi-screen UI: Home, Editor (50/50), Progress, Settings, About
- Shared footer + custom Windows titlebar
- Campaigns, templates, media, daily caps
- SQLite under `~/.sendrova` (override `SENDROVA_DATA`)

## Risk

Unofficial WhatsApp Web protocol. Bulk/unsolicited messaging can ban accounts. Use consented contacts only.

## Scripts

| Script | Purpose |
| --- | --- |
| `bun run start` | Build UI + launch Electrobun |
| `bun run build:stable` | **Windows** stable release artifacts |
| `bun run icons` | Sync UI/`assets` copies from `windows/` `macOS/` `linux/` |
| `bun run typecheck` | TypeScript |
| `bun test` | Unit tests |

## Developed by

[Naresh Jois](https://www.nareshjois.com/)

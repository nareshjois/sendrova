# Sendrova

**Sendrova** is a single-user desktop app for running **paced messaging campaigns** on your machine. Connect a WhatsApp session once, then manage campaigns, templates, media, and daily send caps locally — no cloud account for the app itself.

Built as a local [Electrobun](https://electrobun.dev/) app. Messaging uses the unofficial WhatsApp Web protocol via [Baileys](https://baileys.wiki/introduction).

**Who it’s for:** individuals or small teams who need consented, rate-limited outbound campaigns from a desktop workflow (import contacts, edit templates, watch progress, pause/resume).

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
| `src/mainview/assets/app-icon.png` | In-app titlebar icon |

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

### First install & SmartScreen

Electrobun does not code-sign Windows builds, and Sendrova does not ship a paid signing certificate. Windows SmartScreen often warns on `Sendrova-Setup-*.exe` (“Windows protected your PC”) for unknown/unsigned publishers. That is expected for a small, low-volume app — not proof the file is malware.

**Typical install (few machines):**

1. Download the Setup zip from [GitHub Releases](https://github.com/nareshjois/sendrova/releases) (e.g. `*-win-x64-Sendrova-Setup-*.zip`) and extract `Sendrova-Setup-*.exe`.
2. If SmartScreen appears: **More info** → **Run anyway**.
3. Prefer downloads from this repo’s Releases page so recipients know the source.

**Optional (skip the Setup EXE):** unzip/run the app folder from a canary/stable build (`build/*-win-x64/Sendrova-*/bin/launcher`) or the matching `*-Sendrova-*.tar.zst` artifact. SmartScreen may still warn when launching an unsigned `launcher`/EXE; the same **More info → Run anyway** path applies. Self-signed certificates do not improve SmartScreen and are not used here.

## Features

- Multi-screen UI: Home, Editor (50/50), Progress, Settings, About
- Collapsible sidebar + custom Windows titlebar (icon + app name)
- Campaigns, templates, media, daily caps
- WhatsApp session connect via QR (Baileys)
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

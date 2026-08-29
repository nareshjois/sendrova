# Sendrova

Single-user **local Electrobun desktop app** for paced WhatsApp messaging via [Baileys](https://baileys.wiki/introduction).

This is **not** Meridian Phase 7 / `P7-WHATSAPP-001`. It lives under `tools/whatsapp-sender` outside Meridian phase gates.

## Features

- Multi-screen UI: **Home**, **Editor** (50/50 message | contacts), **Progress**, **Settings**, **About**
- Shared footer: connection status + campaign actions
- Custom titlebar on Windows (native chrome hidden) with minimize / maximize / close
- Saved campaigns with contacts, message template, optional shared image/video
- Parallel campaign runners on one WhatsApp session
- Random send delays + occasional longer pauses (Settings)
- **Max messages per day** (device local timezone)
- SQLite via **`bun:sqlite`** under `~/.whatsapp-sender`
- Optional GitHub Releases auto-update (Electrobun Updater)

## Quick start

```bash
cd tools/whatsapp-sender
bun install
bun run start
```

HMR: `bun run dev:hmr` (opt-in; `bun start` always uses the built bundle)

## Screens

| Screen | Purpose |
| --- | --- |
| Home | Connection, metrics ribbon, campaign list, pause/stop |
| Editor | Split layout: template/media/preview \| contacts import |
| Progress | Live countdown + per-contact status for a campaign |
| Settings | Delays (seconds), extra pause, max messages/day, updates link |
| About | Version, changelog, developer credit, check for updates |

## Custom titlebar (Windows)

The window uses Electrobun `titleBarStyle: "hidden"` on Windows (`hiddenInset` on macOS). The shell draws a drag region plus window controls. After load, a 1px size nudge fixes WebView2 client bounds ([Electrobun #462](https://github.com/blackboardsh/electrobun/issues/462)).

## Auto-update (GitHub Releases)

1. Set `GITHUB_REPO` in [`shared/release-config.ts`](./shared/release-config.ts) to `"owner/repo"`.
2. `release.baseUrl` becomes `https://github.com/owner/repo/releases/latest/download`.
3. Build: `bun run build:stable`.
4. Upload Electrobun artifacts to the GitHub Release **without renaming**. Typical Windows x64 names:

   - `stable-win-x64-update.json`
   - `stable-win-x64-<hash>.tar.zst`
   - optional patches: `stable-win-x64-<prevHash>.patch`

5. In the app: **About → Check for updates** (or Settings → Open About & updates).

Dev / `electrobun dev` runs on the `dev` channel and skips applying updates. Leave `GITHUB_REPO` empty to disable checks (UI shows a setup hint).

## Icons

App icons live under `assets/`:

| File | Platform |
| --- | --- |
| `assets/icon.iconset/` | macOS (→ `.icns` via `iconutil`) |
| `assets/icon.ico` | Windows (multi-size) |
| `assets/icon.png` | Linux |

UI sidebar uses `src/mainview/assets/app-icon.png`. Regenerate with:

```bash
bun run scripts/generate-icons.ts
```

## Data

Default root: `~/.whatsapp-sender` (override `WHATSAPP_SENDER_DATA`).

| Path | Contents |
| --- | --- |
| `auth_info/` | Baileys session — treat as private keys |
| `history.sqlite` | Campaigns, contacts, attempts, settings |
| `media/<campaignId>/` | Copied campaign media |

## Risk

Unofficial WhatsApp Web protocol. Bulk/unsolicited messaging can ban accounts. Use consented contacts only.

## Scripts

| Script | Purpose |
| --- | --- |
| `bun run start` | Build UI + launch Electrobun (bundled views, no Vite HMR) |
| `bun run dev:hmr` | Vite HMR + Electrobun (`SENDROVA_HMR=1`) |
| `bun run build:stable` | Stable release artifacts for updates |
| `bun run typecheck` | TypeScript |
| `bun test` | Unit tests |
| `bun run lint` | Biome |

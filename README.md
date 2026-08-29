# Sendrova

**Sendrova** is a single-user desktop app for running **paced messaging campaigns** on your machine. Connect a **WhatsApp** session and/or an **SMS phone gateway**, then manage campaigns, templates, media, and daily send caps locally.

Built as a local [Electrobun](https://electrobun.dev/) app in a Bun + Turborepo monorepo. WhatsApp uses the unofficial Web protocol via [Baileys](https://baileys.wiki/introduction). SMS uses a thin **Cloudflare Worker + R2 relay** and a sideloaded Android app (no httpsms.com / Play Store in v1).

**Who it’s for:** individuals or small teams who need consented, rate-limited outbound campaigns from a desktop workflow (import contacts, edit templates, watch progress, pause/resume).

Public repo: [github.com/nareshjois/sendrova](https://github.com/nareshjois/sendrova)

## Monorepo map

```text
sendrova/
  apps/
    desktop/     # Electrobun + React UI (@sendrova/desktop)
    relay/       # Cloudflare Worker SMS relay (@sendrova/relay)
    android/     # Kotlin SMS phone gateway (Gradle; not a JS package)
  packages/
    shared/      # RPC DTOs + release-config (@sendrova/shared)
    sms-relay-api/  # Frozen OpenAPI + QR + R2 layout + E2E checklist
  package.json   # Bun workspaces + Turbo scripts
  turbo.json
```

| Path | Role |
| --- | --- |
| `apps/desktop` | Campaign UI, WhatsApp (Baileys) + SMS channel, SQLite under `~/.sendrova` |
| `apps/relay` | Pairing + job queue Worker; R2 storage; tokens HMAC-signed |
| `apps/android` | Pair via QR, poll jobs, send SMS, ack status |
| `packages/sms-relay-api` | Contract source of truth (`openapi.yaml`, `qr-payload.md`, `e2e-checklist.md`) |

**WhatsApp vs SMS:** WhatsApp stays local (QR linked-device session). SMS never talks LAN-to-LAN — desktop and phone both call the Cloudflare Worker. Campaigns pick a channel; SMS is **text-only** in v1. Daily send cap (`max_messages_per_day`) is shared.

## Quick start (desktop)

```bash
bun install
bun run start
```

Root scripts proxy into `@sendrova/desktop` via Turbo. For SMS against a live Worker, set `SMS_RELAY_BASE_URL` (e.g. `http://127.0.0.1:8787` or your deployed Worker URL) before starting desktop.

## Turbo / workspace commands

| Script | Purpose |
| --- | --- |
| `bun run start` | Build UI + launch Electrobun desktop |
| `bun run build:canary` / `build:stable` | Windows release artifacts (desktop) |
| `bun run typecheck` | TypeScript (`@sendrova/desktop`) |
| `bun run test` | Unit tests (`@sendrova/desktop`) |
| `bun run icons` | Sync UI icon copies from `apps/desktop` sources |

Per-app (from package dir or with filter):

```bash
# Desktop
bun run test --filter=@sendrova/desktop
bun run typecheck --filter=@sendrova/desktop

# Relay Worker
cd apps/relay && bun run dev      # wrangler dev
cd apps/relay && bun run test
cd apps/relay && bun run deploy   # after secrets + R2 bucket

# Android (Gradle / Android Studio — not via Turbo)
cd apps/android && gradlew.bat assembleDebug
```

## SMS setup (relay + APK)

1. **Deploy or run the Worker** (`apps/relay`):
   - Local: `cd apps/relay && bun install && bun run dev` → typically `http://127.0.0.1:8787`
   - Production: create R2 bucket `sendrova-sms`, then:

     ```bash
     cd apps/relay
     wrangler secret put TOKEN_SIGNING_KEY   # long random secret — required in prod
     bun run deploy
     ```

     Do **not** ship the `[vars]` dev signing key from `wrangler.toml`.

2. **Point desktop at the relay:** set env `SMS_RELAY_BASE_URL` to the Worker base URL (no trailing slash).

3. **Build / sideload the Android APK** — see [`apps/android/README.md`](./apps/android/README.md). Open `apps/android` in Android Studio, `assembleDebug`, `adb install`. Physical phone on the same network (or use the deployed Worker HTTPS URL).

4. **Pair:** Home → SMS → **Pair phone** → scan QR with the Android app. Badge becomes **Online** when the phone is polling. Campaigns mark SMS **sent only after the phone acks** each job.

5. **E2E checklist:** [`packages/sms-relay-api/e2e-checklist.md`](./packages/sms-relay-api/e2e-checklist.md).

### Cloudflare dependency

SMS pairing, job queue, and device health **require** a reachable Cloudflare Worker + R2 bucket. If the Worker is down or `SMS_RELAY_BASE_URL` is wrong, desktop shows **Relay down** / unreachable; campaigns cannot deliver SMS until the relay recovers. WhatsApp does not depend on Cloudflare.

Without `SMS_RELAY_BASE_URL`, desktop runs an **SMS mock** (campaigns can exercise the channel without a phone).

## Icons

Platform sources under `apps/desktop` (edit these, then optionally `bun run icons`):

| Path | Used for |
| --- | --- |
| `apps/desktop/windows/icon-256x256px.ico` | Windows app icon (`build.win.icon`) |
| `apps/desktop/macOS/AppIcon.iconset/` | macOS icons when you build mac (`build.mac.icons`) |
| `apps/desktop/linux/icon.png` | Linux icon when you build linux (`build.linux.icon`) |
| `apps/desktop/src/mainview/assets/app-icon.png` | In-app titlebar icon |

**Releases are Windows-only for now.** mac/linux icon paths stay configured for later; do not expect mac/linux update pipelines yet.

## Windows releases & auto-update

Configured in [`packages/shared/release-config.ts`](./packages/shared/release-config.ts):

- `GITHUB_REPO` = `nareshjois/sendrova`
- `release.baseUrl` = `https://github.com/nareshjois/sendrova/releases/latest/download`

### Publish a Windows stable update

1. Bump `APP_VERSION` in `packages/shared/release-config.ts` (and `apps/desktop/package.json` if you want).
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
- SMS phone gateway via QR (Cloudflare relay + Android APK)
- Dual Home connection badges (WhatsApp + SMS)
- SQLite under `~/.sendrova` (override `SENDROVA_DATA`)

## Risk

Unofficial WhatsApp Web protocol. Bulk/unsolicited messaging (WhatsApp or SMS) can ban accounts or violate carrier/terms. Use consented contacts only.

## Developed by

[Naresh Jois](https://www.nareshjois.com/)

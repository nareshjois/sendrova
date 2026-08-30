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

Root scripts proxy into `@sendrova/desktop` via Turbo. Desktop SMS uses the built-in relay at `https://sendrova.nareshjois.com`. For local Worker development only, optionally set `SMS_RELAY_BASE_URL=http://127.0.0.1:8787`.

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
   - Local: `cd apps/relay && bun install && cp .dev.vars.example .dev.vars && bun run dev` → typically `http://127.0.0.1:8787`
   - Production: create R2 bucket `sendrova-sms`, then:

     ```bash
     cd apps/relay
     wrangler secret put TOKEN_SIGNING_KEY   # long random secret — required; no default in wrangler.toml
     bun run deploy
     ```

     Deploy without the secret fails closed (Worker returns 500 until `TOKEN_SIGNING_KEY` is set).

2. **Desktop relay URL:** built-in — `https://sendrova.nareshjois.com` (no trailing slash). Optional local override: `SMS_RELAY_BASE_URL=http://127.0.0.1:8787` when using `wrangler dev`.

3. **Sideload the Android APK** — prefer `Sendrova-SMS-debug.apk` from [GitHub Releases](https://github.com/nareshjois/sendrova/releases), or build locally (`cd apps/android && gradlew.bat assembleDebug`; see [`apps/android/README.md`](./apps/android/README.md)). Physical phone; use the deployed Worker HTTPS URL (or LAN/`10.0.2.2` for local wrangler).

4. **Pair:** Home → SMS → **Pair phone** → scan QR with the Android app. Badge becomes **Online** when the phone is polling. Campaigns mark SMS **sent only after the phone acks** each job.

5. **E2E checklist:** [`packages/sms-relay-api/e2e-checklist.md`](./packages/sms-relay-api/e2e-checklist.md).

### Cloudflare dependency

SMS pairing, job queue, and device health **require** a reachable Cloudflare Worker + R2 bucket. Desktop targets the built-in Worker URL above. If the Worker is down (or a local `SMS_RELAY_BASE_URL` override is wrong), desktop shows **Relay down** / unreachable; campaigns cannot deliver SMS until the relay recovers. WhatsApp does not depend on Cloudflare.

For unit tests / offline campaigns without a phone, set `SMS_RELAY_MOCK=1` (in-memory SMS mock).

## Icons

Platform sources under `apps/desktop` (edit these, then optionally `bun run icons`):

| Path | Used for |
| --- | --- |
| `apps/desktop/windows/icon-256x256px.ico` | Windows app icon (`build.win.icon`) |
| `apps/desktop/macOS/AppIcon.iconset/` | macOS icons when you build mac (`build.mac.icons`) |
| `apps/desktop/linux/icon.png` | Linux icon when you build linux (`build.linux.icon`) |
| `apps/desktop/src/mainview/assets/app-icon.png` | In-app titlebar icon |

**Desktop releases are Windows-only for now** (plus the Android SMS APK on the same GitHub Release). mac/linux icon paths stay configured for later; do not expect mac/linux Electrobun update pipelines yet.

Desktop is on **Electrobun 2.x** (Hutch build tooling). The Windows icon comes from `build.win.icon` in `apps/desktop/electrobun.config.ts` — no separate `rcedit` / embed workaround.

**Upgrading from Electrobun 1.16 installs:** do **not** rely on in-app auto-update from 1.16 → 2.x. Download a fresh Setup ZIP from [Releases](https://github.com/nareshjois/sendrova/releases) and install over the previous version (user data under `~/.sendrova` is preserved).

## Download Windows + Android (GitHub Releases)

Prebuilt installs ship from [GitHub Releases](https://github.com/nareshjois/sendrova/releases):

| Asset | What it is |
| --- | --- |
| `win-x64-Sendrova-Setup.zip` | Windows Setup ZIP — extract `Sendrova-Setup.exe` and run (Electrobun 2 / Hutch) |
| `{canary\|stable}-win-x64-update.json` (+ matching `.tar.zst`) | Desktop auto-update payloads (leave names unchanged) |
| `Sendrova-SMS-<version>.apk` | Android SMS gateway (**signed release** — sideload with `adb install`) |

SMS relay for production desktop + phone: **`https://sendrova.nareshjois.com`**. Pair from desktop Home → SMS → Pair phone, then scan with the APK.

### Versioning (stable baseline 1.0.0)

First stable line is **1.0.0**. Keep these in sync when cutting a release:

| Surface | Field |
| --- | --- |
| Desktop / Electrobun | `APP_VERSION` in [`packages/shared/release-config.ts`](./packages/shared/release-config.ts) (+ `apps/desktop/package.json`) |
| Android | `versionName` / `versionCode` in `apps/android/app/build.gradle.kts` |

| Tag | Channel |
| --- | --- |
| `v1.0.0`, `v1.0.1`, … | **stable** → `bun run build:stable` |
| `v1.0.0-canary.1`, … | **canary** → `bun run build:canary` (Release marked prerelease) |

After merging version bumps to `main`, cut a release with `git tag v1.0.0 && git push origin v1.0.0` (do not retag casually).

### First install & SmartScreen

Electrobun does not code-sign Windows builds, and Sendrova does not ship a paid signing certificate. Windows SmartScreen often warns on `Sendrova-Setup-*.exe` (“Windows protected your PC”) for unknown/unsigned publishers. That is expected for a small, low-volume app — not proof the file is malware.

**Typical Windows install:**

1. Download the Setup zip from [Releases](https://github.com/nareshjois/sendrova/releases) and extract `Sendrova-Setup-*.exe`.
2. If SmartScreen appears: **More info** → **Run anyway**.
3. Prefer downloads from this repo’s Releases page so recipients know the source.

**Optional (skip the Setup EXE):** run the app folder from a canary/stable build (`build/*-win-x64/Sendrova-*/bin/launcher`) or the matching `*-Sendrova-*.tar.zst` artifact. SmartScreen may still warn; same **More info → Run anyway** path. Self-signed certificates do not improve SmartScreen and are not used here.

**Android:** install `Sendrova-SMS-1.1.1.apk` (or the matching version) via `adb install -r …` (or file manager sideload). Grant SMS (+ Camera for QR). APKs on Releases are **signed** with the project release keystore (see [`apps/android/README.md`](./apps/android/README.md)).

## CI releases (tag push)

Workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

| Trigger | Behavior |
| --- | --- |
| Push tag `v*` (e.g. `v1.0.0`) | Builds **stable** desktop + signed Android APK; creates a GitHub Release |
| Push tag containing `canary` (e.g. `v1.0.0-canary.1`) | Builds **canary** desktop; marks the Release as prerelease |
| **Actions → Release → Run workflow** | Pick `canary` / `stable` and a tag name (required when not on a tag ref) |

```bash
# Example: cut the first stable release after merge
git tag v1.0.0
git push origin v1.0.0
```

CI jobs:

1. **Windows (`windows-latest`)** — `bun install` + `bun run build:canary` or `build:stable` (Turbo → `@sendrova/desktop`). Uploads Electrobun files from `apps/desktop/artifacts/` **without renaming**.
2. **Android (`ubuntu-latest` + JDK 17 + Android SDK)** — decode keystore from secrets → `./gradlew assembleRelease`; attaches `Sendrova-SMS-<versionName>.apk`.
3. **Publish** — `softprops/action-gh-release` attaches both jobs’ assets to one Release.

Electrobun Windows builds are heavy (~tens of minutes). No Electrobun license token is required for the current open toolchain; builds are **unsigned** (SmartScreen as above). Bun (`1.4`) and Gradle caches are enabled in the workflow.

### Android release signing (required for CI)

Repo secrets (do **not** commit keystores or passwords):

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.jks` / `.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Local and CI setup: [`apps/android/README.md`](./apps/android/README.md#release-signing).

### Manual publish (local Windows)

Configured in [`packages/shared/release-config.ts`](./packages/shared/release-config.ts):

- `GITHUB_REPO` = `nareshjois/sendrova`
- `release.baseUrl` = `https://github.com/nareshjois/sendrova/releases/latest/download`

1. Bump `APP_VERSION` in `packages/shared/release-config.ts`, `apps/desktop/package.json`, and Android `versionName` / `versionCode`.
2. On a Windows machine: `bun run build:stable`
3. Create a **non-prerelease** GitHub Release (so `/releases/latest` resolves), or use the CI tag flow above.
4. Upload Electrobun **Windows** artifacts **without renaming**, for example:

   - `stable-win-x64-update.json`
   - `stable-win-x64-<hash>.tar.zst`
   - optional: `stable-win-x64-<prevHash>.patch`
   - Setup zip from `artifacts/` if shipping first-install

5. Installed apps: **About → Check for updates**

The repository must stay **public** so clients can fetch update files. Dev builds (`bun start` / `electrobun dev`) run on the `dev` channel and skip applying updates.

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

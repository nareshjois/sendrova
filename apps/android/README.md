# @sendrova/android

Sendrova SMS phone gateway — thin Kotlin app that pairs to the Cloudflare Worker relay via QR/paste, polls pending jobs, sends SMS with `SmsManager`, and acks `sent` / `failed`.

Contract source of truth: [`packages/sms-relay-api`](../../packages/sms-relay-api) (`openapi.yaml`, `qr-payload.md`).

**Version:** `1.1.1` (`versionName`) / `versionCode` `11001` — aligned with desktop stable baseline.

## Requirements

| Tool | Version |
| --- | --- |
| Android Studio | Hedgehog (2023.1.1) or newer (recommended: Ladybug / latest stable) |
| Android SDK | API 34 (compile/target); minSdk **26** |
| JDK | **17** (Android Studio bundled JDK is fine) |
| Device | Physical phone with SMS capability (emulator SMS is limited) |

## Open & build

1. Start Android Studio → **Open** → select `apps/android` (this directory, not the monorepo root).
2. Trust the project; let Gradle sync (downloads AGP 8.5.2 + deps).
3. If prompted for missing SDK components, install **Android SDK Platform 34** and **Build-Tools**.
4. Connect a phone with USB debugging, or create an emulator.
5. **Run** `app`, or from a terminal:

```bat
cd apps\android
gradlew.bat assembleDebug
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`

CI publishes a **signed release** APK as **`Sendrova-SMS-1.1.1.apk`** (version from `versionName`) on [GitHub Releases](https://github.com/nareshjois/sendrova/releases). Prefer the Release asset for sideload unless you are iterating on the Kotlin app.

### Sideload

```bat
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Or, after downloading a Release:

```bat
adb install -r Sendrova-SMS-1.0.0.apk
```

Grant **SMS** (and **Camera** if scanning QR) when prompted. On Android 13+, allow notifications so the foreground poller stays visible.

## Release signing

Release builds use `signingConfigs.release`. Credentials are read from **environment variables** or `local.properties` (never commit either).

| Property / env | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | Absolute path to `.jks` / `.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

See [`local.properties.example`](local.properties.example). Keystores and `*.jks` / `*.keystore` are gitignored.

### Local signed release

1. Keep the keystore **outside** the repo (recommended: `%USERPROFILE%\.sendrova\android\sendrova-release.jks`).
2. Add the four keys above to `apps/android/local.properties` (or export them in your shell).
3. Build:

```bat
cd apps\android
gradlew.bat assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk`

If signing props are missing, `assembleRelease` still runs but the APK may be **unsigned** / not installable as a release — CI always requires secrets.

### Create a keystore (once)

```bat
"%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v ^
  -keystore "%USERPROFILE%\.sendrova\android\sendrova-release.jks" ^
  -alias sendrova -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS
```

Back up the `.jks` and passwords offline. Losing them means you cannot ship updates signed with the same key.

### GitHub Actions secrets (CI)

Repo secrets used by [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `sendrova`) |
| `ANDROID_KEY_PASSWORD` | Key password |

Encode on Windows (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.sendrova\android\sendrova-release.jks")) |
  Set-Content -NoNewline "$env:USERPROFILE\.sendrova\android\sendrova-release.jks.base64.txt"
```

Set secrets (requires `gh` auth with `repo` scope):

```bash
# From a machine with GitHub CLI authenticated:
gh secret set ANDROID_KEYSTORE_BASE64 < "$HOME/.sendrova/android/sendrova-release.jks.base64.txt"
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS -b "sendrova"
gh secret set ANDROID_KEY_PASSWORD
```

Or: GitHub → **Settings → Secrets and variables → Actions → New repository secret**.

## Point at local wrangler (`@sendrova/relay`)

1. In another terminal, run the relay Worker (from Agent R), typically:

```bat
cd apps\relay
bunx wrangler dev
```

Default listen URL is often `http://127.0.0.1:8787`.

2. Desktop (or curl) calls `POST /v1/pair/start` and embeds the result in a pair URI:

```text
sendrova://sms-pair?u=<url-encoded-relay-base>&pairId=<id>&secret=<secret>
```

3. **Relay base URL the phone must reach:**

| Host | Use as `u` (then URL-encode) |
| --- | --- |
| Emulator | `http://10.0.2.2:8787` |
| Physical phone on same Wi‑Fi | `http://<your-PC-LAN-IP>:8787` (not `127.0.0.1`) |
| Deployed Worker | `https://sendrova.nareshjois.com` |

Cleartext HTTP is allowed via `network_security_config` for local wrangler.

4. In the app: **Scan QR** or paste the `sendrova://sms-pair?…` string → **Pair**.
5. Enqueue a job from desktop/curl (`POST /v1/jobs` with desktop token). The app polls `GET /v1/jobs/pending` every **3s**, sends SMS, then `POST /v1/jobs/{jobId}/status`.
6. **Unpair** clears encrypted prefs and stops the poller (`POST /v1/pair/unpair` when reachable).

## Permissions

- `SEND_SMS` — deliver campaign text
- `CAMERA` — optional QR scan (paste still works)
- Foreground service + notification — keep polling while paired

Credentials (`relayBaseUrl`, `deviceId`, `deviceToken`) live in **EncryptedSharedPreferences**.

## Project layout

```text
apps/android/
  app/src/main/java/dev/sendrova/sms/
    MainActivity.kt          # pair UI, deep link, unpair
    data/                    # credentials, OpenAPI client, URI parser
    sms/SmsSender.kt         # SmsManager send
    poll/JobPollService.kt   # 3s pending poll + ack
  README.md                  # this file
```

## Branding

Product name is **Sendrova** only (launcher label, notifications, UI).

### Launcher icons

Adaptive launcher assets live under `app/src/main/res/`:

| Resource | Role |
| --- | --- |
| `mipmap-*/ic_launcher.png` | Legacy / pre-API-26 launcher |
| `mipmap-*/ic_launcher_round.png` | Legacy roundIcon (same art; no separate round export) |
| `mipmap-*/ic_launcher_foreground.png` | Adaptive foreground (safe-zone PNGs) |
| `mipmap-*/ic_launcher_background.png` | Adaptive background PNGs (optional; XML uses solid color) |
| `mipmap-anydpi-v26/ic_launcher{,_round}.xml` | Adaptive icons → `@color/ic_launcher_background` + `@mipmap/ic_launcher_foreground` |
| `values/colors.xml` → `ic_launcher_background` | `#FFFFFF` (from icon pack) |

`AndroidManifest.xml` uses `android:icon` / `android:roundIcon` → `@mipmap/ic_launcher` / `@mipmap/ic_launcher_round`.

Play Store 512×512 asset: [`store/playstore-icon.png`](store/playstore-icon.png) (not packaged into the APK).

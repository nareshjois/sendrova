# @sendrova/android

Sendrova SMS phone gateway — thin Kotlin app that pairs to the Cloudflare Worker relay via QR/paste, polls pending jobs, sends SMS with `SmsManager`, and acks `sent` / `failed`.

Contract source of truth: [`packages/sms-relay-api`](../../packages/sms-relay-api) (`openapi.yaml`, `qr-payload.md`).

## Requirements

| Tool | Version |
| --- | --- |
| Android Studio | Hedgehog (2023.1.1) or newer (recommended: Ladybug / latest stable) |
| Android SDK | API 34 (compile/target); minSdk **26** |
| JDK | **17** (Android Studio bundled JDK is fine) |
| Device | Physical phone with SMS capability (emulator SMS is limited) |

This Windows agent host had **no JDK / Android SDK / Gradle wrapper JAR** installed, so the APK was **not compiled here**. Open this folder in Android Studio to sync Gradle (Studio will generate `gradle/wrapper/gradle-wrapper.jar` if missing) and build.

## Open & build

1. Start Android Studio → **Open** → select `apps/android` (this directory, not the monorepo root).
2. Trust the project; let Gradle sync (downloads AGP 8.5.2 + deps).
3. If prompted for missing SDK components, install **Android SDK Platform 34** and **Build-Tools**.
4. Connect a phone with USB debugging, or create an emulator.
5. **Run** `app`, or from a terminal (after Studio has created the wrapper JAR):

```bat
cd apps\android
gradlew.bat assembleDebug
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`

### Sideload

```bat
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Grant **SMS** (and **Camera** if scanning QR) when prompted. On Android 13+, allow notifications so the foreground poller stays visible.

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
| Deployed Worker | `https://…workers.dev` |

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

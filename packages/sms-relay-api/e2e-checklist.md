# SMS relay — end-to-end checklist

Manual verification that desktop + Cloudflare Worker + Android APK deliver one real SMS and that WhatsApp still works.

Contract: [`openapi.yaml`](./openapi.yaml), [`qr-payload.md`](./qr-payload.md), [`r2-layout.md`](./r2-layout.md).  
Relay defaults: [`apps/relay/README.md`](../../apps/relay/README.md).  
Android build/sideload: [`apps/android/README.md`](../../apps/android/README.md).

## Prerequisites

- [ ] Bun workspaces installed at repo root (`bun install`)
- [ ] Relay reachable (`cp .dev.vars.example .dev.vars` then `wrangler dev`, or deployed Worker with `wrangler secret put TOKEN_SIGNING_KEY`)
- [ ] R2 bucket bound (`SMS_BUCKET` / `sendrova-sms`)
- [ ] Android debug APK installed on a physical phone with SMS + USB debugging (or deploy Worker HTTPS so the phone can reach it)
- [ ] Desktop uses the built-in Worker URL `https://sendrova.nareshjois.com` (or optional `SMS_RELAY_BASE_URL` for local wrangler; no trailing slash)
- [ ] Two consented test contacts (or one contact + a second dry-run for WA)

## Relay health (optional curl)

With Worker up (default local `http://127.0.0.1:8787`):

- [ ] `GET /health` → `{ "ok": true }`
- [ ] Curl demo in `apps/relay/README.md` completes: pair → job → pending claim → ack `sent`

## Pairing

- [ ] Desktop Home → SMS → **Pair phone** shows QR (`sendrova://sms-pair?…`)
- [ ] Android app scans QR (or paste URI) and completes pair
- [ ] Desktop SMS badge → **Online** within ~15s of phone polling
- [ ] Expired QR (wait >5m or Refresh after expiry) clears local `desktopToken`; re-pair works
- [ ] **Unpair** on desktop (or phone) revokes session; re-pair requires a new QR

## SMS campaign (phone ack)

- [ ] Create/edit campaign with channel **SMS**; media controls hidden
- [ ] Import ≥2 contacts with valid phone numbers
- [ ] Start campaign; phone receives SMS for each attempt
- [ ] Progress shows **sent only after** phone ack (not merely when queued)
- [ ] Stop mid-campaign: already phone-acked attempts stay **sent**; in-flight wait aborts cleanly
- [ ] Failed modem/ack surfaces as failed attempt with error text

## Worker down / bad URL

- [ ] Stop Worker (or point optional `SMS_RELAY_BASE_URL` at a closed port)
- [ ] Desktop shows **Relay down** / unreachable copy (not a silent “Paired”)
- [ ] Restore Worker → badge recovers to Online after phone polls again

## WhatsApp regression

- [ ] Connect WhatsApp via QR; badge **Connected**
- [ ] WhatsApp campaign with media still starts and sends
- [ ] SMS and WhatsApp badges both visible on Home; switching campaign channel does not break the other session

## Non-goals (skip)

- Play Store / FCM / MMS / inbound SMS inbox
- Per-channel daily caps (shared cap only in v1)

# @sendrova/relay

Cloudflare Worker that relays SMS jobs between Sendrova desktop and an Android phone gateway. Storage is R2 (`SMS_BUCKET`); tokens are HMAC-signed with `TOKEN_SIGNING_KEY`.

Contract source of truth: [`packages/sms-relay-api`](../../packages/sms-relay-api) (OpenAPI + QR + R2 layout). This README documents **implementation defaults** for ambiguities left open by the frozen contract.

## Setup

```bash
cd apps/relay
bun install
cp .dev.vars.example .dev.vars   # required for local TOKEN_SIGNING_KEY
bun run dev          # wrangler dev — local Worker + R2
bun run test         # vitest + @cloudflare/vitest-pool-workers (miniflare)
bun run deploy       # wrangler deploy (after secrets + R2 bucket exist)
```

Bindings (see `wrangler.toml`):

| Binding | Purpose |
| --- | --- |
| `SMS_BUCKET` | R2 bucket for pair / device / job JSON |
| `TOKEN_SIGNING_KEY` | HMAC key for minting/verifying bearer tokens and hashing secrets |

### Production secret (`TOKEN_SIGNING_KEY`)

`TOKEN_SIGNING_KEY` is **not** in `wrangler.toml` `[vars]` (a committed default would ship on `wrangler deploy`). Without a secret, the Worker returns **500** (`TOKEN_SIGNING_KEY not configured`) — fail closed.

```bash
cd apps/relay
# Local wrangler dev:
cp .dev.vars.example .dev.vars   # gitignored; wrangler loads it automatically

# Production (required before first deploy):
# Generate a long random secret, then:
wrangler secret put TOKEN_SIGNING_KEY
# paste the secret when prompted
```

Vitest injects a non-prod test key via `vitest.config.ts`. Rotate production by putting a new secret (existing tokens become invalid — devices must re-pair).

Also create the R2 bucket named in `wrangler.toml` (`sendrova-sms`) in the Cloudflare dashboard (or via `wrangler r2 bucket create`) before the first deploy.

Hourly cron (`0 * * * *`) runs R2 GC (expired pairs, terminal job TTL, abandoned leases).

## Curl demo (pair → job → ack)

With `bun run dev` listening (default `http://127.0.0.1:8787`):

```bash
BASE=http://127.0.0.1:8787

# 1) Desktop starts pairing
START=$(curl -sS -X POST "$BASE/v1/pair/start")
echo "$START"
PAIR_ID=$(echo "$START" | jq -r .pairId)
SECRET=$(echo "$START" | jq -r .secret)
DESKTOP=$(echo "$START" | jq -r .desktopToken)

# 2) Phone completes pairing (one-time)
COMPLETE=$(curl -sS -X POST "$BASE/v1/pair/complete" \
  -H 'content-type: application/json' \
  -d "{\"pairId\":\"$PAIR_ID\",\"secret\":\"$SECRET\"}")
echo "$COMPLETE"
DEVICE=$(echo "$COMPLETE" | jq -r .deviceToken)

# 3) Desktop enqueues a job
JOB=$(curl -sS -X POST "$BASE/v1/jobs" \
  -H "authorization: Bearer $DESKTOP" \
  -H 'content-type: application/json' \
  -d '{"to":"+15551234567","body":"hello SMS","clientJobId":"demo-1"}')
echo "$JOB"
JOB_ID=$(echo "$JOB" | jq -r .jobId)

# 4) Phone claims pending (lease → in_progress)
curl -sS "$BASE/v1/jobs/pending" -H "authorization: Bearer $DEVICE" | jq

# 5) Phone acks sent
curl -sS -X POST "$BASE/v1/jobs/$JOB_ID/status" \
  -H "authorization: Bearer $DEVICE" \
  -H 'content-type: application/json' \
  -d '{"status":"sent"}' | jq

# 6) Desktop reads status + health
curl -sS "$BASE/v1/jobs/$JOB_ID" -H "authorization: Bearer $DESKTOP" | jq
curl -sS "$BASE/v1/device/health" -H "authorization: Bearer $DESKTOP" | jq
```

QR payload for phones (see `packages/sms-relay-api/qr-payload.md`):

```text
sendrova://sms-pair?u=<url-encoded-relayBaseUrl>&pairId=<pairId>&secret=<secret>
```

## Documented defaults (contract ambiguities)

| Topic | Default |
| --- | --- |
| **Pending claim limit** | `GET /v1/jobs/pending` claims at most **5** jobs per poll (oldest `createdAt` first). |
| **Lease TTL** | Claimed jobs stay `in_progress` for **2 minutes**. After `leaseExpiresAt`, a later poll recovers them to claimable (re-leased). |
| **Abandoned jobs** | `pending` / `in_progress` jobs with `updatedAt` older than **24 hours** are marked `failed` (`JOB_ABANDONED` / `LEASE_ABANDONED`) by GC or opportunistic device GC on pending poll. |
| **Job object TTL** | Terminal jobs (`sent` / `failed`) older than **7 days** are deleted from R2 (job + clientJob index). |
| **Expired pair GC** | Expired / TTL’d pending pair records are deleted **1 hour** after `expiresAt`. |
| **Pair start rate limit** | `POST /v1/pair/start` allows **10** requests per client IP per **15 minutes** (keyed by `CF-Connecting-IP` / `X-Forwarded-For`). Over limit → **429** `RATE_LIMITED`. |
| **Online freshness** | `GET /v1/device/health` → `online: true` iff `lastSeenAt` is within the last **15 seconds**. Device polls (and status acks) bump `lastSeenAt`. |
| **Error codes** | `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `PAIR_EXPIRED`, `PAIR_REDEEMED`, `INVALID_SECRET`, `NO_DEVICE`, `JOB_TERMINAL`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `INTERNAL`. Envelope: `{ "error": { "code", "message" } }`. |
| **clientJobId idempotency** | Same `clientJobId` + same normalized `to` + same `body` → **200** replay with the existing `jobId` (create response `status` is always `pending` per OpenAPI; use `GET /v1/jobs/{id}` for live status). Same `clientJobId` with different `to`/`body` → **409** `IDEMPOTENCY_CONFLICT`. |
| **1:1 desktop↔device** | Each `POST /v1/pair/start` creates one desktop session (`desktopToken` subject = `pairId`). Completing binds **one** device to that session. Unpair deletes the device, jobs, and pair record (revokes both tokens). Re-pair = new `pair/start`. |
| **relayBaseUrl** | Derived from the incoming request: `{scheme}//{host}` with **no trailing slash** (e.g. `http://127.0.0.1:8787`). |
| **`to` normalization** | Strip spaces/dashes/parentheses; keep leading `+` as E.164 (`+` + digits); otherwise digits-only. Length **7–15** digits. Invalid → 400 `VALIDATION_ERROR`. |
| **Failed ack `error`** | Required non-empty string when `status: "failed"` (trimmed, max **512** chars). Must be omitted/empty when `status: "sent"`. Identical terminal ack is idempotent 200; conflicting terminal ack → 409 `JOB_TERMINAL`. |

## Pair / job timing

- Pair TTL: **≤ 5 minutes** from create (`expiresAt`). Pending sessions become `expired` on read after TTL; secret redeem is one-time (`PAIR_REDEEMED` on reuse).
- R2 keys: `pair/{pairId}.json`, `devices/{deviceId}/meta.json`, `devices/{deviceId}/jobs/{jobId}.json`, plus `devices/{deviceId}/clientJobs/{clientJobId}.json` for idempotency (implementation index; not in the minimal layout doc).

## Scripts

| Script | Command |
| --- | --- |
| Dev | `bun run dev` |
| Test | `bun run test` |
| Typecheck | `bun run typecheck` |
| Dry-run build | `bun run build` |

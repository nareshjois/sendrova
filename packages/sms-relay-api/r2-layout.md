# R2 object layout

Logical keys in the SMS relay R2 bucket (`SMS_BUCKET`). JSON documents; exact field shapes follow Worker implementation but must satisfy the OpenAPI responses.

## Layout

```text
pair/{pairId}.json
devices/{deviceId}/meta.json
devices/{deviceId}/jobs/{jobId}.json
```

## Objects

### `pair/{pairId}.json`

Short-lived pairing session created by `POST /v1/pair/start`.

Typical fields: `pairId`, `secretHash`, `expiresAt`, `desktopTokenHash`, `status` (`pending` | `paired` | `expired`), optional `deviceId` after complete.

- Redeem once via `POST /v1/pair/complete`.
- GC / TTL ≤ 5 minutes after create (or after expiry).

### `devices/{deviceId}/meta.json`

Bound device metadata.

Typical fields: `deviceId`, `deviceTokenHash`, `desktopTokenHash` (or link to owning desktop), `pairedAt`, `lastSeenAt`, `online` heuristics inputs.

Updated on device-authenticated requests (pending poll, status ack).

### `devices/{deviceId}/jobs/{jobId}.json`

Outbound SMS job.

Typical fields: `jobId`, `clientJobId`, `to`, `body`, `status` (`pending` | `in_progress` | `sent` | `failed`), `leaseExpiresAt`, `error`, timestamps.

- Desktop enqueues → `pending`.
- Phone `GET /v1/jobs/pending` claims with lease → `in_progress`.
- Phone ack → `sent` | `failed`.
- Stale `in_progress` recovered to `pending` after ~2 minutes (Worker).

## Auth mapping

| Caller | Token | Typical R2 access |
| --- | --- | --- |
| Desktop | `desktopToken` | Create pair, read pair status, enqueue jobs, read job + health |
| Device | `deviceToken` | Claim pending jobs, write job status, bump `lastSeenAt` |

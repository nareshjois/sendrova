# SMS pair QR payload

Sendrova desktop encodes a custom URI in the pairing QR (and pasteable string).

## Format

```text
sendrova://sms-pair?u=<url-encoded-relay-base>&pairId=<id>&secret=<secret>
```

## Query parameters

| Param | Required | Description |
| --- | --- | --- |
| `u` | yes | URL-encoded Worker base URL (no trailing slash preferred), e.g. `https%3A%2F%2Fsms-relay.example` |
| `pairId` | yes | From `POST /v1/pair/start` |
| `secret` | yes | From `POST /v1/pair/start` (one-time redeem via `POST /v1/pair/complete`) |

## Android handling

1. Scan QR or paste URI.
2. Parse scheme `sendrova`, host `sms-pair`.
3. Decode `u` → `relayBaseUrl`.
4. `POST {relayBaseUrl}/v1/pair/complete` with `{ pairId, secret }`.
5. Persist `deviceId` + `deviceToken` in encrypted prefs; begin polling `GET /v1/jobs/pending`.

## Notes

- Pair TTL is enforced server-side (≤ 5 minutes in v1).
- Do not put `desktopToken` in the QR.

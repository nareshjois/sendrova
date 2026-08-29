# @sendrova/android

Placeholder for the Sendrova SMS phone gateway (Kotlin / Gradle).

Implementation lands in Phase 1 (Agent A): QR pair, poll pending jobs, send via `SmsManager`, ack status.

Point the app at the `@sendrova/relay` Worker URL once that workstream is ready. See `packages/sms-relay-api` for the frozen HTTP contract.

/** Relay runtime defaults (documented in README). */
export const PAIR_TTL_MS = 5 * 60 * 1000;
export const LEASE_TTL_MS = 2 * 60 * 1000;
export const PENDING_CLAIM_LIMIT = 5;
export const ONLINE_FRESHNESS_MS = 15_000;
export const FAILED_ERROR_MAX_LEN = 512;
export const BODY_MAX_LEN = 1600;

/** Max POST /v1/pair/start requests per client IP per window. */
export const PAIR_START_RATE_LIMIT = 10;
export const PAIR_START_RATE_WINDOW_MS = 15 * 60 * 1000;

/** Delete terminal jobs (sent/failed) older than this. */
export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pending / abandoned in_progress jobs older than this are marked failed
 * (stale leases are still reclaimable within this window).
 */
export const JOB_ABANDON_TTL_MS = 24 * 60 * 60 * 1000;

/** Delete expired pair records older than this after expiresAt. */
export const EXPIRED_PAIR_GC_MS = 60 * 60 * 1000;

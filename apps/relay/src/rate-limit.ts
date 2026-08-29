import {
	PAIR_START_RATE_LIMIT,
	PAIR_START_RATE_WINDOW_MS,
} from "./constants";
import { ApiError } from "./errors";
import { deleteKey, getJson, putJson } from "./storage";
import type { Env } from "./types";

interface RateWindow {
	/** Window start (ms since epoch). */
	windowStart: number;
	count: number;
}

function clientKey(req: Request): string {
	const cfIp = req.headers.get("cf-connecting-ip")?.trim();
	if (cfIp) return cfIp;
	const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	if (xff) return xff;
	return "unknown";
}

function rateKey(client: string): string {
	// Avoid raw IPs with awkward characters in object keys.
	const safe = encodeURIComponent(client).slice(0, 128);
	return `meta/rate/pair-start/${safe}.json`;
}

/**
 * Fixed-window rate limit for POST /v1/pair/start.
 * Throws ApiError 429 when the client exceeds the configured budget.
 */
export async function assertPairStartAllowed(
	env: Env,
	req: Request,
	now = Date.now(),
): Promise<void> {
	const key = rateKey(clientKey(req));
	const existing = await getJson<RateWindow>(env.SMS_BUCKET, key);
	const windowStart =
		existing && now - existing.windowStart < PAIR_START_RATE_WINDOW_MS
			? existing.windowStart
			: now;
	const count =
		existing && windowStart === existing.windowStart ? existing.count : 0;

	if (count >= PAIR_START_RATE_LIMIT) {
		const retryAfterSec = Math.max(
			1,
			Math.ceil((windowStart + PAIR_START_RATE_WINDOW_MS - now) / 1000),
		);
		throw new ApiError(
			429,
			"RATE_LIMITED",
			`Too many pairing attempts; retry in ~${retryAfterSec}s`,
		);
	}

	await putJson(env.SMS_BUCKET, key, {
		windowStart,
		count: count + 1,
	} satisfies RateWindow);
}

/** Test helper: clear rate-limit state for a request's client. */
export async function clearPairStartRateLimit(
	env: Env,
	req: Request,
): Promise<void> {
	await deleteKey(env.SMS_BUCKET, rateKey(clientKey(req)));
}

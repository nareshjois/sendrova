/**
 * Built-in Cloudflare Worker URL for the SMS relay (no trailing slash).
 * Production desktop always uses this unless overridden for local wrangler.
 */
export const SMS_RELAY_PRODUCTION_BASE_URL =
	"https://sendrova.nareshjois.com";

/** Explicit mock / offline unit-test mode (no network). */
export function isSmsRelayMockEnv(): boolean {
	const v = process.env.SMS_RELAY_MOCK?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes";
}

/**
 * Optional local override for `wrangler dev` (e.g. http://127.0.0.1:8787).
 * When unset, production always uses {@link SMS_RELAY_PRODUCTION_BASE_URL}.
 */
export function smsRelayEnvBaseUrlOverride(): string | null {
	const fromEnv = process.env.SMS_RELAY_BASE_URL?.trim();
	if (!fromEnv) return null;
	return fromEnv.replace(/\/$/, "");
}

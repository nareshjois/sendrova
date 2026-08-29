import type { TokenClaims, TokenRole } from "./types";

const textEncoder = new TextEncoder();

export function randomId(bytes = 16): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return bytesToHex(buf);
}

export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let out = "";
	for (const b of bytes) {
		out += b.toString(16).padStart(2, "0");
	}
	return out;
}

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await importHmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
	return bytesToHex(sig);
}

/** Stable hash for stored secrets/tokens (HMAC with TOKEN_SIGNING_KEY). */
export async function hashSecret(signingKey: string, value: string): Promise<string> {
	return hmacHex(signingKey, value);
}

function b64url(data: string): string {
	const bytes = textEncoder.encode(data);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string): string {
	const pad = "=".repeat((4 - (s.length % 4)) % 4);
	const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

/**
 * Opaque bearer: base64url(JSON claims).hmacHex
 * Claims are not encrypted; authenticity is via HMAC with TOKEN_SIGNING_KEY.
 */
export async function mintToken(
	signingKey: string,
	role: TokenRole,
	sub: string,
): Promise<{ token: string; tokenHash: string }> {
	const claims: TokenClaims = { role, sub, nonce: randomId(12) };
	const payload = b64url(JSON.stringify(claims));
	const mac = await hmacHex(signingKey, payload);
	const token = `${payload}.${mac}`;
	const tokenHash = await hashSecret(signingKey, token);
	return { token, tokenHash };
}

export async function verifyToken(
	signingKey: string,
	token: string,
): Promise<TokenClaims | null> {
	const parts = token.split(".");
	if (parts.length !== 2) return null;
	const [payload, mac] = parts;
	if (!payload || !mac) return null;
	const expected = await hmacHex(signingKey, payload);
	if (!timingSafeEqual(expected, mac)) return null;
	try {
		const claims = JSON.parse(b64urlDecode(payload)) as TokenClaims;
		if (
			(claims.role !== "desktop" && claims.role !== "device") ||
			typeof claims.sub !== "string" ||
			typeof claims.nonce !== "string"
		) {
			return null;
		}
		return claims;
	} catch {
		return null;
	}
}

export function bearerToken(req: Request): string | null {
	const h = req.headers.get("authorization");
	if (!h) return null;
	const m = /^Bearer\s+(.+)$/i.exec(h.trim());
	return m?.[1]?.trim() || null;
}

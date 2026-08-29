import { bearerToken, hashSecret, timingSafeEqual, verifyToken } from "./crypto";
import { ApiError } from "./errors";
import {
	getDevice,
	getPair,
	putPair,
} from "./storage";
import type { DeviceMeta, Env, PairRecord, TokenClaims } from "./types";

export interface DesktopAuth {
	claims: TokenClaims;
	pair: PairRecord;
	device: DeviceMeta | null;
	token: string;
}

export interface DeviceAuth {
	claims: TokenClaims;
	device: DeviceMeta;
	token: string;
}

function effectivePairStatus(pair: PairRecord, now = Date.now()): PairRecord["status"] {
	if (pair.status === "pending" && Date.parse(pair.expiresAt) <= now) {
		return "expired";
	}
	return pair.status;
}

export async function maybeExpirePair(env: Env, pair: PairRecord): Promise<PairRecord> {
	const status = effectivePairStatus(pair);
	if (status !== pair.status && status === "expired") {
		pair.status = "expired";
		await putPair(env, pair);
	}
	return pair;
}

export async function requireDesktopAuth(env: Env, req: Request): Promise<DesktopAuth> {
	const token = bearerToken(req);
	if (!token) {
		throw new ApiError(401, "UNAUTHORIZED", "Missing Bearer token");
	}
	const claims = await verifyToken(env.TOKEN_SIGNING_KEY, token);
	if (!claims || claims.role !== "desktop") {
		throw new ApiError(401, "UNAUTHORIZED", "Invalid desktop token");
	}
	const pair = await getPair(env, claims.sub);
	if (!pair) {
		throw new ApiError(401, "UNAUTHORIZED", "Unknown desktop session");
	}
	const tokenHash = await hashSecret(env.TOKEN_SIGNING_KEY, token);
	if (!timingSafeEqual(tokenHash, pair.desktopTokenHash)) {
		throw new ApiError(401, "UNAUTHORIZED", "Desktop token revoked");
	}
	await maybeExpirePair(env, pair);

	let device: DeviceMeta | null = null;
	if (pair.deviceId) {
		device = await getDevice(env, pair.deviceId);
	}
	return { claims, pair, device, token };
}

export async function requireDeviceAuth(env: Env, req: Request): Promise<DeviceAuth> {
	const token = bearerToken(req);
	if (!token) {
		throw new ApiError(401, "UNAUTHORIZED", "Missing Bearer token");
	}
	const claims = await verifyToken(env.TOKEN_SIGNING_KEY, token);
	if (!claims || claims.role !== "device") {
		throw new ApiError(401, "UNAUTHORIZED", "Invalid device token");
	}
	const device = await getDevice(env, claims.sub);
	if (!device) {
		throw new ApiError(401, "UNAUTHORIZED", "Unknown or unpaired device");
	}
	const tokenHash = await hashSecret(env.TOKEN_SIGNING_KEY, token);
	if (!timingSafeEqual(tokenHash, device.deviceTokenHash)) {
		throw new ApiError(401, "UNAUTHORIZED", "Device token revoked");
	}
	return { claims, device, token };
}

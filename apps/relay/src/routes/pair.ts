import { requireDesktopAuth, requireDeviceAuth, maybeExpirePair } from "../auth";
import { PAIR_TTL_MS } from "../constants";
import { hashSecret, mintToken, randomId, timingSafeEqual } from "../crypto";
import { ApiError, json } from "../errors";
import { assertPairStartAllowed } from "../rate-limit";
import {
	deleteKey,
	deviceMetaKey,
	getPair,
	getPairWithEtag,
	listJobs,
	jobKey,
	clientJobIndexKey,
	pairKey,
	putDevice,
	putPair,
	putPairIfMatch,
	relayBaseUrlFromRequest,
} from "../storage";
import type { Env, PairRecord } from "../types";

export async function handlePairStart(env: Env, req: Request): Promise<Response> {
	await assertPairStartAllowed(env, req);

	const pairId = randomId(16);
	const secret = randomId(24);
	const { token: desktopToken, tokenHash: desktopTokenHash } = await mintToken(
		env.TOKEN_SIGNING_KEY,
		"desktop",
		pairId,
	);
	const now = Date.now();
	const expiresAt = new Date(now + PAIR_TTL_MS).toISOString();
	const pair: PairRecord = {
		pairId,
		secretHash: await hashSecret(env.TOKEN_SIGNING_KEY, secret),
		desktopTokenHash,
		status: "pending",
		expiresAt,
		createdAt: new Date(now).toISOString(),
	};
	await putPair(env, pair);

	return json({
		pairId,
		secret,
		expiresAt,
		relayBaseUrl: relayBaseUrlFromRequest(req),
		desktopToken,
	});
}

export async function handlePairComplete(env: Env, req: Request): Promise<Response> {
	let body: { pairId?: unknown; secret?: unknown };
	try {
		body = (await req.json()) as { pairId?: unknown; secret?: unknown };
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "Invalid JSON body");
	}
	if (typeof body.pairId !== "string" || !body.pairId) {
		throw new ApiError(400, "VALIDATION_ERROR", "pairId is required");
	}
	if (typeof body.secret !== "string" || !body.secret) {
		throw new ApiError(400, "VALIDATION_ERROR", "secret is required");
	}

	const row = await getPairWithEtag(env, body.pairId);
	if (!row) {
		throw new ApiError(404, "NOT_FOUND", "Pair session not found");
	}
	const pair = await maybeExpirePair(env, row.value);

	if (pair.status === "expired") {
		throw new ApiError(401, "PAIR_EXPIRED", "Pairing session expired");
	}
	if (pair.status === "paired") {
		throw new ApiError(409, "PAIR_REDEEMED", "Pairing secret already redeemed");
	}

	const secretHash = await hashSecret(env.TOKEN_SIGNING_KEY, body.secret);
	if (!timingSafeEqual(secretHash, pair.secretHash)) {
		throw new ApiError(401, "INVALID_SECRET", "Invalid pairing secret");
	}

	const deviceId = randomId(16);
	const { token: deviceToken, tokenHash: deviceTokenHash } = await mintToken(
		env.TOKEN_SIGNING_KEY,
		"device",
		deviceId,
	);
	const nowIso = new Date().toISOString();

	// CAS the pair → paired first so concurrent redeemers lose without orphan devices.
	const next: PairRecord = {
		...pair,
		status: "paired",
		deviceId,
		redeemedAt: nowIso,
	};
	const won = await putPairIfMatch(env, next, row.etag);
	if (!won) {
		throw new ApiError(409, "PAIR_REDEEMED", "Pairing secret already redeemed");
	}

	await putDevice(env, {
		deviceId,
		pairId: pair.pairId,
		deviceTokenHash,
		desktopTokenHash: pair.desktopTokenHash,
		pairedAt: nowIso,
		lastSeenAt: nowIso,
	});

	return json({ deviceId, deviceToken });
}

export async function handlePairStatus(env: Env, req: Request): Promise<Response> {
	const auth = await requireDesktopAuth(env, req);
	const url = new URL(req.url);
	const pairId = url.searchParams.get("pairId");
	if (!pairId) {
		throw new ApiError(400, "VALIDATION_ERROR", "pairId query parameter is required");
	}
	if (pairId !== auth.pair.pairId) {
		throw new ApiError(404, "NOT_FOUND", "Pair session not found");
	}

	const pair = await maybeExpirePair(env, auth.pair);
	if (pair.status === "paired" && pair.deviceId) {
		return json({ status: "paired", deviceId: pair.deviceId });
	}
	if (pair.status === "expired") {
		return json({ status: "expired" });
	}
	return json({ status: "pending" });
}

export async function handleUnpair(env: Env, req: Request): Promise<Response> {
	const desktopAttempt = await tryDesktop(env, req);
	if (desktopAttempt) {
		await clearBinding(env, desktopAttempt.pair, desktopAttempt.device?.deviceId);
		return json({ ok: true });
	}
	const deviceAttempt = await tryDevice(env, req);
	if (deviceAttempt) {
		const pair = await getPair(env, deviceAttempt.device.pairId);
		await clearBinding(env, pair, deviceAttempt.device.deviceId);
		return json({ ok: true });
	}
	throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid token");
}

async function tryDesktop(env: Env, req: Request) {
	try {
		return await requireDesktopAuth(env, req);
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}

async function tryDevice(env: Env, req: Request) {
	try {
		return await requireDeviceAuth(env, req);
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}

async function clearBinding(
	env: Env,
	pair: PairRecord | null,
	deviceId: string | undefined,
): Promise<void> {
	if (deviceId) {
		const jobs = await listJobs(env, deviceId);
		for (const job of jobs) {
			await deleteKey(env.SMS_BUCKET, jobKey(deviceId, job.jobId));
			await deleteKey(
				env.SMS_BUCKET,
				clientJobIndexKey(deviceId, job.clientJobId),
			);
		}
		await deleteKey(env.SMS_BUCKET, deviceMetaKey(deviceId));
	}
	if (pair) {
		await deleteKey(env.SMS_BUCKET, pairKey(pair.pairId));
	}
}

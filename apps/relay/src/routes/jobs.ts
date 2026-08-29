import { requireDesktopAuth, requireDeviceAuth } from "../auth";
import {
	BODY_MAX_LEN,
	FAILED_ERROR_MAX_LEN,
	LEASE_TTL_MS,
	PENDING_CLAIM_LIMIT,
} from "../constants";
import { randomId } from "../crypto";
import { ApiError, json } from "../errors";
import { gcDeviceJobs } from "../gc";
import { normalizeTo } from "../phone";
import {
	deleteKey,
	getJob,
	getJobWithEtag,
	getJson,
	jobKey,
	listJobsWithEtag,
	putJob,
	putJobIfMatch,
	putJsonIfAbsent,
	clientJobIndexKey,
	touchLastSeen,
} from "../storage";
import type { Env, JobRecord, JobStatus } from "../types";

interface ClientJobIndex {
	jobId: string;
	to: string;
	body: string;
}

function publicJob(job: JobRecord) {
	return {
		jobId: job.jobId,
		to: job.to,
		body: job.body,
		clientJobId: job.clientJobId,
		status: job.status,
		error: job.error,
	};
}

function jobStatusResponse(job: JobRecord) {
	return {
		jobId: job.jobId,
		status: job.status,
		clientJobId: job.clientJobId,
		error: job.error,
		updatedAt: job.updatedAt,
	};
}

function isLeaseStale(job: JobRecord, now: number): boolean {
	if (job.status !== "in_progress") return false;
	if (!job.leaseExpiresAt) return true;
	return Date.parse(job.leaseExpiresAt) <= now;
}

async function resolveExistingClientJob(
	env: Env,
	deviceId: string,
	clientJobId: string,
	to: string,
	body: string,
): Promise<Response | null> {
	const indexKey = clientJobIndexKey(deviceId, clientJobId);
	const existingIndex = await getJson<ClientJobIndex>(env.SMS_BUCKET, indexKey);
	if (!existingIndex) return null;
	const existing = await getJob(env, deviceId, existingIndex.jobId);
	if (!existing) {
		// Orphan index: drop and allow a fresh create.
		await deleteKey(env.SMS_BUCKET, indexKey);
		return null;
	}
	if (existing.to === to && existing.body === body) {
		return json({ jobId: existing.jobId, status: "pending" as const });
	}
	throw new ApiError(
		409,
		"IDEMPOTENCY_CONFLICT",
		"clientJobId already used with different to/body",
	);
}

export async function handleCreateJob(env: Env, req: Request): Promise<Response> {
	const auth = await requireDesktopAuth(env, req);
	if (!auth.device || auth.pair.status !== "paired") {
		throw new ApiError(404, "NO_DEVICE", "No paired device for this desktop session");
	}

	let body: { to?: unknown; body?: unknown; clientJobId?: unknown };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "Invalid JSON body");
	}

	if (typeof body.to !== "string") {
		throw new ApiError(400, "VALIDATION_ERROR", "to is required");
	}
	if (typeof body.body !== "string") {
		throw new ApiError(400, "VALIDATION_ERROR", "body is required");
	}
	if (typeof body.clientJobId !== "string" || !body.clientJobId.trim()) {
		throw new ApiError(400, "VALIDATION_ERROR", "clientJobId is required");
	}
	if (body.body.length === 0 || body.body.length > BODY_MAX_LEN) {
		throw new ApiError(
			400,
			"VALIDATION_ERROR",
			`body must be 1–${BODY_MAX_LEN} characters`,
		);
	}

	const to = normalizeTo(body.to);
	if (!to) {
		throw new ApiError(
			400,
			"VALIDATION_ERROR",
			"to must be E.164 (+digits) or 7–15 digits",
		);
	}

	const clientJobId = body.clientJobId.trim();
	const deviceId = auth.device.deviceId;
	const indexKey = clientJobIndexKey(deviceId, clientJobId);

	const early = await resolveExistingClientJob(
		env,
		deviceId,
		clientJobId,
		to,
		body.body,
	);
	if (early) return early;

	const nowIso = new Date().toISOString();
	const jobId = randomId(16);
	const job: JobRecord = {
		jobId,
		deviceId,
		clientJobId,
		to,
		body: body.body,
		status: "pending",
		error: null,
		createdAt: nowIso,
		updatedAt: nowIso,
		leaseExpiresAt: null,
	};

	// Write job first, then claim the idempotency index with If-None-Match.
	// If another create wins the index, delete our orphan job and replay.
	await putJob(env, job);
	const indexed = await putJsonIfAbsent(env.SMS_BUCKET, indexKey, {
		jobId,
		to,
		body: body.body,
	} satisfies ClientJobIndex);

	if (!indexed) {
		await deleteKey(env.SMS_BUCKET, jobKey(deviceId, jobId));
		const replay = await resolveExistingClientJob(
			env,
			deviceId,
			clientJobId,
			to,
			body.body,
		);
		if (replay) return replay;
		throw new ApiError(
			409,
			"IDEMPOTENCY_CONFLICT",
			"clientJobId already used with different to/body",
		);
	}

	return json({ jobId, status: "pending" as const });
}

export async function handlePendingJobs(env: Env, req: Request): Promise<Response> {
	const auth = await requireDeviceAuth(env, req);
	await touchLastSeen(env, auth.device.deviceId);

	const now = Date.now();
	// Opportunistic per-device GC (terminal TTL + abandoned leases).
	await gcDeviceJobs(env, auth.device.deviceId, now);

	const jobs = await listJobsWithEtag(env, auth.device.deviceId);
	// Stable order: oldest first
	jobs.sort(
		(a, b) => Date.parse(a.value.createdAt) - Date.parse(b.value.createdAt),
	);

	const claimed: JobRecord[] = [];
	for (const { value: job, etag } of jobs) {
		if (claimed.length >= PENDING_CLAIM_LIMIT) break;

		let claimable = job.status === "pending";
		if (isLeaseStale(job, now)) {
			claimable = true;
		}
		if (!claimable) continue;

		const leaseExpiresAt = new Date(now + LEASE_TTL_MS).toISOString();
		const updated: JobRecord = {
			...job,
			status: "in_progress",
			leaseExpiresAt,
			updatedAt: new Date(now).toISOString(),
			error: null,
		};
		// Optimistic claim: skip if another poll already leased this object.
		const won = await putJobIfMatch(env, updated, etag);
		if (!won) continue;
		claimed.push(updated);
	}

	return json({ jobs: claimed.map(publicJob) });
}

export async function handleUpdateJobStatus(
	env: Env,
	req: Request,
	jobId: string,
): Promise<Response> {
	const auth = await requireDeviceAuth(env, req);
	await touchLastSeen(env, auth.device.deviceId);

	let body: { status?: unknown; error?: unknown };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "Invalid JSON body");
	}

	if (body.status !== "sent" && body.status !== "failed") {
		throw new ApiError(400, "VALIDATION_ERROR", "status must be sent or failed");
	}

	let error: string | null = null;
	if (body.status === "failed") {
		if (typeof body.error !== "string" || !body.error.trim()) {
			throw new ApiError(
				400,
				"VALIDATION_ERROR",
				"error is required when status is failed",
			);
		}
		error = body.error.trim().slice(0, FAILED_ERROR_MAX_LEN);
	} else if (body.error != null && body.error !== "") {
		// sent: ignore/forbid meaningful error
		throw new ApiError(
			400,
			"VALIDATION_ERROR",
			"error must be omitted when status is sent",
		);
	}

	const row = await getJobWithEtag(env, auth.device.deviceId, jobId);
	if (!row) {
		throw new ApiError(404, "NOT_FOUND", "Job not found");
	}

	const terminal: JobStatus[] = ["sent", "failed"];
	if (terminal.includes(row.value.status)) {
		if (row.value.status === body.status && (row.value.error ?? null) === error) {
			// Idempotent identical ack
			return json(jobStatusResponse(row.value));
		}
		throw new ApiError(409, "JOB_TERMINAL", "Job already in a terminal status");
	}

	const nowIso = new Date().toISOString();
	const updated: JobRecord = {
		...row.value,
		status: body.status,
		error,
		leaseExpiresAt: null,
		updatedAt: nowIso,
	};
	const won = await putJobIfMatch(env, updated, row.etag);
	if (!won) {
		// Concurrent terminal write — re-read and treat as idempotent/conflict.
		const again = await getJob(env, auth.device.deviceId, jobId);
		if (
			again &&
			terminal.includes(again.status) &&
			again.status === body.status &&
			(again.error ?? null) === error
		) {
			return json(jobStatusResponse(again));
		}
		throw new ApiError(409, "JOB_TERMINAL", "Job already in a terminal status");
	}

	return json(jobStatusResponse(updated));
}

export async function handleGetJob(
	env: Env,
	req: Request,
	jobId: string,
): Promise<Response> {
	const auth = await requireDesktopAuth(env, req);
	if (!auth.device) {
		throw new ApiError(404, "NO_DEVICE", "No paired device for this desktop session");
	}
	const job = await getJob(env, auth.device.deviceId, jobId);
	if (!job) {
		throw new ApiError(404, "NOT_FOUND", "Job not found");
	}
	return json(jobStatusResponse(job));
}

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
	getJob,
	getJson,
	listJobs,
	putJob,
	putJson,
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
	const existingIndex = await getJson<ClientJobIndex>(env.SMS_BUCKET, indexKey);
	if (existingIndex) {
		const existing = await getJob(env, deviceId, existingIndex.jobId);
		if (existing) {
			if (existing.to === to && existing.body === body.body) {
				// Idempotent replay
				return json({ jobId: existing.jobId, status: "pending" as const });
			}
			throw new ApiError(
				409,
				"IDEMPOTENCY_CONFLICT",
				"clientJobId already used with different to/body",
			);
		}
	}

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
	await putJob(env, job);
	await putJson(env.SMS_BUCKET, indexKey, {
		jobId,
		to,
		body: body.body,
	} satisfies ClientJobIndex);

	return json({ jobId, status: "pending" as const });
}

export async function handlePendingJobs(env: Env, req: Request): Promise<Response> {
	const auth = await requireDeviceAuth(env, req);
	await touchLastSeen(env, auth.device.deviceId);

	const now = Date.now();
	// Opportunistic per-device GC (terminal TTL + abandoned leases).
	await gcDeviceJobs(env, auth.device.deviceId, now);

	const jobs = await listJobs(env, auth.device.deviceId);
	// Stable order: oldest first
	jobs.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

	const claimed: JobRecord[] = [];
	for (const job of jobs) {
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
		await putJob(env, updated);
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

	const job = await getJob(env, auth.device.deviceId, jobId);
	if (!job) {
		throw new ApiError(404, "NOT_FOUND", "Job not found");
	}

	const terminal: JobStatus[] = ["sent", "failed"];
	if (terminal.includes(job.status)) {
		if (job.status === body.status && (job.error ?? null) === error) {
			// Idempotent identical ack
			return json(jobStatusResponse(job));
		}
		throw new ApiError(409, "JOB_TERMINAL", "Job already in a terminal status");
	}

	const nowIso = new Date().toISOString();
	job.status = body.status;
	job.error = error;
	job.leaseExpiresAt = null;
	job.updatedAt = nowIso;
	await putJob(env, job);

	return json(jobStatusResponse(job));
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

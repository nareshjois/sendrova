import {
	EXPIRED_PAIR_GC_MS,
	JOB_ABANDON_TTL_MS,
	JOB_TTL_MS,
	PAIR_START_RATE_WINDOW_MS,
} from "./constants";
import {
	clientJobIndexKey,
	deleteKey,
	getJson,
	jobKey,
	listJobs,
	pairKey,
	putJob,
} from "./storage";
import type { Env, JobRecord, PairRecord } from "./types";

export interface GcStats {
	pairsDeleted: number;
	jobsDeleted: number;
	jobsAbandoned: number;
	rateLimitMetaDeleted: number;
}

interface RateWindow {
	windowStart: number;
	count: number;
}

const RATE_LIMIT_PREFIX = "meta/rate/pair-start/";

/**
 * Garbage-collect expired pair sessions and old job objects.
 * Also marks abandoned pending/in_progress jobs as failed and
 * deletes stale pair-start rate-limit windows.
 */
export async function runGc(env: Env, now = Date.now()): Promise<GcStats> {
	const stats: GcStats = {
		pairsDeleted: 0,
		jobsDeleted: 0,
		jobsAbandoned: 0,
		rateLimitMetaDeleted: 0,
	};

	stats.pairsDeleted += await gcExpiredPairs(env, now);
	const jobStats = await gcJobs(env, now);
	stats.jobsDeleted += jobStats.deleted;
	stats.jobsAbandoned += jobStats.abandoned;
	stats.rateLimitMetaDeleted += await gcRateLimitMeta(env, now);
	return stats;
}

async function gcRateLimitMeta(env: Env, now: number): Promise<number> {
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const listed = await env.SMS_BUCKET.list({
			prefix: RATE_LIMIT_PREFIX,
			cursor,
			limit: 100,
		});
		for (const obj of listed.objects) {
			if (!obj.key.endsWith(".json")) continue;
			const window = await getJson<RateWindow>(env.SMS_BUCKET, obj.key);
			if (!window) {
				await deleteKey(env.SMS_BUCKET, obj.key);
				deleted += 1;
				continue;
			}
			// Drop windows that can no longer affect the fixed-window limit.
			if (now - window.windowStart >= PAIR_START_RATE_WINDOW_MS) {
				await deleteKey(env.SMS_BUCKET, obj.key);
				deleted += 1;
			}
		}
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
	return deleted;
}

async function gcExpiredPairs(env: Env, now: number): Promise<number> {
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const listed = await env.SMS_BUCKET.list({
			prefix: "pair/",
			cursor,
			limit: 100,
		});
		for (const obj of listed.objects) {
			if (!obj.key.endsWith(".json")) continue;
			const pair = await getJson<PairRecord>(env.SMS_BUCKET, obj.key);
			if (!pair) continue;
			const expiredAt = Date.parse(pair.expiresAt);
			const isExpired =
				pair.status === "expired" ||
				(pair.status === "pending" && expiredAt <= now);
			if (!isExpired) continue;
			// Keep briefly after expiry so status polls can still report "expired".
			if (now - expiredAt < EXPIRED_PAIR_GC_MS) continue;
			await deleteKey(env.SMS_BUCKET, pairKey(pair.pairId));
			deleted += 1;
		}
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
	return deleted;
}

async function gcJobs(
	env: Env,
	now: number,
): Promise<{ deleted: number; abandoned: number }> {
	let deleted = 0;
	let abandoned = 0;
	let cursor: string | undefined;
	do {
		const listed = await env.SMS_BUCKET.list({
			prefix: "devices/",
			cursor,
			limit: 200,
		});
		for (const obj of listed.objects) {
			// devices/{deviceId}/jobs/{jobId}.json
			const m = /^devices\/([^/]+)\/jobs\/([^/]+)\.json$/.exec(obj.key);
			if (!m) continue;
			const deviceId = m[1]!;
			const job = await getJson<JobRecord>(env.SMS_BUCKET, obj.key);
			if (!job) continue;

			const updatedAt = Date.parse(job.updatedAt);
			const age = now - updatedAt;

			if (job.status === "sent" || job.status === "failed") {
				if (age >= JOB_TTL_MS) {
					await deleteJobObjects(env, deviceId, job);
					deleted += 1;
				}
				continue;
			}

			// pending or in_progress past abandon TTL → mark failed (keeps desktop poll honest)
			if (age >= JOB_ABANDON_TTL_MS) {
				const nowIso = new Date(now).toISOString();
				const updated: JobRecord = {
					...job,
					status: "failed",
					error:
						job.status === "in_progress"
							? "LEASE_ABANDONED"
							: "JOB_ABANDONED",
					leaseExpiresAt: null,
					updatedAt: nowIso,
				};
				await putJob(env, updated);
				abandoned += 1;
			}
		}
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
	return { deleted, abandoned };
}

async function deleteJobObjects(
	env: Env,
	deviceId: string,
	job: JobRecord,
): Promise<void> {
	await deleteKey(env.SMS_BUCKET, jobKey(deviceId, job.jobId));
	await deleteKey(env.SMS_BUCKET, clientJobIndexKey(deviceId, job.clientJobId));
}

/** Opportunistic light GC: expire pairs for one device's jobs during pending poll. */
export async function gcDeviceJobs(
	env: Env,
	deviceId: string,
	now = Date.now(),
): Promise<void> {
	const jobs = await listJobs(env, deviceId);
	for (const job of jobs) {
		const age = now - Date.parse(job.updatedAt);
		if (
			(job.status === "sent" || job.status === "failed") &&
			age >= JOB_TTL_MS
		) {
			await deleteJobObjects(env, deviceId, job);
			continue;
		}
		if (
			(job.status === "pending" || job.status === "in_progress") &&
			age >= JOB_ABANDON_TTL_MS
		) {
			await putJob(env, {
				...job,
				status: "failed",
				error:
					job.status === "in_progress" ? "LEASE_ABANDONED" : "JOB_ABANDONED",
				leaseExpiresAt: null,
				updatedAt: new Date(now).toISOString(),
			});
		}
	}
}

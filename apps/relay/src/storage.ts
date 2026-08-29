import type { DeviceMeta, Env, JobRecord, PairRecord } from "./types";

export function pairKey(pairId: string): string {
	return `pair/${pairId}.json`;
}

export function deviceMetaKey(deviceId: string): string {
	return `devices/${deviceId}/meta.json`;
}

export function jobKey(deviceId: string, jobId: string): string {
	return `devices/${deviceId}/jobs/${jobId}.json`;
}

export function clientJobIndexKey(deviceId: string, clientJobId: string): string {
	return `devices/${deviceId}/clientJobs/${encodeURIComponent(clientJobId)}.json`;
}

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const obj = await bucket.get(key);
	if (!obj) return null;
	return (await obj.json()) as T;
}

export async function putJson(
	bucket: R2Bucket,
	key: string,
	value: unknown,
): Promise<void> {
	await bucket.put(key, JSON.stringify(value), {
		httpMetadata: { contentType: "application/json" },
	});
}

export async function deleteKey(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key);
}

export async function getPair(env: Env, pairId: string): Promise<PairRecord | null> {
	return getJson<PairRecord>(env.SMS_BUCKET, pairKey(pairId));
}

export async function putPair(env: Env, pair: PairRecord): Promise<void> {
	await putJson(env.SMS_BUCKET, pairKey(pair.pairId), pair);
}

export async function getDevice(env: Env, deviceId: string): Promise<DeviceMeta | null> {
	return getJson<DeviceMeta>(env.SMS_BUCKET, deviceMetaKey(deviceId));
}

export async function putDevice(env: Env, meta: DeviceMeta): Promise<void> {
	await putJson(env.SMS_BUCKET, deviceMetaKey(meta.deviceId), meta);
}

export async function getJob(
	env: Env,
	deviceId: string,
	jobId: string,
): Promise<JobRecord | null> {
	return getJson<JobRecord>(env.SMS_BUCKET, jobKey(deviceId, jobId));
}

export async function putJob(env: Env, job: JobRecord): Promise<void> {
	await putJson(env.SMS_BUCKET, jobKey(job.deviceId, job.jobId), job);
}

export async function listJobs(
	env: Env,
	deviceId: string,
): Promise<JobRecord[]> {
	const prefix = `devices/${deviceId}/jobs/`;
	const listed = await env.SMS_BUCKET.list({ prefix });
	const jobs: JobRecord[] = [];
	for (const obj of listed.objects) {
		if (!obj.key.endsWith(".json")) continue;
		const job = await getJson<JobRecord>(env.SMS_BUCKET, obj.key);
		if (job) jobs.push(job);
	}
	return jobs;
}

export async function touchLastSeen(env: Env, deviceId: string): Promise<DeviceMeta | null> {
	const meta = await getDevice(env, deviceId);
	if (!meta) return null;
	meta.lastSeenAt = new Date().toISOString();
	await putDevice(env, meta);
	return meta;
}

export function relayBaseUrlFromRequest(req: Request): string {
	const url = new URL(req.url);
	return `${url.protocol}//${url.host}`;
}

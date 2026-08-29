import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	EXPIRED_PAIR_GC_MS,
	JOB_ABANDON_TTL_MS,
	JOB_TTL_MS,
	PAIR_START_RATE_LIMIT,
} from "../src/constants";
import { runGc } from "../src/gc";
import { clearPairStartRateLimit } from "../src/rate-limit";
import {
	clientJobIndexKey,
	jobKey,
	pairKey,
	putJson,
} from "../src/storage";
import type { JobRecord, PairRecord } from "../src/types";

async function json<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}

describe("SMS relay Worker", () => {
	it("pair → enqueue → claim → ack happy path", async () => {
		const startRes = await SELF.fetch("http://localhost/v1/pair/start", {
			method: "POST",
		});
		expect(startRes.status).toBe(200);
		const start = await json<{
			pairId: string;
			secret: string;
			expiresAt: string;
			relayBaseUrl: string;
			desktopToken: string;
		}>(startRes);
		expect(start.pairId).toBeTruthy();
		expect(start.secret).toBeTruthy();
		expect(start.desktopToken).toBeTruthy();
		expect(start.relayBaseUrl).toMatch(/^http:\/\/localhost/);

		const statusPending = await SELF.fetch(
			`http://localhost/v1/pair/status?pairId=${encodeURIComponent(start.pairId)}`,
			{ headers: { Authorization: `Bearer ${start.desktopToken}` } },
		);
		expect(statusPending.status).toBe(200);
		expect(await json<{ status: string }>(statusPending)).toEqual({
			status: "pending",
		});

		const completeRes = await SELF.fetch("http://localhost/v1/pair/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pairId: start.pairId, secret: start.secret }),
		});
		expect(completeRes.status).toBe(200);
		const complete = await json<{ deviceId: string; deviceToken: string }>(
			completeRes,
		);
		expect(complete.deviceId).toBeTruthy();
		expect(complete.deviceToken).toBeTruthy();

		// One-time redeem
		const redeemAgain = await SELF.fetch("http://localhost/v1/pair/complete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pairId: start.pairId, secret: start.secret }),
		});
		expect(redeemAgain.status).toBe(409);
		expect((await json<{ error: { code: string } }>(redeemAgain)).error.code).toBe(
			"PAIR_REDEEMED",
		);

		const statusPaired = await SELF.fetch(
			`http://localhost/v1/pair/status?pairId=${encodeURIComponent(start.pairId)}`,
			{ headers: { Authorization: `Bearer ${start.desktopToken}` } },
		);
		expect(await json<{ status: string; deviceId: string }>(statusPaired)).toEqual({
			status: "paired",
			deviceId: complete.deviceId,
		});

		const createRes = await SELF.fetch("http://localhost/v1/jobs", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${start.desktopToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				to: "+1 (555) 123-4567",
				body: "hello from relay test",
				clientJobId: "attempt-1",
			}),
		});
		expect(createRes.status).toBe(200);
		const created = await json<{ jobId: string; status: string }>(createRes);
		expect(created.status).toBe("pending");
		expect(created.jobId).toBeTruthy();

		// Idempotent replay
		const replay = await SELF.fetch("http://localhost/v1/jobs", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${start.desktopToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				to: "+15551234567",
				body: "hello from relay test",
				clientJobId: "attempt-1",
			}),
		});
		expect(replay.status).toBe(200);
		expect((await json<{ jobId: string }>(replay)).jobId).toBe(created.jobId);

		// Conflict on same clientJobId, different body
		const conflict = await SELF.fetch("http://localhost/v1/jobs", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${start.desktopToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				to: "+15551234567",
				body: "different",
				clientJobId: "attempt-1",
			}),
		});
		expect(conflict.status).toBe(409);
		expect((await json<{ error: { code: string } }>(conflict)).error.code).toBe(
			"IDEMPOTENCY_CONFLICT",
		);

		const pendingRes = await SELF.fetch("http://localhost/v1/jobs/pending", {
			headers: { Authorization: `Bearer ${complete.deviceToken}` },
		});
		expect(pendingRes.status).toBe(200);
		const pending = await json<{
			jobs: Array<{ jobId: string; status: string; to: string }>;
		}>(pendingRes);
		expect(pending.jobs).toHaveLength(1);
		expect(pending.jobs[0]!.jobId).toBe(created.jobId);
		expect(pending.jobs[0]!.status).toBe("in_progress");
		expect(pending.jobs[0]!.to).toBe("+15551234567");

		// Second poll should not re-claim while lease is fresh
		const pending2 = await json<{ jobs: unknown[] }>(
			await SELF.fetch("http://localhost/v1/jobs/pending", {
				headers: { Authorization: `Bearer ${complete.deviceToken}` },
			}),
		);
		expect(pending2.jobs).toHaveLength(0);

		const ackRes = await SELF.fetch(
			`http://localhost/v1/jobs/${created.jobId}/status`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${complete.deviceToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ status: "sent" }),
			},
		);
		expect(ackRes.status).toBe(200);
		expect((await json<{ status: string }>(ackRes)).status).toBe("sent");

		const getRes = await SELF.fetch(`http://localhost/v1/jobs/${created.jobId}`, {
			headers: { Authorization: `Bearer ${start.desktopToken}` },
		});
		expect(getRes.status).toBe(200);
		expect((await json<{ status: string }>(getRes)).status).toBe("sent");

		const healthRes = await SELF.fetch("http://localhost/v1/device/health", {
			headers: { Authorization: `Bearer ${start.desktopToken}` },
		});
		expect(healthRes.status).toBe(200);
		const health = await json<{ online: boolean; lastSeenAt: string | null }>(
			healthRes,
		);
		expect(health.online).toBe(true);
		expect(health.lastSeenAt).toBeTruthy();
	});

	it("rejects failed ack without error and requires error on failed", async () => {
		const start = await json<{
			pairId: string;
			secret: string;
			desktopToken: string;
		}>(await SELF.fetch("http://localhost/v1/pair/start", { method: "POST" }));
		const complete = await json<{ deviceToken: string }>(
			await SELF.fetch("http://localhost/v1/pair/complete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pairId: start.pairId, secret: start.secret }),
			}),
		);
		const created = await json<{ jobId: string }>(
			await SELF.fetch("http://localhost/v1/jobs", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${start.desktopToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					to: "15551234567",
					body: "x",
					clientJobId: "fail-1",
				}),
			}),
		);
		await SELF.fetch("http://localhost/v1/jobs/pending", {
			headers: { Authorization: `Bearer ${complete.deviceToken}` },
		});

		const bad = await SELF.fetch(
			`http://localhost/v1/jobs/${created.jobId}/status`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${complete.deviceToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ status: "failed" }),
			},
		);
		expect(bad.status).toBe(400);

		const ok = await SELF.fetch(
			`http://localhost/v1/jobs/${created.jobId}/status`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${complete.deviceToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ status: "failed", error: "RADIO_OFF" }),
			},
		);
		expect(ok.status).toBe(200);
		const body = await json<{ status: string; error: string }>(ok);
		expect(body.status).toBe("failed");
		expect(body.error).toBe("RADIO_OFF");
	});

	it("unpair revokes tokens", async () => {
		const start = await json<{
			pairId: string;
			secret: string;
			desktopToken: string;
		}>(await SELF.fetch("http://localhost/v1/pair/start", { method: "POST" }));
		const complete = await json<{ deviceToken: string }>(
			await SELF.fetch("http://localhost/v1/pair/complete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pairId: start.pairId, secret: start.secret }),
			}),
		);

		const unpair = await SELF.fetch("http://localhost/v1/pair/unpair", {
			method: "POST",
			headers: { Authorization: `Bearer ${start.desktopToken}` },
		});
		expect(unpair.status).toBe(200);

		const health = await SELF.fetch("http://localhost/v1/device/health", {
			headers: { Authorization: `Bearer ${start.desktopToken}` },
		});
		expect(health.status).toBe(401);

		const pending = await SELF.fetch("http://localhost/v1/jobs/pending", {
			headers: { Authorization: `Bearer ${complete.deviceToken}` },
		});
		expect(pending.status).toBe(401);
	});

	it("rate-limits POST /v1/pair/start", async () => {
		const req = new Request("http://localhost/v1/pair/start", {
			method: "POST",
			headers: { "cf-connecting-ip": "203.0.113.50" },
		});
		await clearPairStartRateLimit(env, req);

		for (let i = 0; i < PAIR_START_RATE_LIMIT; i++) {
			const res = await SELF.fetch(
				new Request("http://localhost/v1/pair/start", {
					method: "POST",
					headers: { "cf-connecting-ip": "203.0.113.50" },
				}),
			);
			expect(res.status).toBe(200);
		}

		const limited = await SELF.fetch(
			new Request("http://localhost/v1/pair/start", {
				method: "POST",
				headers: { "cf-connecting-ip": "203.0.113.50" },
			}),
		);
		expect(limited.status).toBe(429);
		expect((await json<{ error: { code: string } }>(limited)).error.code).toBe(
			"RATE_LIMITED",
		);

		// Different IP still allowed
		const other = await SELF.fetch(
			new Request("http://localhost/v1/pair/start", {
				method: "POST",
				headers: { "cf-connecting-ip": "203.0.113.99" },
			}),
		);
		expect(other.status).toBe(200);
	});

	it("GC deletes old terminal jobs and abandons stale in_progress", async () => {
		const now = Date.now();
		const deviceId = "gc-device-1";
		const oldJobId = "old-sent-job";
		const staleJobId = "stale-lease-job";

		const oldJob: JobRecord = {
			jobId: oldJobId,
			deviceId,
			clientJobId: "gc-old",
			to: "+15550001111",
			body: "old",
			status: "sent",
			error: null,
			createdAt: new Date(now - JOB_TTL_MS - 60_000).toISOString(),
			updatedAt: new Date(now - JOB_TTL_MS - 60_000).toISOString(),
			leaseExpiresAt: null,
		};
		await putJson(env.SMS_BUCKET, jobKey(deviceId, oldJobId), oldJob);
		await putJson(env.SMS_BUCKET, clientJobIndexKey(deviceId, "gc-old"), {
			jobId: oldJobId,
			to: oldJob.to,
			body: oldJob.body,
		});

		const staleJob: JobRecord = {
			jobId: staleJobId,
			deviceId,
			clientJobId: "gc-stale",
			to: "+15550002222",
			body: "stale",
			status: "in_progress",
			error: null,
			createdAt: new Date(now - JOB_ABANDON_TTL_MS - 60_000).toISOString(),
			updatedAt: new Date(now - JOB_ABANDON_TTL_MS - 60_000).toISOString(),
			leaseExpiresAt: new Date(now - 60_000).toISOString(),
		};
		await putJson(env.SMS_BUCKET, jobKey(deviceId, staleJobId), staleJob);

		const expiredPair: PairRecord = {
			pairId: "expired-pair-gc",
			secretHash: "x",
			desktopTokenHash: "y",
			status: "expired",
			expiresAt: new Date(now - EXPIRED_PAIR_GC_MS - 60_000).toISOString(),
			createdAt: new Date(now - EXPIRED_PAIR_GC_MS - 120_000).toISOString(),
		};
		await putJson(env.SMS_BUCKET, pairKey(expiredPair.pairId), expiredPair);

		const stats = await runGc(env, now);
		expect(stats.jobsDeleted).toBeGreaterThanOrEqual(1);
		expect(stats.jobsAbandoned).toBeGreaterThanOrEqual(1);
		expect(stats.pairsDeleted).toBeGreaterThanOrEqual(1);

		expect(await env.SMS_BUCKET.get(jobKey(deviceId, oldJobId))).toBeNull();
		expect(
			await env.SMS_BUCKET.get(clientJobIndexKey(deviceId, "gc-old")),
		).toBeNull();
		expect(await env.SMS_BUCKET.get(pairKey(expiredPair.pairId))).toBeNull();

		const staleObj = await env.SMS_BUCKET.get(jobKey(deviceId, staleJobId));
		expect(staleObj).not.toBeNull();
		const staleParsed = (await staleObj!.json()) as JobRecord;
		expect(staleParsed.status).toBe("failed");
		expect(staleParsed.error).toBe("LEASE_ABANDONED");
	});
});

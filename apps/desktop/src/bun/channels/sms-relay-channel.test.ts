import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeRmSync } from "../test-fs";

function freshDataDir(): string {
	const dir = join(tmpdir(), `sendrova-sms-${crypto.randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

let dataDir = freshDataDir();
process.env.SENDROVA_DATA = dataDir;
delete process.env.SMS_RELAY_BASE_URL;

const {
	SmsRelayChannel,
	clearMockJobsForTests,
	clearSmsRelayState,
	isSmsMockMode,
	writeSmsRelayState,
} = await import("./index");

beforeEach(() => {
	safeRmSync(dataDir);
	dataDir = freshDataDir();
	process.env.SENDROVA_DATA = dataDir;
	delete process.env.SMS_RELAY_BASE_URL;
	clearMockJobsForTests();
	clearSmsRelayState();
});

afterEach(() => {
	clearMockJobsForTests();
	clearSmsRelayState();
	safeRmSync(dataDir);
	delete process.env.SMS_RELAY_BASE_URL;
});

describe("SmsRelayChannel mock", () => {
	test("is mock-ready when SMS_RELAY_BASE_URL unset", () => {
		expect(isSmsMockMode()).toBe(true);
		const channel = new SmsRelayChannel();
		expect(channel.isReady()).toBe(true);
	});

	test("send returns remoteJobId and waitUntilSent resolves", async () => {
		const channel = new SmsRelayChannel();
		const result = await channel.send({
			to: "919876543210",
			body: "Hello",
			clientJobId: "attempt-1",
		});
		expect(result.remoteJobId).toStartWith("mock-");
		await channel.waitUntilSent?.(result.remoteJobId!);
	});

	test("live mode requires paired token", () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({ status: "unpaired", desktopToken: null });
		const channel = new SmsRelayChannel();
		expect(isSmsMockMode()).toBe(false);
		expect(channel.isReady()).toBe(false);

		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});
		expect(channel.isReady()).toBe(true);
	});
});

describe("SmsRelayChannel waitUntilSent live", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("polls until phone acks sent", async () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});

		let polls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/v1/jobs/") && !url.endsWith("/status")) {
				polls += 1;
				const status = polls < 3 ? "in_progress" : "sent";
				return new Response(
					JSON.stringify({ jobId: "job-1", status }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const channel = new SmsRelayChannel();
		await channel.waitUntilSent("job-1", {
			pollIntervalMs: 10,
			timeoutMs: 5_000,
		});
		expect(polls).toBeGreaterThanOrEqual(3);
	});

	test("throws when phone reports failed", async () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});

		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					jobId: "job-fail",
					status: "failed",
					error: "RADIO_ERROR",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof fetch;

		const channel = new SmsRelayChannel();
		await expect(
			channel.waitUntilSent("job-fail", { pollIntervalMs: 10, timeoutMs: 1_000 }),
		).rejects.toThrow(/RADIO_ERROR/);
	});

	test("send alone does not imply delivered — waitUntilSent still required", async () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});

		let jobStatus: "pending" | "sent" = "pending";
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/v1/jobs") && init?.method === "POST") {
				return new Response(
					JSON.stringify({ jobId: "job-enqueue", status: "pending" }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/v1/jobs/job-enqueue")) {
				return new Response(
					JSON.stringify({ jobId: "job-enqueue", status: jobStatus }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const channel = new SmsRelayChannel();
		const result = await channel.send({
			to: "919876543210",
			body: "Hi",
			clientJobId: "a1",
		});
		expect(result.remoteJobId).toBe("job-enqueue");

		const pendingWait = channel.waitUntilSent("job-enqueue", {
			pollIntervalMs: 20,
			timeoutMs: 2_000,
		});
		await Bun.sleep(40);
		jobStatus = "sent";
		await pendingWait;
	});

	test("throws on timeout while still pending", async () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});

		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ jobId: "job-slow", status: "in_progress" }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof fetch;

		const channel = new SmsRelayChannel();
		await expect(
			channel.waitUntilSent("job-slow", {
				pollIntervalMs: 10,
				timeoutMs: 50,
			}),
		).rejects.toThrow(/timed out/);
	});

	test("aborts wait when AbortSignal fires", async () => {
		process.env.SMS_RELAY_BASE_URL = "https://relay.example.test";
		writeSmsRelayState({
			status: "paired",
			desktopToken: "tok",
			deviceId: "dev-1",
			relayBaseUrl: "https://relay.example.test",
		});

		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ jobId: "job-abort", status: "pending" }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof fetch;

		const ac = new AbortController();
		const channel = new SmsRelayChannel();
		const wait = channel.waitUntilSent("job-abort", {
			pollIntervalMs: 50,
			timeoutMs: 5_000,
			signal: ac.signal,
		});
		await Bun.sleep(20);
		ac.abort();
		await expect(wait).rejects.toThrow(/aborted/);
	});
});

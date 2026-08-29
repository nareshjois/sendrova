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

	test("send returns remoteJobId", async () => {
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

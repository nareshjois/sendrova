import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeRmSync } from "./test-fs";

function freshDataDir(prefix: string): string {
	const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

let dataDir = freshDataDir("sendrova-cap");
process.env.SENDROVA_DATA = dataDir;
process.env.SENDROVA_TEST = "1";
process.env.SENDROVA_SQLITE_JOURNAL = "DELETE";

const { closeDb, createCampaign, insertAttempt, openDb, setSetting } =
	await import("./db");
const {
	getLocalDayBounds,
	getRemainingToday,
	getSentToday,
	isCapHit,
	onLimitIncreased,
	setMaxMessagesPerDay,
	tryConsume,
} = await import("./daily-cap");

beforeEach(() => {
	closeDb();
	safeRmSync(dataDir);
	dataDir = freshDataDir("sendrova-cap");
	process.env.SENDROVA_DATA = dataDir;
	process.env.SENDROVA_TEST = "1";
	openDb();
});

afterEach(() => {
	closeDb();
	safeRmSync(dataDir);
});

describe("daily-cap", () => {
	test("day bounds span local midnight to next midnight", () => {
		const now = new Date(2026, 7, 29, 15, 30, 0); // Aug 29 2026 local
		const bounds = getLocalDayBounds(now);
		expect(new Date(bounds.startIso).getHours()).toBe(0);
		expect(new Date(bounds.nextMidnightIso).getTime()).toBe(
			new Date(bounds.endIso).getTime(),
		);
		expect(new Date(bounds.endIso).getTime()).toBeGreaterThan(
			new Date(bounds.startIso).getTime(),
		);
	});

	test("tryConsume reflects remaining vs sent attempts", () => {
		setSetting("max_messages_per_day", 2);
		expect(getSentToday()).toBe(0);
		expect(getRemainingToday()).toBe(2);
		expect(tryConsume()).toBe(true);
		expect(isCapHit()).toBe(false);

		const campaign = createCampaign({ name: "Cap" });
		const finishedAt = new Date().toISOString();
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "919800000001",
			fields: {},
			renderedBody: "a",
			status: "sent",
			finishedAt,
		});
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 1,
			phone: "919800000002",
			fields: {},
			renderedBody: "b",
			status: "sent",
			finishedAt,
		});

		expect(getSentToday()).toBe(2);
		expect(getRemainingToday()).toBe(0);
		expect(tryConsume()).toBe(false);
		expect(isCapHit()).toBe(true);
	});

	test("onLimitIncreased fires when cap rises", () => {
		setSetting("max_messages_per_day", 10);
		const seen: Array<[number, number]> = [];
		const off = onLimitIncreased((prev, next) => {
			seen.push([prev, next]);
		});

		setMaxMessagesPerDay(10); // no increase
		expect(seen).toHaveLength(0);

		setMaxMessagesPerDay(25);
		expect(seen).toEqual([[10, 25]]);

		setMaxMessagesPerDay(5); // decrease — no notify
		expect(seen).toHaveLength(1);

		off();
		setMaxMessagesPerDay(50);
		expect(seen).toHaveLength(1);
	});
});

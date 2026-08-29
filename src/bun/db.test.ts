import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = join(tmpdir(), `wa-sender-db-${crypto.randomUUID()}`);
process.env.WHATSAPP_SENDER_DATA = dataDir;

const {
	closeDb,
	countSentTodayLocal,
	createCampaign,
	deleteCampaign,
	duplicateCampaign,
	buildMergedContactRows,
	getAllSettings,
	getAttempts,
	getCampaign,
	getContacts,
	getDashboardStats,
	getSetting,
	insertAttempt,
	listCampaigns,
	listRecentFailures,
	openDb,
	setContacts,
	setSetting,
	updateAttempt,
	updateCampaign,
} = await import("./db");

beforeEach(() => {
	process.env.WHATSAPP_SENDER_DATA = dataDir;
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
	openDb();
});

afterEach(() => {
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("db", () => {
	test("creates campaign with defaults and lists it", () => {
		const campaign = createCampaign({ name: "Diwali blast" });
		expect(campaign.id).toBeTruthy();
		expect(campaign.name).toBe("Diwali blast");
		expect(campaign.status).toBe("draft");
		expect(campaign.template_text).toBe("");
		expect(campaign.media_kind).toBe("none");
		expect(listCampaigns().some((c) => c.id === campaign.id)).toBe(true);
	});

	test("setContacts merges and never drops sent phones", () => {
		const campaign = createCampaign({ name: "C1", templateText: "Hi {{name}}" });
		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "919876543210",
				phoneRaw: "+91 98765 43210",
				fields: { name: "Asha", phone: "919876543210" },
				valid: true,
			},
			{
				rowIndex: 1,
				phone: "",
				phoneRaw: "bad",
				fields: { name: "X" },
				valid: false,
				error: "invalid phone",
			},
		]);

		const contacts = getContacts(campaign.id);
		expect(contacts).toHaveLength(2);
		expect(contacts[0]?.valid).toBe(1);
		expect(contacts[1]?.valid).toBe(0);

		const updated = getCampaign(campaign.id)!;
		expect(updated.row_count).toBe(2);
		expect(updated.pending_count).toBe(1);

		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "919876543210",
			fields: { name: "Asha" },
			renderedBody: "Hi Asha",
			status: "sent",
			finishedAt: new Date().toISOString(),
		});

		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "918765432109",
				phoneRaw: "918765432109",
				fields: { name: "Ravi", phone: "918765432109" },
				valid: true,
			},
		]);

		const merged = getContacts(campaign.id);
		const phones = merged.map((c) => c.phone).sort();
		expect(phones).toContain("919876543210");
		expect(phones).toContain("918765432109");
		const after = getCampaign(campaign.id)!;
		expect(after.sent_count).toBe(1);
		expect(after.pending_count).toBe(1);
		// Stale invalid-without-phone rows are cleaned on merge
		expect(merged.every((c) => c.phone || c.valid === 1)).toBe(true);
	});

	test("dedupes across imports and keeps attempt stats", () => {
		const campaign = createCampaign({ name: "Dedup" });
		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "911111111111",
				phoneRaw: "911111111111",
				fields: { phone: "911111111111" },
				valid: true,
			},
		]);
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "911111111111",
			fields: {},
			renderedBody: "a",
			status: "sent",
			finishedAt: new Date().toISOString(),
		});
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 1,
			phone: "912222222222",
			fields: {},
			renderedBody: "b",
			status: "failed",
			error: "x",
			finishedAt: new Date().toISOString(),
		});
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 2,
			phone: "913333333333",
			fields: {},
			renderedBody: "c",
			status: "skipped",
			finishedAt: new Date().toISOString(),
		});

		const preview = buildMergedContactRows(campaign.id, [
			{
				rowIndex: 0,
				phone: "911111111111",
				phoneRaw: "911111111111",
				fields: { phone: "911111111111", name: "Again" },
				valid: true,
			},
			{
				rowIndex: 1,
				phone: "911111111111",
				phoneRaw: "911111111111",
				fields: { phone: "911111111111" },
				valid: true,
			},
			{
				rowIndex: 2,
				phone: "914444444444",
				phoneRaw: "914444444444",
				fields: { phone: "914444444444" },
				valid: true,
			},
		]);
		expect(preview.duplicateCount).toBe(2); // one across-import + one within-file
		expect(preview.newCount).toBe(1);

		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "914444444444",
				phoneRaw: "914444444444",
				fields: { phone: "914444444444" },
				valid: true,
			},
		]);
		const after = getCampaign(campaign.id)!;
		expect(after.sent_count).toBe(1);
		expect(after.failed_count).toBe(1);
		expect(after.skipped_count).toBe(1);
		expect(after.pending_count).toBe(1); // only the new number still pending
	});

	test("duplicateCampaign copies contacts without attempts", () => {
		const campaign = createCampaign({ name: "Original", templateText: "Hi" });
		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "919999999999",
				phoneRaw: "919999999999",
				fields: { phone: "919999999999" },
				valid: true,
			},
		]);
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "919999999999",
			fields: {},
			renderedBody: "Hi",
			status: "sent",
			finishedAt: new Date().toISOString(),
		});

		const copy = duplicateCampaign(campaign.id);
		expect(copy.name).toBe("Original (copy)");
		expect(copy.status).toBe("draft");
		expect(getContacts(copy.id)).toHaveLength(1);
		expect(getAttempts(copy.id)).toHaveLength(0);
		expect(getCampaign(copy.id)?.pending_count).toBe(1);
	});

	test("persists attempts and settings defaults", () => {
		const campaign = createCampaign({ name: "C2" });
		const attempt = insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "919876543210",
			fields: { name: "Asha" },
			renderedBody: "Hi Asha",
			status: "sending",
			startedAt: new Date().toISOString(),
		});
		updateAttempt(attempt.id, {
			status: "sent",
			finishedAt: new Date().toISOString(),
		});
		updateCampaign(campaign.id, {
			status: "completed",
			sentCount: 1,
			pendingCount: 0,
			finishedAt: new Date().toISOString(),
		});

		const attempts = getAttempts(campaign.id);
		expect(attempts).toHaveLength(1);
		expect(attempts[0]?.status).toBe("sent");
		expect(countSentTodayLocal()).toBe(1);

		const settings = getAllSettings();
		expect(settings.delay_min_ms).toBe(4000);
		expect(settings.max_messages_per_day).toBe(100);
		setSetting("max_messages_per_day", 50);
		expect(getSetting("max_messages_per_day")).toBe("50");
	});

	test("deleteCampaign cascades contacts", () => {
		const campaign = createCampaign({ name: "Gone" });
		setContacts(campaign.id, [
			{
				rowIndex: 0,
				phone: "911111111111",
				phoneRaw: "911111111111",
				fields: { phone: "911111111111" },
				valid: true,
			},
		]);
		expect(deleteCampaign(campaign.id)).toBe(true);
		expect(getCampaign(campaign.id)).toBeNull();
		expect(getContacts(campaign.id)).toHaveLength(0);
	});

	test("listRecentFailures and dashboard stats", () => {
		const campaign = createCampaign({ name: "Fail" });
		insertAttempt({
			campaignId: campaign.id,
			rowIndex: 0,
			phone: "911",
			fields: {},
			renderedBody: "x",
			status: "failed",
			error: "boom",
			finishedAt: new Date().toISOString(),
		});
		updateCampaign(campaign.id, {
			status: "paused",
			failedCount: 1,
			pendingCount: 0,
		});

		const failures = listRecentFailures(5);
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures[0]?.error).toBe("boom");

		const stats = getDashboardStats();
		expect(stats.campaignCount).toBeGreaterThanOrEqual(1);
		expect(stats.pausedCount).toBeGreaterThanOrEqual(1);
		expect(stats.totalFailed).toBeGreaterThanOrEqual(1);
	});
});

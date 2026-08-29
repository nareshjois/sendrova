import { Database } from "bun:sqlite";
import { getHistoryDbPath } from "./paths";

export type CampaignStatus =
	| "draft"
	| "running"
	| "paused"
	| "completed"
	| "stopped"
	| "interrupted"
	| "failed";

export type PausedReason = "user" | "daily_limit" | null;

export type MediaKind = "none" | "image" | "video";

export type MessageChannelKind = "whatsapp" | "sms";

export type AttemptStatus =
	| "pending"
	| "sending"
	| "sent"
	| "failed"
	| "skipped";

export type Campaign = {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
	status: CampaignStatus;
	paused_reason: PausedReason;
	channel: MessageChannelKind;
	template_text: string;
	media_path: string | null;
	media_kind: MediaKind;
	source_filename: string | null;
	row_count: number;
	sent_count: number;
	failed_count: number;
	skipped_count: number;
	pending_count: number;
};

export type Contact = {
	id: string;
	campaign_id: string;
	row_index: number;
	phone: string;
	phone_raw: string;
	fields_json: string;
	valid: number;
	error: string | null;
};

export type Attempt = {
	id: string;
	campaign_id: string;
	contact_id: string | null;
	row_index: number;
	phone: string;
	fields_json: string;
	rendered_body: string;
	media_kind: MediaKind;
	status: AttemptStatus;
	error: string | null;
	delay_before_ms: number | null;
	started_at: string | null;
	finished_at: string | null;
	/** SMS relay job id after enqueue (null for WhatsApp / pre-enqueue). */
	remote_job_id: string | null;
};

export type Settings = {
	delay_min_ms: number;
	delay_max_ms: number;
	extra_pause_chance: number;
	extra_pause_min_ms: number;
	extra_pause_max_ms: number;
	max_messages_per_day: number;
};

export type CreateCampaignInput = {
	name: string;
	templateText?: string;
	channel?: MessageChannelKind;
};

export type UpdateCampaignInput = Partial<{
	name: string;
	finishedAt: string | null;
	status: CampaignStatus;
	pausedReason: PausedReason;
	channel: MessageChannelKind;
	templateText: string;
	mediaPath: string | null;
	mediaKind: MediaKind;
	sourceFilename: string | null;
	rowCount: number;
	sentCount: number;
	failedCount: number;
	skippedCount: number;
	pendingCount: number;
}>;

export type ContactInput = {
	rowIndex: number;
	phone: string;
	phoneRaw: string;
	fields: Record<string, string>;
	valid: boolean;
	error?: string | null;
};

/** Per-row status shown in the campaign editor contact table */
export type DeliveryStatus =
	| "new"
	| "sent"
	| "failed"
	| "pending"
	| "invalid";

export type MergedContactRow = ContactInput & {
	deliveryStatus: DeliveryStatus;
};

export type InsertAttemptInput = {
	campaignId: string;
	contactId?: string | null;
	rowIndex: number;
	phone: string;
	fields: Record<string, string>;
	renderedBody: string;
	mediaKind?: MediaKind;
	status?: AttemptStatus;
	error?: string | null;
	delayBeforeMs?: number | null;
	startedAt?: string | null;
	finishedAt?: string | null;
};

export type UpdateAttemptInput = Partial<{
	status: AttemptStatus;
	error: string | null;
	delayBeforeMs: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	renderedBody: string;
	mediaKind: MediaKind;
	remoteJobId: string | null;
}>;

export type DashboardStats = {
	campaignCount: number;
	draftCount: number;
	runningCount: number;
	pausedCount: number;
	completedCount: number;
	totalSent: number;
	totalFailed: number;
	totalSkipped: number;
	totalPending: number;
	sentToday: number;
};

const SCHEMA_VERSION = 4;

const DEFAULT_SETTINGS: Settings = {
	delay_min_ms: 4000,
	delay_max_ms: 12000,
	extra_pause_chance: 0.1,
	extra_pause_min_ms: 20000,
	extra_pause_max_ms: 45000,
	max_messages_per_day: 100,
};

let db: Database | null = null;

function nowIso(): string {
	return new Date().toISOString();
}

function newId(): string {
	return crypto.randomUUID();
}

function createV2Schema(database: Database): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS campaigns (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			finished_at TEXT,
			status TEXT NOT NULL,
			paused_reason TEXT,
			channel TEXT NOT NULL DEFAULT 'whatsapp',
			template_text TEXT NOT NULL DEFAULT '',
			media_path TEXT,
			media_kind TEXT NOT NULL DEFAULT 'none',
			source_filename TEXT,
			row_count INTEGER NOT NULL DEFAULT 0,
			sent_count INTEGER NOT NULL DEFAULT 0,
			failed_count INTEGER NOT NULL DEFAULT 0,
			skipped_count INTEGER NOT NULL DEFAULT 0,
			pending_count INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS campaign_contacts (
			id TEXT PRIMARY KEY NOT NULL,
			campaign_id TEXT NOT NULL,
			row_index INTEGER NOT NULL,
			phone TEXT NOT NULL,
			phone_raw TEXT NOT NULL,
			fields_json TEXT NOT NULL,
			valid INTEGER NOT NULL DEFAULT 1,
			error TEXT,
			FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS attempts (
			id TEXT PRIMARY KEY NOT NULL,
			campaign_id TEXT NOT NULL,
			contact_id TEXT,
			row_index INTEGER NOT NULL,
			phone TEXT NOT NULL,
			fields_json TEXT NOT NULL,
			rendered_body TEXT NOT NULL,
			media_kind TEXT NOT NULL DEFAULT 'none',
			status TEXT NOT NULL,
			error TEXT,
			delay_before_ms INTEGER,
			started_at TEXT,
			finished_at TEXT,
			remote_job_id TEXT,
			FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_contacts_campaign
			ON campaign_contacts(campaign_id, row_index);
		CREATE INDEX IF NOT EXISTS idx_attempts_campaign
			ON attempts(campaign_id, row_index);
		CREATE INDEX IF NOT EXISTS idx_attempts_sent_finished
			ON attempts(status, finished_at);
	`);
}

/**
 * Schema migration via PRAGMA user_version.
 * - version 0: fresh DB, OR legacy history.ts DB that never set user_version
 * - version 1: reserved for an intermediate schema (rename → recreate)
 * - version 2: multi-campaign schema (pre-channel)
 * - version 3: campaigns.channel (whatsapp | sms)
 * - version 4: attempts.remote_job_id (SMS relay job id)
 *
 * Legacy path (version < 2 with an old `campaigns` table lacking `name`):
 * rename campaigns/attempts to *_old, then create v2+. Old rows are kept in
 * *_old tables but not auto-imported.
 */
function migrate(database: Database): void {
	const row = database.query<{ user_version: number }, []>(
		`PRAGMA user_version`,
	).get();
	const version = row?.user_version ?? 0;

	if (version < 2) {
		const tables = database
			.query<{ name: string }, []>(
				`SELECT name FROM sqlite_master WHERE type='table'`,
			)
			.all()
			.map((t) => t.name);

		const hasLegacyCampaigns =
			tables.includes("campaigns") && !campaignsHasNameColumn(database);

		if (version === 1 || hasLegacyCampaigns) {
			if (tables.includes("attempts") && !tables.includes("attempts_old")) {
				database.exec(`ALTER TABLE attempts RENAME TO attempts_old`);
			}
			if (tables.includes("campaigns") && !tables.includes("campaigns_old")) {
				database.exec(`ALTER TABLE campaigns RENAME TO campaigns_old`);
			}
		}

		createV2Schema(database);
	} else {
		createV2Schema(database);
	}

	ensureCampaignChannelColumn(database);
	ensureAttemptRemoteJobIdColumn(database);
	seedDefaultSettings(database);
	database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function ensureCampaignChannelColumn(database: Database): void {
	const cols = database
		.query<{ name: string }, []>(`PRAGMA table_info(campaigns)`)
		.all();
	if (cols.some((c) => c.name === "channel")) return;
	database.exec(
		`ALTER TABLE campaigns ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'`,
	);
}

function ensureAttemptRemoteJobIdColumn(database: Database): void {
	const cols = database
		.query<{ name: string }, []>(`PRAGMA table_info(attempts)`)
		.all();
	if (cols.some((c) => c.name === "remote_job_id")) return;
	database.exec(`ALTER TABLE attempts ADD COLUMN remote_job_id TEXT`);
}

function campaignsHasNameColumn(database: Database): boolean {
	try {
		const cols = database
			.query<{ name: string }, []>(`PRAGMA table_info(campaigns)`)
			.all();
		return cols.some((c) => c.name === "name");
	} catch {
		return false;
	}
}

function seedDefaultSettings(database: Database): void {
	const insert = database.prepare(
		`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
	);
	for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
		insert.run(key, String(value));
	}
}

/** Open (or reuse) the SQLite DB; runs migrations and marks interrupted runners. */
export function openDb(): Database {
	if (db) return db;

	const database = new Database(getHistoryDbPath(), { create: true });
	// WAL leaves -wal/-shm files that Windows often locks (EBUSY) during test cleanup.
	const useDeleteJournal =
		process.env.SENDROVA_TEST === "1" ||
		process.env.SENDROVA_SQLITE_JOURNAL?.trim().toUpperCase() === "DELETE";
	database.exec(
		useDeleteJournal
			? "PRAGMA journal_mode = DELETE;"
			: "PRAGMA journal_mode = WAL;",
	);
	database.exec("PRAGMA foreign_keys = ON;");
	migrate(database);
	markInterruptedRunning(database);
	db = database;
	return database;
}

/** Test helper: close and drop the cached connection */
export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

/** Mark any in-flight campaigns from a prior process as interrupted */
export function markInterruptedRunning(database: Database = openDb()): number {
	const result = database.run(
		`UPDATE campaigns
		 SET status = 'interrupted',
		     finished_at = COALESCE(finished_at, ?),
		     updated_at = ?,
		     paused_reason = NULL
		 WHERE status IN ('running', 'paused')`,
		[nowIso(), nowIso()],
	);
	return result.changes;
}

export function createCampaign(input: CreateCampaignInput): Campaign {
	const database = openDb();
	const id = newId();
	const ts = nowIso();
	const channel: MessageChannelKind =
		input.channel === "sms" ? "sms" : "whatsapp";

	database.run(
		`INSERT INTO campaigns (
			id, name, created_at, updated_at, finished_at, status, paused_reason,
			channel, template_text, media_path, media_kind, source_filename,
			row_count, sent_count, failed_count, skipped_count, pending_count
		) VALUES (?, ?, ?, ?, NULL, 'draft', NULL, ?, ?, NULL, 'none', NULL, 0, 0, 0, 0, 0)`,
		[id, input.name, ts, ts, channel, input.templateText ?? ""],
	);

	return getCampaign(id)!;
}

export function updateCampaign(
	id: string,
	patch: UpdateCampaignInput,
): Campaign | null {
	const database = openDb();
	const current = getCampaign(id);
	if (!current) return null;

	const next: Campaign = {
		...current,
		name: patch.name ?? current.name,
		finished_at:
			patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at,
		status: patch.status ?? current.status,
		paused_reason:
			patch.pausedReason !== undefined
				? patch.pausedReason
				: current.paused_reason,
		channel: patch.channel ?? current.channel,
		template_text: patch.templateText ?? current.template_text,
		media_path:
			patch.mediaPath !== undefined ? patch.mediaPath : current.media_path,
		media_kind: patch.mediaKind ?? current.media_kind,
		source_filename:
			patch.sourceFilename !== undefined
				? patch.sourceFilename
				: current.source_filename,
		row_count: patch.rowCount ?? current.row_count,
		sent_count: patch.sentCount ?? current.sent_count,
		failed_count: patch.failedCount ?? current.failed_count,
		skipped_count: patch.skippedCount ?? current.skipped_count,
		pending_count: patch.pendingCount ?? current.pending_count,
		updated_at: nowIso(),
	};

	database.run(
		`UPDATE campaigns SET
			name = ?,
			updated_at = ?,
			finished_at = ?,
			status = ?,
			paused_reason = ?,
			channel = ?,
			template_text = ?,
			media_path = ?,
			media_kind = ?,
			source_filename = ?,
			row_count = ?,
			sent_count = ?,
			failed_count = ?,
			skipped_count = ?,
			pending_count = ?
		 WHERE id = ?`,
		[
			next.name,
			next.updated_at,
			next.finished_at,
			next.status,
			next.paused_reason,
			next.channel,
			next.template_text,
			next.media_path,
			next.media_kind,
			next.source_filename,
			next.row_count,
			next.sent_count,
			next.failed_count,
			next.skipped_count,
			next.pending_count,
			id,
		],
	);

	return getCampaign(id);
}

export function deleteCampaign(id: string): boolean {
	const database = openDb();
	const result = database.run(`DELETE FROM campaigns WHERE id = ?`, [id]);
	return result.changes > 0;
}

export function getCampaign(id: string): Campaign | null {
	const database = openDb();
	return (
		database
			.query<Campaign, [string]>(`SELECT * FROM campaigns WHERE id = ?`)
			.get(id) ?? null
	);
}

export function listCampaigns(): Campaign[] {
	const database = openDb();
	return database
		.query<Campaign, []>(
			`SELECT * FROM campaigns ORDER BY created_at DESC`,
		)
		.all();
}

export function setContacts(
	campaignId: string,
	contacts: ContactInput[],
): Contact[] {
	return mergeContacts(campaignId, contacts);
}

function contactKey(phone: string, phoneRaw: string): string {
	return phone || `raw:${phoneRaw}`;
}

/** Latest delivery outcome per phone from attempt history */
export function getDeliveryStatusMap(
	campaignId: string,
): Map<string, DeliveryStatus> {
	const map = new Map<string, DeliveryStatus>();
	for (const attempt of getAttempts(campaignId)) {
		if (!attempt.phone) continue;
		const prev = map.get(attempt.phone);
		if (attempt.status === "sent") {
			map.set(attempt.phone, "sent");
			continue;
		}
		if (prev === "sent") continue;
		if (attempt.status === "failed") {
			map.set(attempt.phone, "failed");
			continue;
		}
		if (!prev) map.set(attempt.phone, "pending");
	}
	return map;
}

/**
 * Campaign counters from attempt history + current contacts.
 * Never invents zeros that wipe historical send/fail/skip totals.
 */
export function computeCampaignCounts(
	campaignId: string,
	contactRows: Array<{ phone: string; valid: boolean }>,
): {
	rowCount: number;
	sentCount: number;
	failedCount: number;
	skippedCount: number;
	pendingCount: number;
} {
	const attempts = getAttempts(campaignId);
	const sentCount = attempts.filter((a) => a.status === "sent").length;
	const failedCount = attempts.filter((a) => a.status === "failed").length;
	const skippedCount = attempts.filter((a) => a.status === "skipped").length;

	const sentPhones = new Set(
		attempts.filter((a) => a.status === "sent" && a.phone).map((a) => a.phone),
	);
	let pendingCount = 0;
	for (const c of contactRows) {
		if (!c.valid || !c.phone) continue;
		if (!sentPhones.has(c.phone)) pendingCount += 1;
	}

	return {
		rowCount: contactRows.length,
		sentCount,
		failedCount,
		skippedCount,
		pendingCount,
	};
}

function deliveryForPhone(
	phone: string,
	valid: boolean,
	deliveryMap: Map<string, DeliveryStatus>,
	isNewlyImported: boolean,
): DeliveryStatus {
	if (!valid || !phone) return "invalid";
	const fromHistory = deliveryMap.get(phone);
	if (fromHistory === "sent") return "sent";
	if (fromHistory === "failed") return "failed";
	if (isNewlyImported) return "new";
	return "pending";
}

/**
 * Build the merged contact list without writing:
 * keeps existing valid contacts (and anything already sent), upserts imports,
 * dedupes within and across imports, re-attaches sent phones missing from the table.
 */
export function buildMergedContactRows(
	campaignId: string,
	imported: ContactInput[],
): {
	rows: MergedContactRow[];
	newCount: number;
	alreadySentCount: number;
	invalidCount: number;
	duplicateCount: number;
} {
	const existing = getContacts(campaignId);
	const deliveryMap = getDeliveryStatusMap(campaignId);
	const byKey = new Map<string, ContactInput>();
	const existingKeys = new Set<string>();

	for (const c of existing) {
		const key = contactKey(c.phone, c.phone_raw);
		// Drop stale invalid rows (no phone) — re-added only if present in this import
		if (c.valid !== 1 && !c.phone) continue;
		existingKeys.add(key);
		let fields: Record<string, string> = {};
		try {
			fields = JSON.parse(c.fields_json) as Record<string, string>;
		} catch {
			fields = {};
		}
		byKey.set(key, {
			rowIndex: c.row_index,
			phone: c.phone,
			phoneRaw: c.phone_raw,
			fields,
			valid: c.valid === 1,
			error: c.error,
		});
	}

	const importSeen = new Set<string>();
	let duplicateCount = 0;
	const newlyImportedKeys = new Set<string>();

	for (const row of imported) {
		const key = contactKey(row.phone, row.phoneRaw);

		// Dedupe within this import file
		if (importSeen.has(key)) {
			duplicateCount += 1;
			continue;
		}
		importSeen.add(key);

		if (row.valid && row.phone) {
			if (existingKeys.has(key)) {
				// Already on the campaign from a prior import — upsert fields, not "new"
				duplicateCount += 1;
			} else {
				newlyImportedKeys.add(key);
			}
		}

		byKey.set(key, {
			rowIndex: 0,
			phone: row.phone,
			phoneRaw: row.phoneRaw,
			fields: row.fields,
			valid: row.valid,
			error: row.error ?? null,
		});
	}

	// Never drop phones we already successfully messaged
	for (const [phone, status] of deliveryMap) {
		if (status !== "sent") continue;
		if (byKey.has(phone)) continue;
		byKey.set(phone, {
			rowIndex: 0,
			phone,
			phoneRaw: phone,
			fields: { phone },
			valid: true,
			error: null,
		});
	}

	const rows: MergedContactRow[] = [];
	let newCount = 0;
	let alreadySentCount = 0;
	let invalidCount = 0;
	let index = 0;

	for (const [key, row] of byKey) {
		const deliveryStatus = deliveryForPhone(
			row.phone,
			row.valid,
			deliveryMap,
			newlyImportedKeys.has(key),
		);
		if (deliveryStatus === "new") newCount += 1;
		if (deliveryStatus === "sent") alreadySentCount += 1;
		if (deliveryStatus === "invalid") invalidCount += 1;
		rows.push({
			...row,
			rowIndex: index,
			deliveryStatus,
		});
		index += 1;
	}

	return { rows, newCount, alreadySentCount, invalidCount, duplicateCount };
}

/**
 * Merge imported contacts into a campaign: never removes previously sent
 * numbers; upserts imported phones; recounts stats from attempt history.
 */
export function mergeContacts(
	campaignId: string,
	imported: ContactInput[],
): Contact[] {
	const database = openDb();
	const campaign = getCampaign(campaignId);
	if (!campaign) {
		throw new Error(`Campaign not found: ${campaignId}`);
	}

	const { rows } = buildMergedContactRows(campaignId, imported);

	const write = database.transaction(() => {
		database.run(`DELETE FROM campaign_contacts WHERE campaign_id = ?`, [
			campaignId,
		]);

		const insert = database.prepare(
			`INSERT INTO campaign_contacts (
				id, campaign_id, row_index, phone, phone_raw, fields_json, valid, error
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		for (const c of rows) {
			insert.run(
				newId(),
				campaignId,
				c.rowIndex,
				c.phone,
				c.phoneRaw,
				JSON.stringify(c.fields),
				c.valid ? 1 : 0,
				c.error ?? null,
			);
		}

		const counts = computeCampaignCounts(
			campaignId,
			rows.map((r) => ({ phone: r.phone, valid: r.valid })),
		);

		const terminal = ["completed", "stopped", "interrupted", "failed"] as const;
		const shouldReopen =
			counts.pendingCount > 0 &&
			(terminal as readonly string[]).includes(campaign.status);

		updateCampaign(campaignId, {
			rowCount: counts.rowCount,
			sentCount: counts.sentCount,
			failedCount: counts.failedCount,
			skippedCount: counts.skippedCount,
			pendingCount: counts.pendingCount,
			sourceFilename: campaign.source_filename,
			...(shouldReopen
				? { status: "draft" as const, finishedAt: null, pausedReason: null }
				: {}),
		});
	});

	write();
	return getContacts(campaignId);
}

/** Clone campaign metadata, contacts, and media into a new draft (no attempts). */
export function duplicateCampaign(sourceId: string): Campaign {
	const source = getCampaign(sourceId);
	if (!source) {
		throw new Error(`Campaign not found: ${sourceId}`);
	}

	const copy = createCampaign({
		name: `${source.name} (copy)`,
		templateText: source.template_text,
		channel: source.channel === "sms" ? "sms" : "whatsapp",
	});

	const contacts = getContacts(sourceId);
	if (contacts.length > 0) {
		mergeContacts(
			copy.id,
			contacts.map((c, i) => {
				let fields: Record<string, string> = {};
				try {
					fields = JSON.parse(c.fields_json) as Record<string, string>;
				} catch {
					fields = {};
				}
				return {
					rowIndex: i,
					phone: c.phone,
					phoneRaw: c.phone_raw,
					fields,
					valid: c.valid === 1,
					error: c.error,
				};
			}),
		);
	}

	return getCampaign(copy.id)!;
}

export function getContacts(campaignId: string): Contact[] {
	const database = openDb();
	return database
		.query<Contact, [string]>(
			`SELECT * FROM campaign_contacts
			 WHERE campaign_id = ?
			 ORDER BY row_index ASC`,
		)
		.all(campaignId);
}

export function insertAttempt(input: InsertAttemptInput): Attempt {
	const database = openDb();
	const id = newId();

	database.run(
		`INSERT INTO attempts (
			id, campaign_id, contact_id, row_index, phone, fields_json, rendered_body,
			media_kind, status, error, delay_before_ms, started_at, finished_at, remote_job_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		[
			id,
			input.campaignId,
			input.contactId ?? null,
			input.rowIndex,
			input.phone,
			JSON.stringify(input.fields),
			input.renderedBody,
			input.mediaKind ?? "none",
			input.status ?? "pending",
			input.error ?? null,
			input.delayBeforeMs ?? null,
			input.startedAt ?? null,
			input.finishedAt ?? null,
		],
	);

	return getAttempt(id)!;
}

export function updateAttempt(
	id: string,
	patch: UpdateAttemptInput,
): Attempt | null {
	const database = openDb();
	const current = getAttempt(id);
	if (!current) return null;

	const next: Attempt = {
		...current,
		status: patch.status ?? current.status,
		error: patch.error !== undefined ? patch.error : current.error,
		delay_before_ms:
			patch.delayBeforeMs !== undefined
				? patch.delayBeforeMs
				: current.delay_before_ms,
		started_at:
			patch.startedAt !== undefined ? patch.startedAt : current.started_at,
		finished_at:
			patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at,
		rendered_body: patch.renderedBody ?? current.rendered_body,
		media_kind: patch.mediaKind ?? current.media_kind,
		remote_job_id:
			patch.remoteJobId !== undefined
				? patch.remoteJobId
				: current.remote_job_id,
	};

	database.run(
		`UPDATE attempts SET
			status = ?,
			error = ?,
			delay_before_ms = ?,
			started_at = ?,
			finished_at = ?,
			rendered_body = ?,
			media_kind = ?,
			remote_job_id = ?
		 WHERE id = ?`,
		[
			next.status,
			next.error,
			next.delay_before_ms,
			next.started_at,
			next.finished_at,
			next.rendered_body,
			next.media_kind,
			next.remote_job_id,
			id,
		],
	);

	return getAttempt(id);
}

function getAttempt(id: string): Attempt | null {
	const database = openDb();
	return (
		database
			.query<Attempt, [string]>(`SELECT * FROM attempts WHERE id = ?`)
			.get(id) ?? null
	);
}

export function getAttempts(campaignId: string): Attempt[] {
	const database = openDb();
	return database
		.query<Attempt, [string]>(
			`SELECT * FROM attempts WHERE campaign_id = ? ORDER BY row_index ASC`,
		)
		.all(campaignId);
}

/**
 * Latest in-flight SMS attempt per phone that already has a relay job id.
 * Used to resume waitUntilSent after mid-flight stop instead of re-enqueueing.
 */
export function getOpenRemoteJobAttempts(
	campaignId: string,
): Map<string, Attempt> {
	const byPhone = new Map<string, Attempt>();
	for (const attempt of getAttempts(campaignId)) {
		if (!attempt.remote_job_id) continue;
		const resumable =
			attempt.status === "sending" ||
			(attempt.status === "failed" &&
				/stopped while waiting for SMS ack/i.test(attempt.error ?? ""));
		if (!resumable) continue;
		byPhone.set(attempt.phone, attempt);
	}
	return byPhone;
}

export function getSetting(key: keyof Settings): string {
	const database = openDb();
	const row = database
		.query<{ value: string }, [string]>(
			`SELECT value FROM settings WHERE key = ?`,
		)
		.get(key);
	if (row) return row.value;
	return String(DEFAULT_SETTINGS[key]);
}

export function setSetting(key: keyof Settings, value: string | number): void {
	const database = openDb();
	database.run(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, String(value)],
	);
}

export function getAllSettings(): Settings {
	openDb();
	return {
		delay_min_ms: Number(getSetting("delay_min_ms")),
		delay_max_ms: Number(getSetting("delay_max_ms")),
		extra_pause_chance: Number(getSetting("extra_pause_chance")),
		extra_pause_min_ms: Number(getSetting("extra_pause_min_ms")),
		extra_pause_max_ms: Number(getSetting("extra_pause_max_ms")),
		max_messages_per_day: Number(getSetting("max_messages_per_day")),
	};
}

/**
 * Count attempts with status=sent whose finished_at falls in the local calendar day
 * [local midnight, next midnight).
 */
export function countSentTodayLocal(
	now: Date = new Date(),
): number {
	const { startIso, endIso } = localDayBounds(now);
	const database = openDb();
	const row = database
		.query<{ n: number }, [string, string]>(
			`SELECT COUNT(*) AS n FROM attempts
			 WHERE status = 'sent'
			   AND finished_at IS NOT NULL
			   AND finished_at >= ?
			   AND finished_at < ?`,
		)
		.get(startIso, endIso);
	return row?.n ?? 0;
}

/** Local-day ISO bounds (exported for daily-cap). */
export function localDayBounds(now: Date = new Date()): {
	startIso: string;
	endIso: string;
	nextMidnightIso: string;
} {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return {
		startIso: start.toISOString(),
		endIso: end.toISOString(),
		nextMidnightIso: end.toISOString(),
	};
}

export function listRecentFailures(limit = 10): Attempt[] {
	const database = openDb();
	return database
		.query<Attempt, [number]>(
			`SELECT * FROM attempts
			 WHERE status = 'failed'
			 ORDER BY COALESCE(finished_at, started_at) DESC
			 LIMIT ?`,
		)
		.all(limit);
}

export function getDashboardStats(): DashboardStats {
	const database = openDb();
	const campaigns = listCampaigns();

	let draftCount = 0;
	let runningCount = 0;
	let pausedCount = 0;
	let completedCount = 0;
	let totalSent = 0;
	let totalFailed = 0;
	let totalSkipped = 0;
	let totalPending = 0;

	for (const c of campaigns) {
		if (c.status === "draft") draftCount += 1;
		if (c.status === "running") runningCount += 1;
		if (c.status === "paused") pausedCount += 1;
		if (c.status === "completed") completedCount += 1;
		totalSent += c.sent_count;
		totalFailed += c.failed_count;
		totalSkipped += c.skipped_count;
		totalPending += c.pending_count;
	}

	return {
		campaignCount: campaigns.length,
		draftCount,
		runningCount,
		pausedCount,
		completedCount,
		totalSent,
		totalFailed,
		totalSkipped,
		totalPending,
		sentToday: countSentTodayLocal(),
	};
}

function csvEscape(value: string): string {
	if (/[",\n\r]/.test(value)) {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return value;
}

/** Export a campaign's attempts as CSV */
export function exportCampaignCsv(id: string): string {
	const campaign = getCampaign(id);
	if (!campaign) {
		throw new Error(`Campaign not found: ${id}`);
	}

	const attempts = getAttempts(id);
	const header = [
		"row_index",
		"phone",
		"status",
		"error",
		"delay_before_ms",
		"started_at",
		"finished_at",
		"rendered_body",
		"media_kind",
		"fields_json",
	];

	const lines = [header.join(",")];
	for (const attempt of attempts) {
		lines.push(
			[
				String(attempt.row_index),
				csvEscape(attempt.phone),
				csvEscape(attempt.status),
				csvEscape(attempt.error ?? ""),
				attempt.delay_before_ms == null ? "" : String(attempt.delay_before_ms),
				csvEscape(attempt.started_at ?? ""),
				csvEscape(attempt.finished_at ?? ""),
				csvEscape(attempt.rendered_body),
				csvEscape(attempt.media_kind),
				csvEscape(attempt.fields_json),
			].join(","),
		);
	}

	return `${lines.join("\n")}\n`;
}

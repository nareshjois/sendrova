import {
	getAllSettings,
	getAttempts,
	getCampaign,
	getContacts,
	getOpenRemoteJobAttempts,
	insertAttempt,
	listCampaigns,
	updateAttempt,
	updateCampaign,
	type Attempt,
	type AttemptStatus,
	type CampaignStatus,
	type Contact,
	type MediaKind,
	type MessageChannelKind,
	type PausedReason,
} from "./db";
import {
	getLocalDayBounds,
	isCapHit,
	onLimitIncreased,
	tryConsume,
} from "./daily-cap";
import { renderTemplate } from "./template";
import {
	getMessageChannel,
	WhatsAppNotOnNetworkError,
} from "./channels";

export type CampaignProgress = {
	campaignId: string;
	status: CampaignStatus;
	pausedReason?: PausedReason;
	rowIndex: number;
	total: number;
	sent: number;
	failed: number;
	skipped: number;
	pending: number;
	currentPhone?: string;
	lastError?: string;
	nextDelayMs?: number;
	countdownRemainingMs?: number;
	countdownSeconds?: number;
	rowStatuses?: Record<string, AttemptStatus>;
};

export type ProgressListener = (progress: CampaignProgress) => void;

type RunnerState = {
	campaignId: string;
	paused: boolean;
	pausedReason: PausedReason;
	stopped: boolean;
	running: boolean;
	sent: number;
	failed: number;
	skipped: number;
	pending: number;
	total: number;
	rowIndex: number;
	lastError?: string;
	currentPhone?: string;
	nextDelayMs?: number;
	countdownRemainingMs?: number;
	rowStatuses: Record<string, AttemptStatus>;
	waitResolve: (() => void) | null;
};

const runners = new Map<string, RunnerState>();
const progressListeners = new Set<ProgressListener>();

// Resume campaigns paused for daily limit when the cap is raised.
onLimitIncreased(() => {
	resumeAllPausedByDailyLimit();
});

export function onProgress(listener: ProgressListener): () => void {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

function emitProgress(state: RunnerState, status: CampaignStatus): void {
	const countdownRemainingMs = state.countdownRemainingMs;
	const progress: CampaignProgress = {
		campaignId: state.campaignId,
		status,
		pausedReason: state.pausedReason,
		rowIndex: state.rowIndex,
		total: state.total,
		sent: state.sent,
		failed: state.failed,
		skipped: state.skipped,
		pending: state.pending,
		currentPhone: state.currentPhone,
		lastError: state.lastError,
		nextDelayMs: state.nextDelayMs,
		countdownRemainingMs,
		countdownSeconds:
			countdownRemainingMs == null
				? undefined
				: Math.ceil(countdownRemainingMs / 1000),
		rowStatuses: { ...state.rowStatuses },
	};
	for (const listener of progressListeners) {
		try {
			listener(progress);
		} catch (err) {
			console.error("[scheduler] onProgress error", err);
		}
	}
}

function clampDelay(min: number, max: number): { min: number; max: number } {
	const lo = Math.max(0, Math.min(min, max));
	const hi = Math.max(lo, Math.max(min, max));
	return { min: lo, max: hi };
}

function randomUniform(minMs: number, maxMs: number): number {
	const { min, max } = clampDelay(minMs, maxMs);
	if (min === max) return min;
	return Math.floor(min + Math.random() * (max - min + 1));
}

function computeDelayFromSettings(): number {
	const s = getAllSettings();
	let delay = randomUniform(s.delay_min_ms, s.delay_max_ms);
	const chance = Math.max(0, Math.min(1, s.extra_pause_chance));
	if (chance > 0 && Math.random() < chance) {
		delay += randomUniform(s.extra_pause_min_ms, s.extra_pause_max_ms);
	}
	return delay;
}

function wakeWaiter(state: RunnerState): void {
	const resolve = state.waitResolve;
	state.waitResolve = null;
	resolve?.();
}

async function waitWhilePaused(state: RunnerState): Promise<void> {
	while (state.paused && !state.stopped) {
		await new Promise<void>((resolve) => {
			state.waitResolve = resolve;
		});
	}
}

async function interruptibleSleep(
	state: RunnerState,
	totalMs: number,
): Promise<"ok" | "stopped"> {
	if (totalMs <= 0) {
		state.nextDelayMs = 0;
		state.countdownRemainingMs = 0;
		emitProgress(state, state.paused ? "paused" : "running");
		return state.stopped ? "stopped" : "ok";
	}

	state.nextDelayMs = totalMs;
	let remaining = totalMs;

	while (true) {
		if (state.stopped) return "stopped";
		await waitWhilePaused(state);
		if (state.stopped) return "stopped";

		state.countdownRemainingMs = remaining;
		emitProgress(state, "running");

		if (remaining <= 0) {
			state.countdownRemainingMs = 0;
			return "ok";
		}

		const slice = Math.min(1000, remaining);
		const started = Date.now();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				state.waitResolve = null;
				resolve();
			}, slice);
			state.waitResolve = () => {
				clearTimeout(timer);
				resolve();
			};
		});

		if (state.stopped) return "stopped";
		if (state.paused) {
			emitProgress(state, "paused");
			continue;
		}

		remaining = Math.max(0, remaining - (Date.now() - started));
	}
}

function syncCampaignCounts(
	state: RunnerState,
	status: CampaignStatus,
	finished = false,
): void {
	updateCampaign(state.campaignId, {
		status,
		pausedReason: status === "paused" ? state.pausedReason : null,
		sentCount: state.sent,
		failedCount: state.failed,
		skippedCount: state.skipped,
		pendingCount: state.pending,
		finishedAt: finished ? new Date().toISOString() : null,
	});
}

function alreadySentPhones(campaignId: string): Set<string> {
	const sent = new Set<string>();
	for (const attempt of getAttempts(campaignId)) {
		if (attempt.status === "sent") sent.add(attempt.phone);
	}
	return sent;
}

function normalizeChannel(channel: string | null | undefined): MessageChannelKind {
	return channel === "sms" ? "sms" : "whatsapp";
}

/**
 * Start (or resume from draft/paused/interrupted) a campaign runner.
 * Multiple campaigns may run in parallel.
 */
export async function startCampaign(campaignId: string): Promise<void> {
	const existing = runners.get(campaignId);
	if (existing?.running && !existing.stopped) {
		throw new Error(`Campaign ${campaignId} is already running`);
	}

	const campaign = getCampaign(campaignId);
	if (!campaign) {
		throw new Error(`Campaign not found: ${campaignId}`);
	}

	const channelKind = normalizeChannel(campaign.channel);
	const channel = getMessageChannel(channelKind);
	if (!(await channel.isReady())) {
		throw new Error(
			channelKind === "sms"
				? "SMS phone gateway is not ready (pair a phone or use mock mode)"
				: "WhatsApp is not connected",
		);
	}

	const contacts = getContacts(campaignId).filter((c) => c.valid === 1 && c.phone);
	const sentPhones = alreadySentPhones(campaignId);
	const pendingContacts = contacts.filter((c) => !sentPhones.has(c.phone));
	const openRemoteJobs = getOpenRemoteJobAttempts(campaignId);

	const rowStatuses: Record<string, AttemptStatus> = {};
	for (const c of contacts) {
		rowStatuses[c.phone] = sentPhones.has(c.phone) ? "sent" : "pending";
	}

	const sent = contacts.length - pendingContacts.length;
	const state: RunnerState = {
		campaignId,
		paused: false,
		pausedReason: null,
		stopped: false,
		running: true,
		sent,
		failed: campaign.failed_count,
		skipped: campaign.skipped_count,
		pending: pendingContacts.length,
		total: contacts.length,
		rowIndex: -1,
		rowStatuses,
		waitResolve: null,
	};

	runners.set(campaignId, state);
	updateCampaign(campaignId, {
		status: "running",
		pausedReason: null,
		finishedAt: null,
		sentCount: state.sent,
		pendingCount: state.pending,
	});
	emitProgress(state, "running");

	void runCampaign(
		state,
		pendingContacts,
		campaign.template_text,
		{
			mediaKind: channelKind === "sms" ? "none" : campaign.media_kind,
			mediaPath: channelKind === "sms" ? null : campaign.media_path,
			channelKind,
		},
		openRemoteJobs,
	).catch((err) => {
		console.error("[scheduler] campaign crashed", campaignId, err);
		state.lastError = err instanceof Error ? err.message : String(err);
		syncCampaignCounts(state, "failed", true);
		emitProgress(state, "failed");
		state.running = false;
	});
}

async function runCampaign(
	state: RunnerState,
	contacts: Contact[],
	template: string,
	media: {
		mediaKind: MediaKind;
		mediaPath: string | null;
		channelKind: MessageChannelKind;
	},
	openRemoteJobs: Map<string, Attempt> = new Map(),
): Promise<void> {
	const channel = getMessageChannel(media.channelKind);
	try {
		for (let i = 0; i < contacts.length; i++) {
			if (state.stopped) break;

			await waitWhilePaused(state);
			if (state.stopped) break;

			const contact = contacts[i]!;
			state.rowIndex = contact.row_index;
			state.currentPhone = contact.phone;
			state.lastError = undefined;

			const delayBeforeMs = i === 0 ? 0 : computeDelayFromSettings();
			if (delayBeforeMs > 0) {
				const waitResult = await interruptibleSleep(state, delayBeforeMs);
				if (waitResult === "stopped") break;
			}

			await waitWhilePaused(state);
			if (state.stopped) break;

			if (!tryConsume()) {
				pauseAllForDailyLimit();
				break;
			}

			let fields: Record<string, string> = {};
			try {
				fields = JSON.parse(contact.fields_json) as Record<string, string>;
			} catch {
				fields = { phone: contact.phone, phone_raw: contact.phone_raw };
			}

			const rendered = renderTemplate(template, fields);
			const startedAt = new Date().toISOString();
			state.rowStatuses[contact.phone] = "sending";

			// Resume mid-flight SMS: wait on the existing relay job instead of
			// inserting a new attempt (which would mint a new clientJobId).
			const open = openRemoteJobs.get(contact.phone);
			if (
				media.channelKind === "sms" &&
				open?.remote_job_id &&
				channel.waitUntilSent
			) {
				emitProgress(state, "running");
				try {
					if (isCapHit()) {
						updateAttempt(open.id, {
							status: "sending",
							error: "daily limit reached",
							finishedAt: null,
						});
						state.rowStatuses[contact.phone] = "pending";
						pauseAllForDailyLimit();
						break;
					}
					await waitForSmsAck(state, channel, open.remote_job_id);
					updateAttempt(open.id, {
						status: "sent",
						error: null,
						finishedAt: new Date().toISOString(),
						remoteJobId: open.remote_job_id,
					});
					state.rowStatuses[contact.phone] = "sent";
					state.sent += 1;
					state.pending = Math.max(0, state.pending - 1);
					syncCampaignCounts(state, "running");
					emitProgress(state, "running");
					openRemoteJobs.delete(contact.phone);
					if (state.stopped) break;
				} catch (err) {
					await handleSendError(state, open, err);
					if (state.stopped) break;
				}
				continue;
			}

			const attempt = insertAttempt({
				campaignId: state.campaignId,
				contactId: contact.id,
				rowIndex: contact.row_index,
				phone: contact.phone,
				fields,
				renderedBody: rendered,
				mediaKind: media.mediaKind,
				status: "sending",
				delayBeforeMs,
				startedAt,
			});

			emitProgress(state, "running");

			let remoteJobId: string | undefined;
			try {
				// Re-check cap immediately before send (another runner may have consumed).
				if (isCapHit()) {
					updateAttempt(attempt.id, {
						status: "pending",
						error: "daily limit reached",
						finishedAt: new Date().toISOString(),
					});
					state.rowStatuses[contact.phone] = "pending";
					pauseAllForDailyLimit();
					break;
				}

				const result = await channel.send({
					to: contact.phone,
					body: rendered,
					mediaKind: media.mediaKind,
					mediaPath: media.mediaPath,
					clientJobId: attempt.id,
				});

				remoteJobId = result.remoteJobId;
				if (remoteJobId) {
					updateAttempt(attempt.id, { remoteJobId });
				}

				// SMS: enqueue is not delivery — wait for phone ack before marking sent.
				// Stop aborts the wait (catch below). If wait resolves, the phone already
				// acked — always mark sent (never fail a successful ack if stop races in).
				if (remoteJobId && channel.waitUntilSent) {
					await waitForSmsAck(state, channel, remoteJobId);
				}

				updateAttempt(attempt.id, {
					status: "sent",
					error: null,
					finishedAt: new Date().toISOString(),
					remoteJobId: remoteJobId ?? null,
				});
				state.rowStatuses[contact.phone] = "sent";
				state.sent += 1;
				state.pending = Math.max(0, state.pending - 1);
				syncCampaignCounts(state, "running");
				emitProgress(state, "running");
				if (state.stopped) break;
			} catch (err) {
				await handleSendError(state, attempt, err, remoteJobId);
				if (state.stopped) break;
			}
		}

		if (state.stopped) {
			syncCampaignCounts(state, "stopped", true);
			emitProgress(state, "stopped");
		} else if (state.paused && state.pausedReason === "daily_limit") {
			syncCampaignCounts(state, "paused");
			emitProgress(state, "paused");
		} else if (state.paused) {
			syncCampaignCounts(state, "paused");
			emitProgress(state, "paused");
		} else {
			syncCampaignCounts(state, "completed", true);
			emitProgress(state, "completed");
		}
	} finally {
		state.running = false;
		state.waitResolve = null;
		// Keep state in map briefly for getProgress; drop when finished terminal.
		const terminal =
			!state.paused &&
			(state.stopped ||
				getCampaign(state.campaignId)?.status === "completed" ||
				getCampaign(state.campaignId)?.status === "failed" ||
				getCampaign(state.campaignId)?.status === "stopped");
		if (terminal) {
			runners.delete(state.campaignId);
		}
	}
}

async function waitForSmsAck(
	state: RunnerState,
	channel: ReturnType<typeof getMessageChannel>,
	remoteJobId: string,
): Promise<void> {
	if (!channel.waitUntilSent) return;
	const ac = new AbortController();
	const stopPoll = setInterval(() => {
		if (state.stopped) ac.abort();
	}, 250);
	try {
		await channel.waitUntilSent(remoteJobId, {
			signal: ac.signal,
		});
	} finally {
		clearInterval(stopPoll);
	}
}

async function handleSendError(
	state: RunnerState,
	attempt: Attempt,
	err: unknown,
	remoteJobId?: string,
): Promise<void> {
	if (err instanceof WhatsAppNotOnNetworkError) {
		updateAttempt(attempt.id, {
			status: "skipped",
			error: "not on WhatsApp",
			finishedAt: new Date().toISOString(),
		});
		state.rowStatuses[attempt.phone] = "skipped";
		state.skipped += 1;
		state.pending = Math.max(0, state.pending - 1);
		syncCampaignCounts(state, "running");
		emitProgress(state, "running");
		return;
	}

	const raw = err instanceof Error ? err.message : String(err);
	const abortedStop = state.stopped && /aborted/i.test(raw);
	const jobId = remoteJobId ?? attempt.remote_job_id ?? undefined;

	// Mid-flight stop after enqueue: keep attempt as sending with remoteJobId so
	// resume can waitUntilSent (relay clientJobId idempotency) instead of failing
	// and minting a duplicate SMS on the next start.
	if (abortedStop && jobId) {
		updateAttempt(attempt.id, {
			status: "sending",
			error: "campaign stopped while waiting for SMS ack",
			finishedAt: null,
			remoteJobId: jobId,
		});
		state.rowStatuses[attempt.phone] = "pending";
		state.lastError = "campaign stopped while waiting for SMS ack";
		emitProgress(state, "running");
		return;
	}

	const message = abortedStop
		? "campaign stopped while waiting for SMS ack"
		: raw;
	state.lastError = message;
	updateAttempt(attempt.id, {
		status: "failed",
		error: message,
		finishedAt: new Date().toISOString(),
		remoteJobId: jobId ?? null,
	});
	state.rowStatuses[attempt.phone] = "failed";
	state.failed += 1;
	state.pending = Math.max(0, state.pending - 1);
	syncCampaignCounts(state, "running");
	emitProgress(state, "running");
}


export function pauseCampaign(
	campaignId: string,
	reason: "user" | "daily_limit" = "user",
): void {
	const state = runners.get(campaignId);
	if (!state?.running || state.stopped) return;
	state.paused = true;
	state.pausedReason = reason;
	syncCampaignCounts(state, "paused");
	emitProgress(state, "paused");
	wakeWaiter(state);
}

export function resumeCampaign(campaignId: string): void {
	const state = runners.get(campaignId);
	if (state?.running && !state.stopped && state.paused) {
		state.paused = false;
		state.pausedReason = null;
		syncCampaignCounts(state, "running");
		emitProgress(state, "running");
		wakeWaiter(state);
		return;
	}

	// Not in-memory (e.g. paused for daily_limit and loop exited) — restart.
	const campaign = getCampaign(campaignId);
	if (
		campaign &&
		(campaign.status === "paused" ||
			campaign.status === "interrupted" ||
			campaign.status === "draft" ||
			campaign.status === "stopped")
	) {
		void startCampaign(campaignId);
	}
}

export function stopCampaign(campaignId: string): void {
	const state = runners.get(campaignId);
	if (!state?.running) {
		const campaign = getCampaign(campaignId);
		if (campaign && (campaign.status === "running" || campaign.status === "paused")) {
			updateCampaign(campaignId, {
				status: "stopped",
				pausedReason: null,
				finishedAt: new Date().toISOString(),
			});
		}
		return;
	}
	state.stopped = true;
	state.paused = false;
	state.pausedReason = null;
	wakeWaiter(state);
}

export function pauseAllForDailyLimit(): void {
	for (const [id, state] of runners) {
		if (state.running && !state.stopped) {
			pauseCampaign(id, "daily_limit");
		}
	}
}

export function resumeAllPausedByDailyLimit(): void {
	if (isCapHit()) return;

	// In-memory paused runners
	for (const [id, state] of runners) {
		if (state.running && state.paused && state.pausedReason === "daily_limit") {
			resumeCampaign(id);
		}
	}

	// Campaigns paused in DB whose runner already exited the loop
	for (const campaign of listCampaigns()) {
		if (
			campaign.status === "paused" &&
			campaign.paused_reason === "daily_limit" &&
			!runners.get(campaign.id)?.running
		) {
			void startCampaign(campaign.id);
		}
	}
}

export function getProgress(campaignId: string): CampaignProgress | null {
	const state = runners.get(campaignId);
	if (!state) return null;
	const countdownRemainingMs = state.countdownRemainingMs;
	return {
		campaignId: state.campaignId,
		status: state.paused
			? "paused"
			: state.stopped
				? "stopped"
				: state.running
					? "running"
					: (getCampaign(campaignId)?.status ?? "draft"),
		pausedReason: state.pausedReason,
		rowIndex: state.rowIndex,
		total: state.total,
		sent: state.sent,
		failed: state.failed,
		skipped: state.skipped,
		pending: state.pending,
		currentPhone: state.currentPhone,
		lastError: state.lastError,
		nextDelayMs: state.nextDelayMs,
		countdownRemainingMs,
		countdownSeconds:
			countdownRemainingMs == null
				? undefined
				: Math.ceil(countdownRemainingMs / 1000),
		rowStatuses: { ...state.rowStatuses },
	};
}

export function listRunningIds(): string[] {
	const ids: string[] = [];
	for (const [id, state] of runners) {
		if (state.running && !state.stopped) ids.push(id);
	}
	return ids;
}

let dayWatchTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule auto-resume of daily-limit pauses at each local midnight. */
export function startDailyCapWatch(): void {
	const scheduleNext = () => {
		if (dayWatchTimer) clearTimeout(dayWatchTimer);
		const { nextMidnightIso } = getLocalDayBounds();
		const delay = Math.max(1000, new Date(nextMidnightIso).getTime() - Date.now() + 500);
		dayWatchTimer = setTimeout(() => {
			resumeAllPausedByDailyLimit();
			scheduleNext();
		}, delay);
	};
	scheduleNext();
}

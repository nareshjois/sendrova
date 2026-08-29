import { readFileSync } from "node:fs";
import path from "node:path";
import {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Updater,
} from "electrobun/bun";
import type {
	AppInfoDTO,
	AttemptDTO,
	CampaignDTO,
	ContactDTO,
	DashboardDTO,
	ImportResultDTO,
	ImportRowDTO,
	MainRPC,
	SettingsDTO,
	UpdateCheckDTO,
} from "shared/rpc";
import {
	APP_IDENTIFIER,
	APP_NAME,
	APP_VERSION,
	GITHUB_REPO,
	releaseBaseUrl,
} from "shared/release-config";
import {
	getLocalDayBounds,
	getRemainingToday,
	getSentToday,
	isCapHit,
	setMaxMessagesPerDay,
} from "./daily-cap";
import {
	createCampaign,
	deleteCampaign,
	exportCampaignCsv,
	getAllSettings,
	getAttempts,
	getCampaign,
	getContacts,
	getDashboardStats,
	getDeliveryStatusMap,
	buildMergedContactRows,
	listCampaigns,
	listRecentFailures,
	mergeContacts,
	duplicateCampaign as duplicateCampaignRecord,
	openDb,
	setSetting,
	updateCampaign,
	type Attempt,
	type Campaign,
	type Contact,
	type DeliveryStatus,
	type Settings,
} from "./db";
import {
	clearCampaignMedia,
	copyCampaignMedia,
	detectKind,
	saveCampaignMedia,
} from "./media";
import { getAuthDir, getHistoryDbPath, getUserDataDir } from "./paths";
import { parseCsv, parseTxt } from "./parse-import";
import {
	getProgress,
	listRunningIds,
	onProgress,
	pauseCampaign,
	resumeCampaign,
	startCampaign,
	startDailyCapWatch,
	stopCampaign,
} from "./scheduler";
import { renderTemplate, validateTemplate } from "./template";
import {
	getStatus,
	logout as sessionLogout,
	onQr,
	onStatus,
	start as startSession,
} from "./whatsapp-session";

async function getMainViewUrl(): Promise<string> {
	// Opt-in only — `bun start` must never pick up a leftover Vite HMR server.
	if (process.env.SENDROVA_HMR === "1") {
		try {
			const response = await fetch("http://localhost:5173");
			if (response.ok) return "http://localhost:5173";
		} catch {
			// fall through to bundled view
		}
	}
	return "views://mainview/index.html";
}

function toCampaignDto(row: Campaign): CampaignDTO {
	return {
		id: row.id,
		name: row.name,
		created_at: row.created_at,
		updated_at: row.updated_at,
		finished_at: row.finished_at,
		status: row.status,
		paused_reason: row.paused_reason,
		template_text: row.template_text,
		media_path: row.media_path,
		media_kind: row.media_kind,
		source_filename: row.source_filename,
		row_count: row.row_count,
		sent_count: row.sent_count,
		failed_count: row.failed_count,
		skipped_count: row.skipped_count,
		pending_count: row.pending_count,
	};
}

function toContactDto(
	row: Contact,
	deliveryMap?: Map<string, DeliveryStatus>,
): ContactDTO {
	let fields: Record<string, string> = {};
	try {
		fields = JSON.parse(row.fields_json) as Record<string, string>;
	} catch {
		fields = { phone: row.phone, phone_raw: row.phone_raw };
	}
	const map = deliveryMap ?? getDeliveryStatusMap(row.campaign_id);
	let deliveryStatus: DeliveryStatus = "pending";
	if (!row.valid || !row.phone) {
		deliveryStatus = "invalid";
	} else {
		const fromHistory = map.get(row.phone);
		if (fromHistory === "sent" || fromHistory === "failed") {
			deliveryStatus = fromHistory;
		}
	}
	return {
		id: row.id,
		campaign_id: row.campaign_id,
		row_index: row.row_index,
		phone: row.phone,
		phone_raw: row.phone_raw,
		fields,
		valid: row.valid === 1,
		error: row.error,
		deliveryStatus,
	};
}

function rowsToContactInputs(rows: ImportRowDTO[]) {
	return rows.map((r, i) => ({
		rowIndex: i,
		phone: r.phone,
		phoneRaw: r.phoneRaw,
		fields: r.fields,
		valid: r.valid,
		error: r.error ?? null,
	}));
}

function mergedToImportResult(
	campaignId: string,
	imported: ImportRowDTO[],
): ImportResultDTO {
	const merged = buildMergedContactRows(
		campaignId,
		rowsToContactInputs(imported),
	);
	const columns = new Set<string>(["phone"]);
	for (const row of merged.rows) {
		for (const key of Object.keys(row.fields)) columns.add(key);
	}
	return {
		rows: merged.rows.map((row) => ({
			phone: row.phone,
			phoneRaw: row.phoneRaw,
			fields: row.fields,
			valid: row.valid,
			error: row.error ?? undefined,
			deliveryStatus: row.deliveryStatus,
		})),
		columns: [...columns],
		phoneColumn: "phone",
		invalidCount: merged.invalidCount,
		duplicateCount: merged.duplicateCount,
		newCount: merged.newCount,
		alreadySentCount: merged.alreadySentCount,
	};
}

function toAttemptDto(row: Attempt): AttemptDTO {
	return {
		id: row.id,
		campaign_id: row.campaign_id,
		row_index: row.row_index,
		phone: row.phone,
		fields_json: row.fields_json,
		rendered_body: row.rendered_body,
		media_kind: row.media_kind,
		status: row.status,
		error: row.error,
		delay_before_ms: row.delay_before_ms,
		started_at: row.started_at,
		finished_at: row.finished_at,
	};
}

function toSettingsDto(s: Settings): SettingsDTO {
	return {
		delayMinMs: s.delay_min_ms,
		delayMaxMs: s.delay_max_ms,
		extraPauseChance: s.extra_pause_chance,
		extraPauseMinMs: s.extra_pause_min_ms,
		extraPauseMaxMs: s.extra_pause_max_ms,
		maxMessagesPerDay: s.max_messages_per_day,
	};
}

function buildDashboard(): DashboardDTO {
	const settings = getAllSettings();
	const stats = getDashboardStats();
	const sentToday = getSentToday();
	const remainingToday = getRemainingToday();
	const bounds = getLocalDayBounds();
	const midpoint =
		(settings.delay_min_ms + settings.delay_max_ms) / 2;
	const queueDepth = stats.totalPending;
	const estClearMinutes =
		queueDepth > 0 ? Math.round((queueDepth * midpoint) / 60000) : null;

	const attemptsToday = listCampaigns().flatMap((c) =>
		getAttempts(c.id).filter((a) => {
			if (!a.finished_at) return false;
			return a.finished_at >= bounds.startIso && a.finished_at < bounds.endIso;
		}),
	);
	const sent = attemptsToday.filter((a) => a.status === "sent").length;
	const failed = attemptsToday.filter((a) => a.status === "failed").length;
	const skippedToday = attemptsToday.filter((a) => a.status === "skipped").length;
	const successRateToday =
		sent + failed > 0 ? sent / (sent + failed) : null;
	const delays = attemptsToday
		.map((a) => a.delay_before_ms)
		.filter((d): d is number => typeof d === "number" && d >= 0);
	const avgDelayMsToday =
		delays.length > 0
			? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
			: null;

	const nameById = new Map(listCampaigns().map((c) => [c.id, c.name]));
	const recentFailures = listRecentFailures(8).map((a) => ({
		campaignId: a.campaign_id,
		campaignName: nameById.get(a.campaign_id) ?? "Campaign",
		phone: a.phone,
		error: a.error,
		finishedAt: a.finished_at,
	}));

	return {
		sentToday,
		remainingToday,
		maxPerDay: settings.max_messages_per_day,
		capHit: isCapHit(),
		nextMidnightIso: bounds.nextMidnightIso,
		runningCount: stats.runningCount,
		pausedCount: stats.pausedCount,
		draftCount: stats.draftCount,
		completedCount: stats.completedCount,
		queueDepth,
		successRateToday,
		avgDelayMsToday,
		skippedToday,
		estClearMinutes,
		recentFailures,
		campaigns: listCampaigns().map(toCampaignDto),
	};
}

function requireCampaign(id: string): Campaign {
	const c = getCampaign(id);
	if (!c) throw new Error(`Campaign not found: ${id}`);
	return c;
}

function mimeForPath(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".mp4":
			return "video/mp4";
		case ".mov":
			return "video/quicktime";
		case ".webm":
			return "video/webm";
		default:
			return "application/octet-stream";
	}
}

openDb();
startDailyCapWatch();

let mainWindow: BrowserWindow;

async function resolveAppInfo(): Promise<AppInfoDTO> {
	const configured = Boolean(releaseBaseUrl());
	try {
		const local = await Updater.getLocallocalInfo();
		return {
			name: local.name || APP_NAME,
			version: local.version || APP_VERSION,
			channel: local.channel || "dev",
			identifier: local.identifier || APP_IDENTIFIER,
			baseUrl: local.baseUrl || releaseBaseUrl(),
			updatesConfigured:
				configured && Boolean(local.baseUrl || releaseBaseUrl()),
			platform: process.platform,
		};
	} catch {
		return {
			name: APP_NAME,
			version: APP_VERSION,
			channel: "dev",
			identifier: APP_IDENTIFIER,
			baseUrl: releaseBaseUrl(),
			updatesConfigured: configured,
			platform: process.platform,
		};
	}
}

async function runUpdateCheck(): Promise<UpdateCheckDTO> {
	const info = await resolveAppInfo();
	if (!info.updatesConfigured) {
		return {
			ok: false,
			updateAvailable: false,
			updateReady: false,
			version: info.version,
			error: GITHUB_REPO
				? "Update host not available in this build (empty baseUrl)."
				: "Set GITHUB_REPO in shared/release-config.ts and rebuild a stable release.",
			channel: info.channel,
			updatesConfigured: false,
		};
	}
	if (info.channel === "dev") {
		return {
			ok: true,
			updateAvailable: false,
			updateReady: false,
			version: info.version,
			error: "Updates are skipped in the dev channel.",
			channel: info.channel,
			updatesConfigured: true,
		};
	}
	try {
		const update = await Updater.checkForUpdate();
		return {
			ok: !update.error,
			updateAvailable: Boolean(update.updateAvailable),
			updateReady: Boolean(update.updateReady),
			version: update.version || info.version,
			error: update.error || null,
			channel: info.channel,
			updatesConfigured: true,
		};
	} catch (err) {
		return {
			ok: false,
			updateAvailable: false,
			updateReady: false,
			version: info.version,
			error: err instanceof Error ? err.message : String(err),
			channel: info.channel,
			updatesConfigured: true,
		};
	}
}

ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ label: "About Sendrova", role: "about" },
			{ type: "separator" },
			{ label: "Quit", role: "quit", accelerator: "q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

const mainRPC = BrowserView.defineRPC<MainRPC>({
	maxRequestTime: 120_000,
	handlers: {
		requests: {
			ping: () => "pong",
			getConnectionStatus: () => getStatus(),
			getDataPaths: () => ({
				userData: getUserDataDir(),
				auth: getAuthDir(),
				historyDb: getHistoryDbPath(),
			}),
			startSession: async () => {
				await startSession();
				return { ok: true as const };
			},
			logout: async () => {
				await sessionLogout();
				return { ok: true as const };
			},

			getDashboard: () => buildDashboard(),
			listCampaigns: () => listCampaigns().map(toCampaignDto),
			getCampaign: ({ id }) => {
				const campaign = getCampaign(id);
				if (!campaign) return null;
				const deliveryMap = getDeliveryStatusMap(id);
				return {
					campaign: toCampaignDto(campaign),
					contacts: getContacts(id).map((c) => toContactDto(c, deliveryMap)),
					attempts: getAttempts(id).map(toAttemptDto),
				};
			},
			createCampaign: ({ name, templateText }) =>
				toCampaignDto(
					createCampaign({
						name: name.trim() || "Untitled campaign",
						templateText: templateText ?? "",
					}),
				),
			updateCampaign: ({ id, name, templateText, sourceFilename }) => {
				requireCampaign(id);
				const updated = updateCampaign(id, {
					name,
					templateText,
					sourceFilename,
				});
				if (!updated) throw new Error(`Campaign not found: ${id}`);
				return toCampaignDto(updated);
			},
			deleteCampaign: ({ id }) => {
				clearCampaignMedia(id);
				deleteCampaign(id);
				return { ok: true as const };
			},
			duplicateCampaign: ({ id }) => {
				const source = requireCampaign(id);
				const copy = duplicateCampaignRecord(id);
				const media = copyCampaignMedia(
					id,
					copy.id,
					source.media_path,
					source.media_kind,
				);
				updateCampaign(copy.id, {
					sourceFilename: source.source_filename,
					...(media
						? { mediaPath: media.absolutePath, mediaKind: media.kind }
						: {}),
				});
				return toCampaignDto(requireCampaign(copy.id));
			},
			setCampaignContacts: ({ campaignId, rows, sourceFilename }) => {
				requireCampaign(campaignId);
				mergeContacts(campaignId, rowsToContactInputs(rows));
				if (sourceFilename !== undefined) {
					updateCampaign(campaignId, { sourceFilename });
				}
				return toCampaignDto(requireCampaign(campaignId));
			},
			previewMergedContacts: ({ campaignId, rows }) => {
				requireCampaign(campaignId);
				return mergedToImportResult(campaignId, rows);
			},
			importText: ({ text, format }) => {
				const result = format === "csv" ? parseCsv(text) : parseTxt(text);
				return {
					rows: result.rows.map((row) => ({
						phone: row.phone,
						phoneRaw: row.phoneRaw,
						fields: row.fields,
						valid: row.valid,
						error: row.error,
					})),
					columns: result.columns,
					phoneColumn: result.phoneColumn,
					invalidCount: result.invalidCount,
					duplicateCount: result.duplicateCount,
				};
			},
			validateTemplate: ({ template, columns }) =>
				validateTemplate(template, columns),
			previewTemplate: ({ template, fields }) => ({
				text: renderTemplate(template, fields),
			}),
			setCampaignMedia: ({ campaignId, filename, base64 }) => {
				requireCampaign(campaignId);
				const kind = detectKind(filename);
				if (kind === "none") {
					throw new Error("Unsupported media type. Use image or video.");
				}
				const buf = Buffer.from(base64, "base64");
				const saved = saveCampaignMedia(campaignId, buf, filename, kind);
				const updated = updateCampaign(campaignId, {
					mediaPath: saved.absolutePath,
					mediaKind: saved.kind,
				});
				if (!updated) throw new Error(`Campaign not found: ${campaignId}`);
				return toCampaignDto(updated);
			},
			clearCampaignMedia: ({ campaignId }) => {
				requireCampaign(campaignId);
				clearCampaignMedia(campaignId);
				const updated = updateCampaign(campaignId, {
					mediaPath: null,
					mediaKind: "none",
				});
				if (!updated) throw new Error(`Campaign not found: ${campaignId}`);
				return toCampaignDto(updated);
			},
			readMediaPreview: ({ campaignId }) => {
				const c = getCampaign(campaignId);
				if (!c?.media_path) return null;
				try {
					const bytes = readFileSync(c.media_path);
					return {
						mime: mimeForPath(c.media_path),
						base64: bytes.toString("base64"),
					};
				} catch {
					return null;
				}
			},

			startCampaign: async ({ id }) => {
				await startCampaign(id);
				notifyDashboard();
				return { ok: true as const };
			},
			pauseCampaign: ({ id }) => {
				pauseCampaign(id, "user");
				notifyDashboard();
				return { ok: true as const };
			},
			resumeCampaign: ({ id }) => {
				resumeCampaign(id);
				notifyDashboard();
				return { ok: true as const };
			},
			stopCampaign: ({ id }) => {
				stopCampaign(id);
				notifyDashboard();
				return { ok: true as const };
			},
			getProgress: ({ id }) => getProgress(id),
			listRunning: () => listRunningIds(),

			getSettings: () => toSettingsDto(getAllSettings()),
			setSettings: (partial) => {
				if (partial.delayMinMs != null)
					setSetting("delay_min_ms", partial.delayMinMs);
				if (partial.delayMaxMs != null)
					setSetting("delay_max_ms", partial.delayMaxMs);
				if (partial.extraPauseChance != null)
					setSetting("extra_pause_chance", partial.extraPauseChance);
				if (partial.extraPauseMinMs != null)
					setSetting("extra_pause_min_ms", partial.extraPauseMinMs);
				if (partial.extraPauseMaxMs != null)
					setSetting("extra_pause_max_ms", partial.extraPauseMaxMs);
				if (partial.maxMessagesPerDay != null) {
					setMaxMessagesPerDay(partial.maxMessagesPerDay);
				}
				notifyDashboard();
				return toSettingsDto(getAllSettings());
			},

			exportCampaign: ({ id }) => ({ csv: exportCampaignCsv(id) }),

			minimizeWindow: () => {
				mainWindow.minimize();
				return { ok: true as const };
			},
			maximizeWindow: () => {
				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize();
					return { maximized: false };
				}
				mainWindow.maximize();
				return { maximized: true };
			},
			closeWindow: () => {
				mainWindow.close();
				return { ok: true as const };
			},
			isWindowMaximized: () => ({ maximized: mainWindow.isMaximized() }),

			getAppInfo: () => resolveAppInfo(),
			checkForUpdate: () => runUpdateCheck(),
			downloadAndApplyUpdate: async () => {
				const check = await runUpdateCheck();
				if (!check.ok || !check.updateAvailable) return check;
				try {
					await Updater.downloadUpdate();
					const info = Updater.updateInfo();
					if (info?.updateReady) {
						await Updater.applyUpdate();
					}
					return {
						...check,
						updateReady: Boolean(info?.updateReady),
						error: info?.error || null,
					};
				} catch (err) {
					return {
						...check,
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			},
		},
		messages: {
			log: ({ msg }) => console.log("[Webview]:", msg),
		},
	},
});

function notifyDashboard(): void {
	try {
		mainRPC.send.dashboardChanged({});
	} catch {
		// ignore
	}
}

onStatus((status) => {
	try {
		mainRPC.send.connectionStatus({ status });
	} catch {
		// ignore
	}
});

onQr((qr) => {
	try {
		mainRPC.send.qr({ qr });
	} catch {
		// ignore
	}
});

onProgress((progress) => {
	try {
		mainRPC.send.progress(progress);
		mainRPC.send.dashboardChanged({});
	} catch {
		// ignore
	}
});

mainWindow = new BrowserWindow({
	title: "Sendrova",
	url: await getMainViewUrl(),
	titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
	frame: {
		width: 1280,
		height: 860,
		x: 60,
		y: 40,
	},
	rpc: mainRPC,
});

mainWindow.on("close", () => {
	process.exit(0);
});

/**
 * Electrobun on Windows initially sizes the webview to the outer window frame
 * (title bar + borders), so the bottom of the UI is clipped until a real
 * WM_SIZE runs against GetClientRect. Nudge size after dom-ready so WebView2
 * exists and picks up the correct client bounds.
 * @see https://github.com/blackboardsh/electrobun/issues/462
 */
function fixWindowsWebviewBounds() {
	if (process.platform !== "win32") return;
	try {
		const { width, height } = mainWindow.getSize();
		mainWindow.setSize(width, height + 1);
		mainWindow.setSize(width, height);
	} catch (err) {
		console.warn("[window] Windows bounds nudge failed", err);
	}
}

mainWindow.webview.on("dom-ready", () => {
	console.log("Webview DOM ready");
	fixWindowsWebviewBounds();
	try {
		mainRPC.send.connectionStatus({ status: getStatus() });
	} catch {
		// ignore
	}
	void startSession().catch((err) => {
		console.warn("[session] auto-start failed", err);
	});
});

console.log("Sendrova started");
console.log("User data:", getUserDataDir());

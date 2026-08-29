import type { RPCSchema } from "electrobun";

export type ConnectionStatus =
	| "disconnected"
	| "qr"
	| "connecting"
	| "connected"
	| "logged_out";

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
export type AttemptStatusDTO =
	| "pending"
	| "sending"
	| "sent"
	| "failed"
	| "skipped";

export type CampaignDTO = {
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

/** Delivery / list status for a contact row in the editor */
export type DeliveryStatus =
	| "new"
	| "sent"
	| "failed"
	| "pending"
	| "invalid";

export type ContactDTO = {
	id: string;
	campaign_id: string;
	row_index: number;
	phone: string;
	phone_raw: string;
	fields: Record<string, string>;
	valid: boolean;
	error: string | null;
	deliveryStatus: DeliveryStatus;
};

export type AttemptDTO = {
	id: string;
	campaign_id: string;
	row_index: number;
	phone: string;
	fields_json: string;
	rendered_body: string;
	media_kind: MediaKind;
	status: string;
	error: string | null;
	delay_before_ms: number | null;
	started_at: string | null;
	finished_at: string | null;
};

export type ImportRowDTO = {
	phone: string;
	phoneRaw: string;
	fields: Record<string, string>;
	valid: boolean;
	error?: string;
	deliveryStatus?: DeliveryStatus;
};

export type ImportResultDTO = {
	rows: ImportRowDTO[];
	columns: string[];
	phoneColumn: string | null;
	invalidCount: number;
	duplicateCount: number;
	newCount?: number;
	alreadySentCount?: number;
};

export type TemplateValidationDTO = {
	ok: boolean;
	unknown: string[];
	known: string[];
};

export type CampaignProgressDTO = {
	campaignId: string;
	status: string;
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
	rowStatuses?: Record<string, AttemptStatusDTO>;
};

export type SettingsDTO = {
	delayMinMs: number;
	delayMaxMs: number;
	extraPauseChance: number;
	extraPauseMinMs: number;
	extraPauseMaxMs: number;
	maxMessagesPerDay: number;
};

/** SMS phone-gateway connection (mock when SMS_RELAY_MOCK is set). */
export type SmsConnectionDTO = {
	mode: "mock" | "live";
	ready: boolean;
	status: "unpaired" | "pending" | "paired";
	deviceId: string | null;
	online: boolean | null;
	/**
	 * Whether the desktop could reach the SMS relay Worker.
	 * `false` when the last health/status call failed (Worker down / bad URL).
	 * `null` when not applicable (unpaired without a recent probe).
	 */
	relayReachable: boolean | null;
	relayBaseUrl: string | null;
	pairId: string | null;
	pairExpiresAt: string | null;
	/** Present while pairing so the UI can render / restore the QR. */
	qrPayload: string | null;
};

export type SmsPairStartDTO = {
	pairId: string;
	secret: string;
	expiresAt: string;
	relayBaseUrl: string;
	qrPayload: string;
};

export type AppInfoDTO = {
	name: string;
	version: string;
	channel: string;
	identifier: string;
	baseUrl: string;
	updatesConfigured: boolean;
	platform: string;
};

export type UpdateCheckDTO = {
	ok: boolean;
	updateAvailable: boolean;
	updateReady: boolean;
	version: string;
	error: string | null;
	channel: string;
	updatesConfigured: boolean;
};

export type DashboardDTO = {
	sentToday: number;
	remainingToday: number;
	maxPerDay: number;
	capHit: boolean;
	nextMidnightIso: string;
	runningCount: number;
	pausedCount: number;
	draftCount: number;
	completedCount: number;
	queueDepth: number;
	successRateToday: number | null;
	avgDelayMsToday: number | null;
	skippedToday: number;
	estClearMinutes: number | null;
	recentFailures: Array<{
		campaignId: string;
		campaignName: string;
		phone: string;
		error: string | null;
		finishedAt: string | null;
	}>;
	campaigns: CampaignDTO[];
};

export type MainRPC = {
	bun: RPCSchema<{
		requests: {
			ping: { params: Record<string, never>; response: string };
			getConnectionStatus: {
				params: Record<string, never>;
				response: ConnectionStatus;
			};
			getDataPaths: {
				params: Record<string, never>;
				response: { userData: string; auth: string; historyDb: string };
			};
			startSession: { params: Record<string, never>; response: { ok: true } };
			logout: { params: Record<string, never>; response: { ok: true } };

			getDashboard: { params: Record<string, never>; response: DashboardDTO };
			listCampaigns: { params: Record<string, never>; response: CampaignDTO[] };
			getCampaign: {
				params: { id: string };
				response: {
					campaign: CampaignDTO;
					contacts: ContactDTO[];
					attempts: AttemptDTO[];
				} | null;
			};
			createCampaign: {
				params: {
					name: string;
					templateText?: string;
					channel?: MessageChannelKind;
				};
				response: CampaignDTO;
			};
			updateCampaign: {
				params: {
					id: string;
					name?: string;
					templateText?: string;
					sourceFilename?: string | null;
					channel?: MessageChannelKind;
				};
				response: CampaignDTO;
			};
			deleteCampaign: { params: { id: string }; response: { ok: true } };
			duplicateCampaign: {
				params: { id: string };
				response: CampaignDTO;
			};
			setCampaignContacts: {
				params: {
					campaignId: string;
					rows: ImportRowDTO[];
					sourceFilename?: string;
				};
				response: CampaignDTO;
			};
			previewMergedContacts: {
				params: {
					campaignId: string;
					rows: ImportRowDTO[];
				};
				response: ImportResultDTO;
			};
			importText: {
				params: { text: string; format: "csv" | "txt" };
				response: ImportResultDTO;
			};
			validateTemplate: {
				params: { template: string; columns: string[] };
				response: TemplateValidationDTO;
			};
			previewTemplate: {
				params: { template: string; fields: Record<string, string> };
				response: { text: string };
			};
			setCampaignMedia: {
				params: {
					campaignId: string;
					filename: string;
					base64: string;
				};
				response: CampaignDTO;
			};
			clearCampaignMedia: {
				params: { campaignId: string };
				response: CampaignDTO;
			};
			readMediaPreview: {
				params: { campaignId: string };
				response: { mime: string; base64: string } | null;
			};

			startCampaign: { params: { id: string }; response: { ok: true } };
			pauseCampaign: { params: { id: string }; response: { ok: true } };
			resumeCampaign: { params: { id: string }; response: { ok: true } };
			stopCampaign: { params: { id: string }; response: { ok: true } };
			getProgress: {
				params: { id: string };
				response: CampaignProgressDTO | null;
			};
			listRunning: { params: Record<string, never>; response: string[] };

			getSettings: { params: Record<string, never>; response: SettingsDTO };
			setSettings: {
				params: Partial<SettingsDTO>;
				response: SettingsDTO;
			};

			getSmsConnection: {
				params: Record<string, never>;
				response: SmsConnectionDTO;
			};
			startSmsPair: {
				params: Record<string, never>;
				response: SmsPairStartDTO;
			};
			refreshSmsPairStatus: {
				params: Record<string, never>;
				response: SmsConnectionDTO;
			};
			unpairSms: {
				params: Record<string, never>;
				response: SmsConnectionDTO;
			};

			exportCampaign: { params: { id: string }; response: { csv: string } };

			minimizeWindow: { params: Record<string, never>; response: { ok: true } };
			maximizeWindow: {
				params: Record<string, never>;
				response: { maximized: boolean };
			};
			closeWindow: { params: Record<string, never>; response: { ok: true } };
			isWindowMaximized: {
				params: Record<string, never>;
				response: { maximized: boolean };
			};

			getAppInfo: { params: Record<string, never>; response: AppInfoDTO };
			checkForUpdate: {
				params: Record<string, never>;
				response: UpdateCheckDTO;
			};
			downloadAndApplyUpdate: {
				params: Record<string, never>;
				response: UpdateCheckDTO;
			};
		};
		messages: {
			log: { msg: string };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: {
			connectionStatus: { status: ConnectionStatus };
			qr: { qr: string };
			progress: CampaignProgressDTO;
			dashboardChanged: Record<string, never>;
		};
	}>;
};

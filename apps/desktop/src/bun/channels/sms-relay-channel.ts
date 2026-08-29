import {
	clearSmsRelayState,
	isSmsMockMode,
	readSmsRelayState,
	resolveSmsRelayBaseUrl,
	type SmsRelayStoredState,
	writeSmsRelayState,
} from "./sms-relay-store";
import type {
	MessageChannel,
	SendMessageInput,
	SendMessageResult,
} from "./types";

type ErrorEnvelope = {
	error?: { code?: string; message?: string };
};

type CreateJobResponse = {
	jobId: string;
	status: "pending";
};

type JobStatusResponse = {
	jobId: string;
	status: "pending" | "in_progress" | "sent" | "failed";
	clientJobId?: string;
	error?: string | null;
	updatedAt?: string;
};

type PairStartResponse = {
	pairId: string;
	secret: string;
	expiresAt: string;
	relayBaseUrl: string;
	desktopToken: string;
};

type PairStatusResponse = {
	status: "pending" | "paired" | "expired";
	deviceId?: string;
};

type DeviceHealthResponse = {
	online: boolean;
	lastSeenAt: string | null;
};

const mockJobs = new Map<
	string,
	{ status: "pending" | "sent" | "failed"; to: string; body: string }
>();

function apiError(status: number, body: unknown): Error {
	const env = body as ErrorEnvelope;
	const message =
		env?.error?.message ??
		(typeof body === "string" ? body : `SMS relay HTTP ${status}`);
	const code = env?.error?.code;
	return new Error(code ? `${code}: ${message}` : message);
}

async function relayFetch<T>(
	baseUrl: string,
	token: string | null,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers["Content-Type"] = "application/json";

	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await res.text();
	let parsed: unknown = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	if (!res.ok) throw apiError(res.status, parsed);
	return parsed as T;
}

/**
 * SMS relay channel.
 *
 * When `SMS_RELAY_BASE_URL` (and stored URL) are unset, uses an in-memory mock
 * that accepts jobs immediately. Phase 1 treats enqueue/mock accept as sent;
 * `waitUntilSent` is a stub until Phase 2 polls phone ack.
 */
export class SmsRelayChannel implements MessageChannel {
	readonly kind = "sms" as const;

	isReady(): boolean {
		if (isSmsMockMode()) return true;
		const state = readSmsRelayState();
		return state.status === "paired" && Boolean(state.desktopToken);
	}

	async send(input: SendMessageInput): Promise<SendMessageResult> {
		if (isSmsMockMode()) {
			const jobId = `mock-${input.clientJobId || crypto.randomUUID()}`;
			mockJobs.set(jobId, {
				status: "sent",
				to: input.to,
				body: input.body,
			});
			return { remoteJobId: jobId };
		}

		const state = readSmsRelayState();
		const baseUrl = resolveSmsRelayBaseUrl(state);
		if (!baseUrl || !state.desktopToken) {
			throw new Error("SMS relay is not configured or paired");
		}

		const created = await relayFetch<CreateJobResponse>(
			baseUrl,
			state.desktopToken,
			"POST",
			"/v1/jobs",
			{
				to: input.to,
				body: input.body,
				clientJobId: input.clientJobId,
			},
		);
		return { remoteJobId: created.jobId };
	}

	/**
	 * Phase 2: poll GET /v1/jobs/{jobId} until sent|failed.
	 * Phase 1 stub — scheduler marks sent after enqueue/mock.
	 */
	async waitUntilSent(
		remoteJobId: string,
		_opts?: { signal?: AbortSignal },
	): Promise<void> {
		if (isSmsMockMode()) {
			const job = mockJobs.get(remoteJobId);
			if (job?.status === "failed") {
				throw new Error("mock SMS job failed");
			}
			return;
		}
		// Phase 2 will poll here; intentionally no-op in Phase 1.
		void remoteJobId;
	}
}

export function getMockJobCountForTests(): number {
	return mockJobs.size;
}

export function clearMockJobsForTests(): void {
	mockJobs.clear();
}

export async function startSmsPairing(): Promise<{
	pairId: string;
	secret: string;
	expiresAt: string;
	relayBaseUrl: string;
	qrPayload: string;
}> {
	if (isSmsMockMode()) {
		throw new Error(
			"SMS relay mock mode — set SMS_RELAY_BASE_URL to pair a phone",
		);
	}
	const baseUrl = resolveSmsRelayBaseUrl();
	if (!baseUrl) {
		throw new Error("SMS_RELAY_BASE_URL is not set");
	}

	const started = await relayFetch<PairStartResponse>(
		baseUrl,
		null,
		"POST",
		"/v1/pair/start",
	);

	writeSmsRelayState({
		relayBaseUrl: started.relayBaseUrl || baseUrl,
		desktopToken: started.desktopToken,
		pairId: started.pairId,
		pairSecret: started.secret,
		pairExpiresAt: started.expiresAt,
		deviceId: null,
		status: "pending",
	});

	const relay = started.relayBaseUrl || baseUrl;
	const qrPayload = `sendrova://sms-pair?u=${encodeURIComponent(relay)}&pairId=${encodeURIComponent(started.pairId)}&secret=${encodeURIComponent(started.secret)}`;

	return {
		pairId: started.pairId,
		secret: started.secret,
		expiresAt: started.expiresAt,
		relayBaseUrl: relay,
		qrPayload,
	};
}

export async function refreshSmsPairStatus(): Promise<SmsRelayStoredState> {
	if (isSmsMockMode()) {
		return writeSmsRelayState({ status: "paired", deviceId: "mock-device" });
	}

	const state = readSmsRelayState();
	const baseUrl = resolveSmsRelayBaseUrl(state);
	if (!baseUrl || !state.desktopToken || !state.pairId) {
		return state;
	}

	const status = await relayFetch<PairStatusResponse>(
		baseUrl,
		state.desktopToken,
		"GET",
		`/v1/pair/status?pairId=${encodeURIComponent(state.pairId)}`,
	);

	if (status.status === "paired") {
		return writeSmsRelayState({
			status: "paired",
			deviceId: status.deviceId ?? state.deviceId,
		});
	}
	if (status.status === "expired") {
		return writeSmsRelayState({
			status: "unpaired",
			pairId: null,
			pairSecret: null,
			pairExpiresAt: null,
		});
	}
	return writeSmsRelayState({ status: "pending" });
}

export async function fetchSmsDeviceHealth(): Promise<DeviceHealthResponse | null> {
	if (isSmsMockMode()) {
		return { online: true, lastSeenAt: new Date().toISOString() };
	}
	const state = readSmsRelayState();
	const baseUrl = resolveSmsRelayBaseUrl(state);
	if (!baseUrl || !state.desktopToken || state.status !== "paired") {
		return null;
	}
	return relayFetch<DeviceHealthResponse>(
		baseUrl,
		state.desktopToken,
		"GET",
		"/v1/device/health",
	);
}

export async function unpairSms(): Promise<SmsRelayStoredState> {
	if (!isSmsMockMode()) {
		const state = readSmsRelayState();
		const baseUrl = resolveSmsRelayBaseUrl(state);
		if (baseUrl && state.desktopToken) {
			try {
				await relayFetch<{ ok: true }>(
					baseUrl,
					state.desktopToken,
					"POST",
					"/v1/pair/unpair",
					{},
				);
			} catch {
				// Still clear local state
			}
		}
	}
	return clearSmsRelayState();
}

/** Live poll helper reserved for Phase 2 waitUntilSent. */
export async function getSmsJobStatus(
	jobId: string,
): Promise<JobStatusResponse | null> {
	if (isSmsMockMode()) {
		const job = mockJobs.get(jobId);
		if (!job) return null;
		return { jobId, status: job.status };
	}
	const state = readSmsRelayState();
	const baseUrl = resolveSmsRelayBaseUrl(state);
	if (!baseUrl || !state.desktopToken) return null;
	return relayFetch<JobStatusResponse>(
		baseUrl,
		state.desktopToken,
		"GET",
		`/v1/jobs/${encodeURIComponent(jobId)}`,
	);
}

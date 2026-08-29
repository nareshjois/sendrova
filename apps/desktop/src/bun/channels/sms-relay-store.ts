import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUserDataDir } from "../paths";
import {
	isSmsRelayMockEnv,
	SMS_RELAY_PRODUCTION_BASE_URL,
	smsRelayEnvBaseUrlOverride,
} from "./sms-relay-config";

export type SmsRelayStoredState = {
	relayBaseUrl: string | null;
	desktopToken: string | null;
	deviceId: string | null;
	pairId: string | null;
	pairSecret: string | null;
	pairExpiresAt: string | null;
	status: "unpaired" | "pending" | "paired";
};

const DEFAULT_STATE: SmsRelayStoredState = {
	relayBaseUrl: null,
	desktopToken: null,
	deviceId: null,
	pairId: null,
	pairSecret: null,
	pairExpiresAt: null,
	status: "unpaired",
};

function storePath(): string {
	const dir = getUserDataDir();
	mkdirSync(dir, { recursive: true });
	return path.join(dir, "sms-relay.json");
}

export function readSmsRelayState(): SmsRelayStoredState {
	const file = storePath();
	if (!existsSync(file)) return { ...DEFAULT_STATE };
	try {
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<SmsRelayStoredState>;
		return {
			...DEFAULT_STATE,
			...raw,
			status:
				raw.status === "pending" || raw.status === "paired" || raw.status === "unpaired"
					? raw.status
					: "unpaired",
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}

export function writeSmsRelayState(
	patch: Partial<SmsRelayStoredState>,
): SmsRelayStoredState {
	const next = { ...readSmsRelayState(), ...patch };
	writeFileSync(storePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

export function clearSmsRelayState(): SmsRelayStoredState {
	const next = { ...DEFAULT_STATE };
	writeFileSync(storePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

/**
 * Live SMS relay base URL.
 * - `SMS_RELAY_MOCK` → null (in-memory mock, for tests / offline)
 * - `SMS_RELAY_BASE_URL` → local wrangler override when set
 * - else built-in production Worker URL
 */
export function resolveSmsRelayBaseUrl(
	_stored: SmsRelayStoredState = readSmsRelayState(),
): string | null {
	if (isSmsRelayMockEnv()) return null;
	return smsRelayEnvBaseUrlOverride() ?? SMS_RELAY_PRODUCTION_BASE_URL;
}

export function isSmsMockMode(
	_stored: SmsRelayStoredState = readSmsRelayState(),
): boolean {
	return isSmsRelayMockEnv();
}

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** User data root: SENDROVA_DATA or ~/.sendrova */
export function getUserDataDir(): string {
	const dir =
		process.env.SENDROVA_DATA?.trim() ||
		path.join(os.homedir(), ".sendrova");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Baileys multi-file auth state directory */
export function getAuthDir(): string {
	const dir = path.join(getUserDataDir(), "auth_info");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** SQLite path for campaign / attempt history */
export function getHistoryDbPath(): string {
	getUserDataDir();
	return path.join(getUserDataDir(), "history.sqlite");
}

/**
 * Media storage under userData/media, optionally scoped per campaign.
 * `getMediaDir()` → …/media ; `getMediaDir(id)` → …/media/<id>
 */
export function getMediaDir(campaignId?: string): string {
	const dir = campaignId
		? path.join(getUserDataDir(), "media", campaignId)
		: path.join(getUserDataDir(), "media");
	mkdirSync(dir, { recursive: true });
	return dir;
}

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MediaKind } from "./db";
import { getMediaDir } from "./paths";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);

/** Detect media kind from a filename extension. */
export function detectKind(filename: string): MediaKind {
	const ext = path.extname(filename).toLowerCase();
	if (IMAGE_EXTS.has(ext)) return "image";
	if (VIDEO_EXTS.has(ext)) return "video";
	return "none";
}

function sanitizeFilename(filename: string): string {
	const base = path.basename(filename).replace(/[^\w.\-()+ ]+/g, "_");
	return base || `media-${Date.now()}`;
}

/**
 * Persist campaign media under getMediaDir(campaignId).
 * Accepts a filesystem path or a Buffer/Uint8Array.
 * Returns the absolute destination path.
 */
export function saveCampaignMedia(
	campaignId: string,
	sourcePathOrBuffer: string | Buffer | Uint8Array,
	filename: string,
	kind?: MediaKind,
): { absolutePath: string; kind: MediaKind } {
	const dir = getMediaDir(campaignId);
	mkdirSync(dir, { recursive: true });

	const safeName = sanitizeFilename(filename);
	const dest = path.join(dir, safeName);
	const resolvedKind = kind ?? detectKind(safeName);

	if (typeof sourcePathOrBuffer === "string") {
		copyFileSync(sourcePathOrBuffer, dest);
	} else {
		writeFileSync(dest, sourcePathOrBuffer);
	}

	return { absolutePath: dest, kind: resolvedKind };
}

/** Remove all media files for a campaign (and its media directory). */
export function clearCampaignMedia(campaignId: string): void {
	const dir = getMediaDir(campaignId);
	rmSync(dir, { recursive: true, force: true });
}

/**
 * Copy media files from one campaign to another.
 * Returns the new absolute path and kind, or null if source has no media file.
 */
export function copyCampaignMedia(
	fromCampaignId: string,
	toCampaignId: string,
	sourceAbsolutePath: string | null,
	kind: MediaKind,
): { absolutePath: string; kind: MediaKind } | null {
	if (!sourceAbsolutePath || kind === "none") return null;
	const filename = path.basename(sourceAbsolutePath);
	return saveCampaignMedia(toCampaignId, sourceAbsolutePath, filename, kind);
}


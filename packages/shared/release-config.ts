/**
 * GitHub Releases auto-update host.
 *
 * Rebuild stable after changing this:
 *   bun run build:stable
 * Upload Electrobun artifacts from the build output to that release without renaming.
 *
 * Expected asset names (Electrobun platform prefix), e.g. for Windows x64 stable:
 *   stable-win-x64-update.json
 *   stable-win-x64-<hash>.tar.zst
 *   optional: stable-win-x64-<prevHash>.patch
 */
export const GITHUB_REPO = "nareshjois/sendrova";

export function releaseBaseUrl(): string {
	const repo = GITHUB_REPO.trim();
	if (!repo) return "";
	return `https://github.com/${repo}/releases/latest/download`;
}

export const APP_VERSION = "1.0.0";
export const APP_NAME = "Sendrova";
export const APP_IDENTIFIER = "dev.nareshjois.sendrova";

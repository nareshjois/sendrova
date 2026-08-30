/** In-app changelog (keep in sync with CHANGELOG.md). */
export const CHANGELOG_ENTRIES: Array<{
	version: string;
	date: string;
	items: string[];
}> = [
	{
		version: "1.1.4",
		date: "2026-08-30",
		items: [
			"Normalize desktop + landing colors to the app-icon palette",
			"Landing redesign: brand-first hero, icon logo/favicon, parallax motion",
		],
	},
	{
		version: "1.1.3",
		date: "2026-08-30",
		items: [
			"Fix Windows titlebar controls (min/max/close) for Electrobun 2 (hiddenInset)",
			"About: clearer auto-update status (loading vs not configured vs release host)",
			"Changelog history through 1.1.x in About",
		],
	},
	{
		version: "1.1.2",
		date: "2026-08-30",
		items: [
			"Windows release CI: build Electrobun/Hutch packs with System32 bsdtar via pwsh",
		],
	},
	{
		version: "1.1.1",
		date: "2026-08-30",
		items: [
			"Windows release CI: shim bsdtar so Hutch packaging works on GitHub runners",
		],
	},
	{
		version: "1.1.0",
		date: "2026-08-30",
		items: [
			"Desktop migrates to Electrobun 2.0.1 (Hutch) with Windows uninstaller support",
			"Windows Setup artifact renamed to win-x64-Sendrova-Setup.zip",
			"Landing page + SMS relay Worker assets",
			"Fresh install required when upgrading from Electrobun 1.16 (in-app update 1.x → 2.x not supported)",
		],
	},
	{
		version: "0.1.0",
		date: "2026-08-29",
		items: [
			"Standalone public repo with Windows GitHub Releases auto-update",
			"New platform icon packs (windows / macOS / linux)",
			"Campaign editor: 50/50 layout (message/media/preview | contacts)",
			"Shared app footer: connection status + Cancel / Save / Start",
			"Custom Windows titlebar with minimize / maximize / close",
			"About screen with changelog and developer credit",
			"Windows Electrobun viewport bounds nudge",
			"Micro-animations with reduced-motion support",
		],
	},
];

/** In-app changelog (keep in sync with CHANGELOG.md). */
export const CHANGELOG_ENTRIES: Array<{
	version: string;
	date: string;
	items: string[];
}> = [
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

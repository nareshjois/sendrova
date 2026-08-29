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
			"Campaign editor: 50/50 layout (message/media/preview | contacts)",
			"Shared app footer: connection status + Cancel / Save / Start",
			"Custom Windows titlebar with minimize / maximize / close",
			"About screen with changelog and developer credit",
			"Windows Electrobun viewport bounds nudge (titlebar/client rect)",
			"Micro-animations with reduced-motion support",
			"Auto-update plumbing via GitHub Releases (config-driven)",
		],
	},
];

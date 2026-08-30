import type { ElectrobunConfig } from "electrobun";
import {
	APP_IDENTIFIER,
	APP_NAME,
	APP_VERSION,
	releaseBaseUrl,
} from "@sendrova/shared/release-config";

export default {
	app: {
		name: APP_NAME,
		identifier: APP_IDENTIFIER,
		version: APP_VERSION,
	},
	build: {
		// Lowest-risk bridge from Electrobun 1.x Bun main process.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
			// Bundle Baileys into the app entry — externals fail to resolve at runtime.
			external: [],
		},
		views: {},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: {
			codesign: false,
			notarize: false,
			bundleCEF: false,
			entitlements: {},
			// Kept for future mac builds; releases are Windows-only for now.
			icons: "macOS/AppIcon.iconset",
		},
		linux: {
			bundleCEF: false,
			// Kept for future linux builds; releases are Windows-only for now.
			icon: "linux/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "windows/icon-256x256px.ico",
		},
	},
	release: {
		// GitHub Releases latest/download — see @sendrova/shared/release-config
		baseUrl: releaseBaseUrl(),
	},
} satisfies ElectrobunConfig;

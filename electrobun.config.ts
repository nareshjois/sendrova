import type { ElectrobunConfig } from "electrobun/bun";
import {
	APP_IDENTIFIER,
	APP_NAME,
	APP_VERSION,
	releaseBaseUrl,
} from "./shared/release-config";

export default {
	app: {
		name: APP_NAME,
		identifier: APP_IDENTIFIER,
		version: APP_VERSION,
	},
	build: {
		useAsar: true,
		bun: {
			entrypoint: "src/bun/index.ts",
			// Bundle Baileys into the app entry — ASAR externals fail to resolve at runtime.
			external: [],
		},
		views: {},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets/": "views/mainview/assets/",
		},
		watchIgnore: ["dist/**"],
		mac: {
			codesign: false,
			notarize: false,
			bundleCEF: false,
			entitlements: {},
			icons: "assets/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icon.ico",
		},
	},
	release: {
		// Empty until GITHUB_REPO is set in shared/release-config.ts
		baseUrl: releaseBaseUrl(),
	},
} satisfies ElectrobunConfig;

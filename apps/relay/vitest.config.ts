import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.toml" },
				// Vitest does not load `.dev.vars`; inject a non-prod test key here.
				miniflare: {
					bindings: {
						TOKEN_SIGNING_KEY: "dev-token-signing-key-change-me",
					},
				},
			},
		},
	},
});

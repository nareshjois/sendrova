import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	resolve: {
		alias: [
			...electrobunViteAliases(path.resolve(__dirname, ".hutch/devkit")),
			{
				find: "@",
				replacement: path.resolve(__dirname, "src/mainview"),
			},
			{
				find: "shared",
				replacement: path.resolve(__dirname, "../../packages/shared"),
			},
			{
				find: "@sendrova/shared",
				replacement: path.resolve(__dirname, "../../packages/shared"),
			},
		],
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});

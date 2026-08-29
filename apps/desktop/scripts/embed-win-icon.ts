/**
 * Electrobun 1.16 ships a `bun build --compile` CLI. Bun statically resolves
 * rcedit at Electrobun's CI build time and bakes the absolute path
 *   D:\a\electrobun\electrobun\package\node_modules\rcedit\...
 * into electrobun.exe. `bun add rcedit` alone does not fix icon embedding —
 * Electrobun never looks at this project's node_modules for rcedit.
 *
 * Workaround: before `electrobun` copies its Windows templates, embed our
 * app icon into those templates with the project's own rcedit. Copies inherit
 * the icon; Electrobun's later rcedit attempt may still warn (baked path) but
 * the shipped binaries already have the correct icon.
 *
 * Upstream: https://github.com/blackboardsh/electrobun/issues/429
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "win32") {
	process.exit(0);
}

const config = (await import(join(desktopRoot, "electrobun.config.ts")))
	.default as { build?: { win?: { icon?: string } } };
const iconRel = config.build?.win?.icon;
if (!iconRel) {
	console.log("[embed-win-icon] no build.win.icon configured; skipping");
	process.exit(0);
}

const iconAbs = isAbsolute(iconRel) ? iconRel : resolve(desktopRoot, iconRel);
if (!existsSync(iconAbs)) {
	throw new Error(`[embed-win-icon] icon not found at ${iconAbs}`);
}

const require = createRequire(import.meta.url);
let rceditDir: string;
try {
	rceditDir = dirname(require.resolve("rcedit/package.json"));
} catch {
	throw new Error(
		"[embed-win-icon] rcedit is not installed. Run `bun install` at the repo root.",
	);
}

const rceditX64 = join(rceditDir, "bin", "rcedit-x64.exe");
const rceditExe = existsSync(rceditX64)
	? rceditX64
	: join(rceditDir, "bin", "rcedit.exe");
if (!existsSync(rceditExe)) {
	throw new Error(`[embed-win-icon] rcedit binary not found under ${rceditDir}`);
}

let electrobunRoot: string;
try {
	electrobunRoot = dirname(require.resolve("electrobun/package.json"));
} catch {
	electrobunRoot = join(desktopRoot, "node_modules", "electrobun");
}
const distDir = join(electrobunRoot, "dist-win-x64");
const targets = ["launcher.exe", "bun.exe", "extractor.exe"];

let embedded = 0;
for (const name of targets) {
	const target = join(distDir, name);
	if (!existsSync(target)) {
		console.warn(`[embed-win-icon] ${target} not found, skipping`);
		continue;
	}
	execFileSync(rceditExe, [target, "--set-icon", iconAbs], { stdio: "inherit" });
	console.log(`[embed-win-icon] embedded icon into ${name}`);
	embedded += 1;
}

if (embedded === 0) {
	throw new Error(
		`[embed-win-icon] no Electrobun Windows templates found under ${distDir}`,
	);
}

/**
 * Electrobun downloads platform core (dist-win-x64) and CLI lazily on first use.
 * Our icon embed must run before electrobun copies templates, so CI needs core first.
 *
 * Bun isolates packages under `node_modules/.bun/pkg@version/...`. Git's GNU tar on
 * Windows runners treats `@` as user@host and fails extracting CLI into that path.
 * We fetch core + CLI with fetch + Bun.Archive (no system tar) and place
 * `bin/electrobun.exe` so electrobun.cjs skips its broken tar path.
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
	process.exit(0);
}

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let electrobunRoot: string;
try {
	electrobunRoot = dirname(require.resolve("electrobun/package.json"));
} catch {
	electrobunRoot = join(desktopRoot, "node_modules", "electrobun");
}

const pkg = require(join(electrobunRoot, "package.json")) as { version: string };
const version = `v${pkg.version}`;
const releaseBase = `https://github.com/blackboardsh/electrobun/releases/download/${version}`;

async function downloadAndExtract(url: string, destDir: string, tempName: string): Promise<void> {
	const tempFile = join(electrobunRoot, tempName);
	console.log(`[ensure-win-core] downloading ${url}`);
	mkdirSync(destDir, { recursive: true });

	const res = await fetch(url);
	if (!res.ok || !res.body) {
		throw new Error(`[ensure-win-core] download failed: ${res.status} ${res.statusText}`);
	}

	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tempFile));
	const tarBytes = await Bun.file(tempFile).arrayBuffer();
	const archive = new Bun.Archive(tarBytes);
	await archive.extract(destDir);
	unlinkSync(tempFile);
}

const distDir = join(electrobunRoot, "dist-win-x64");
const coreMarker = join(distDir, "launcher.exe");
if (existsSync(coreMarker)) {
	console.log(`[ensure-win-core] core OK ${coreMarker}`);
} else {
	await downloadAndExtract(
		`${releaseBase}/electrobun-core-win-x64.tar.gz`,
		distDir,
		"core-win-x64-temp.tar.gz",
	);
	if (!existsSync(coreMarker)) {
		throw new Error(`[ensure-win-core] launcher.exe still missing under ${distDir}`);
	}
	console.log(`[ensure-win-core] extracted core into ${distDir}`);
}

const binCli = join(electrobunRoot, "bin", "electrobun.exe");
const cacheDir = join(electrobunRoot, ".cache");
const cacheCli = join(cacheDir, "electrobun.exe");

if (existsSync(binCli)) {
	console.log(`[ensure-win-core] CLI OK ${binCli}`);
	process.exit(0);
}

if (existsSync(cacheCli)) {
	mkdirSync(dirname(binCli), { recursive: true });
	copyFileSync(cacheCli, binCli);
	console.log(`[ensure-win-core] CLI copied from cache to ${binCli}`);
	process.exit(0);
}

await downloadAndExtract(
	`${releaseBase}/electrobun-cli-win-x64.tar.gz`,
	cacheDir,
	"cli-win-x64-temp.tar.gz",
);

if (!existsSync(cacheCli)) {
	throw new Error(`[ensure-win-core] electrobun.exe still missing under ${cacheDir}`);
}

mkdirSync(dirname(binCli), { recursive: true });
copyFileSync(cacheCli, binCli);
console.log(`[ensure-win-core] CLI ready at ${binCli}`);

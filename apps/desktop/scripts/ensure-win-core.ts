/**
 * Electrobun downloads platform core (dist-win-x64) lazily on `electrobun build`.
 * Our icon embed must run before that copy, so CI fresh installs need core first.
 * Mirrors electrobun's core tarball fetch (does not upgrade Electrobun).
 */
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
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

const distDir = join(electrobunRoot, "dist-win-x64");
const marker = join(distDir, "launcher.exe");
if (existsSync(marker)) {
	console.log(`[ensure-win-core] OK ${marker}`);
	process.exit(0);
}

const pkg = require(join(electrobunRoot, "package.json")) as { version: string };
const version = `v${pkg.version}`;
const url = `https://github.com/blackboardsh/electrobun/releases/download/${version}/electrobun-core-win-x64.tar.gz`;
const tempFile = join(electrobunRoot, "core-win-x64-temp.tar.gz");

console.log(`[ensure-win-core] missing templates; downloading ${url}`);
mkdirSync(distDir, { recursive: true });

const res = await fetch(url);
if (!res.ok || !res.body) {
	throw new Error(`[ensure-win-core] download failed: ${res.status} ${res.statusText}`);
}

await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tempFile));

const tarBytes = await Bun.file(tempFile).arrayBuffer();
const archive = new Bun.Archive(tarBytes);
await archive.extract(distDir);
unlinkSync(tempFile);

if (!existsSync(marker)) {
	throw new Error(`[ensure-win-core] launcher.exe still missing under ${distDir}`);
}
console.log(`[ensure-win-core] extracted core into ${distDir}`);

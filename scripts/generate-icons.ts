/**
 * Optional: regenerate derived assets from platform icon sources.
 *
 * Source of truth (user-provided):
 *   windows/icon-256x256px.ico
 *   macOS/AppIcon.iconset/
 *   linux/icon.png (512px; also ships small 16/24 PNGs)
 *
 * Electrobun wiring is in electrobun.config.ts — run this script only if you
 * need to refresh src/mainview favicons / assets/ copies from those sources.
 *
 * On Windows: copies files with PowerShell-friendly Node fs APIs (no sips).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const macSet = join(root, "macOS/AppIcon.iconset");
const winIco = join(root, "windows/icon-256x256px.ico");
const linuxIcon = join(root, "linux/icon.png");
const assets = join(root, "assets");
const mainview = join(root, "src/mainview");
const mainAssets = join(mainview, "assets");

function requireFile(path: string, label: string) {
	if (!existsSync(path)) {
		console.error(`Missing ${label}: ${path}`);
		process.exit(1);
	}
}

requireFile(winIco, "Windows ICO");
requireFile(join(macSet, "icon_512x512.png"), "macOS 512 PNG");
requireFile(linuxIcon, "Linux PNG");

mkdirSync(join(assets, "icon.iconset"), { recursive: true });
mkdirSync(mainAssets, { recursive: true });

copyFileSync(winIco, join(assets, "icon.ico"));
copyFileSync(linuxIcon, join(assets, "icon.png"));

const iconsetNames = [
	"icon_16x16.png",
	"icon_16x16@2x.png",
	"icon_32x32.png",
	"icon_32x32@2x.png",
	"icon_128x128.png",
	"icon_128x128@2x.png",
	"icon_256x256.png",
	"icon_256x256@2x.png",
	"icon_512x512.png",
	"icon_512x512@2x.png",
];
for (const name of iconsetNames) {
	const src = join(macSet, name);
	if (existsSync(src)) copyFileSync(src, join(assets, "icon.iconset", name));
}

copyFileSync(join(macSet, "icon_128x128.png"), join(mainAssets, "app-icon.png"));
copyFileSync(join(macSet, "icon_32x32.png"), join(mainview, "favicon-32x32.png"));
copyFileSync(join(macSet, "icon_256x256.png"), join(mainview, "apple-touch-icon.png"));

console.log("Synced assets/ and mainview icons from windows/ + macOS/ + linux/");
console.log("On macOS, optionally: iconutil -c icns macOS/AppIcon.iconset");

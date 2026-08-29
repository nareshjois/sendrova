/**
 * Rebuild assets/icon.iconset, icon.ico, and icon.png from the 1024px macOS source.
 * Also refreshes mainview favicons.
 *
 * Requires: macOS `sips` + `iconutil`, Python 3 with Pillow.
 */
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const src = join(root, "macOS/AppIcon.appiconset/1024.png");
const assets = join(root, "assets");
const iconset = join(assets, "icon.iconset");
const mainview = join(root, "src/mainview");

mkdirSync(iconset, { recursive: true });

const sizes: Array<[string, number]> = [
	["icon_16x16.png", 16],
	["icon_16x16@2x.png", 32],
	["icon_32x32.png", 32],
	["icon_32x32@2x.png", 64],
	["icon_128x128.png", 128],
	["icon_128x128@2x.png", 256],
	["icon_256x256.png", 256],
	["icon_256x256@2x.png", 512],
	["icon_512x512.png", 512],
	["icon_512x512@2x.png", 1024],
];

for (const [name, px] of sizes) {
	const r = spawnSync(
		"sips",
		["-z", String(px), String(px), src, "--out", join(iconset, name)],
		{ stdio: "inherit" },
	);
	if (r.status !== 0) process.exit(r.status ?? 1);
}

copyFileSync(join(iconset, "icon_512x512.png"), join(assets, "icon.png"));

const py = `
from pathlib import Path
import struct, io
from PIL import Image

src = Path(${JSON.stringify(src)})
out = Path(${JSON.stringify(join(assets, "icon.ico"))})
img = Image.open(src).convert("RGBA")
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
frames = [img.resize(s, Image.Resampling.LANCZOS) for s in sizes]

def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()

count = len(frames)
header = struct.pack("<HHH", 0, 1, count)
entries = []
data = b""
offset = 6 + 16 * count
for im in frames:
    w, h = im.size
    payload = png_bytes(im)
    entries.append(struct.pack(
        "<BBBBHHII",
        w if w < 256 else 0,
        h if h < 256 else 0,
        0, 0, 1, 32,
        len(payload), offset,
    ))
    data += payload
    offset += len(payload)
out.write_bytes(header + b"".join(entries) + data)
print(f"wrote {out} ({out.stat().st_size} bytes)")
`;

const pyRun = spawnSync("python3", ["-c", py], { stdio: "inherit" });
if (pyRun.status !== 0) process.exit(pyRun.status ?? 1);

copyFileSync(join(assets, "icon.ico"), join(mainview, "favicon.ico"));
spawnSync(
	"sips",
	[
		"-z",
		"32",
		"32",
		src,
		"--out",
		join(mainview, "favicon-32x32.png"),
	],
	{ stdio: "inherit" },
);
spawnSync(
	"sips",
	["-z", "180", "180", src, "--out", join(mainview, "apple-touch-icon.png")],
	{ stdio: "inherit" },
);

const icnsCheck = spawnSync(
	"iconutil",
	["-c", "icns", "-o", "/tmp/Sendrova-check.icns", iconset],
	{ stdio: "inherit" },
);
if (icnsCheck.status !== 0) process.exit(icnsCheck.status ?? 1);

console.log("Icons ready under assets/ and src/mainview/");

// Draws the Truefit app icon and the menu-bar glyph (a fit ring with a tick) with a tiny software rasteriser, so the icons are reproducible from code and need no design tool.
//   node scripts/make-icons.ts   ->  assets/icon.icns (via iconutil), assets/icon.png, assets/trayTemplate.png and @2x
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// Geometry in a 48 x 48 design space (the same numbers as the BrandMark in the app).
const CX = 24, CY = 24, R = 17, RING_W = 6, TICK_W = 4.2;
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
const arcPt = (deg: number) => [CX + R * Math.cos((deg * Math.PI) / 180), CY + R * Math.sin((deg * Math.PI) / 180)];
const A0 = -90, A1 = 160; // the arc runs clockwise from the top round to the lower left (about 70% of the ring)
const inArc = (px: number, py: number) => { const d = Math.abs(Math.hypot(px - CX, py - CY) - R); if (d > RING_W / 2) return false; let a = (Math.atan2(py - CY, px - CX) * 180) / Math.PI; if (a < A0) a += 360; return a >= A0 && a <= A1 + (A0 < -180 ? 360 : 0) ? true : a <= A1; };
const capsEnds = [arcPt(A0), arcPt(A1)];
const coverage = (name: "arc" | "track" | "tick", x: number, y: number) => {
  if (name === "track") return Math.abs(Math.hypot(x - CX, y - CY) - R) <= RING_W / 2;
  if (name === "arc") return inArc(x, y) || capsEnds.some(([ex, ey]) => Math.hypot(x - ex, y - ey) <= RING_W / 2);
  return segDist(x, y, 17, 24.5, 22, 29.5) <= TICK_W / 2 || segDist(x, y, 22, 29.5, 31, 19.5) <= TICK_W / 2;
};
type Rgb = [number, number, number];
function draw(size: number, o: { bg?: Rgb | null; track: Rgb | null; arc: Rgb; tick: Rgb; scale: number; body?: number }): Buffer {
  const body = o.body ?? 1; // the share of the canvas the icon square fills (Apple's grid: 824 of 1024, the rest is transparent margin)
  const out = new Uint8Array(size * size * 4), SS = 4;
  const corner = 0.2237 * 48 * body; // the macOS icon corner (a continuous curve in the real grid; a plain rounded square is close enough at these sizes)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const gx = (x + (sx + 0.5) / SS) * (48 / size), gy = (y + (sy + 0.5) / SS) * (48 / size), dx = (gx - 24) / (o.scale * body) + 24, dy = (gy - 24) / (o.scale * body) + 24; // the mark is drawn smaller than the icon square by 1/scale
      let col: Rgb | null = null;
      if (o.bg) { const qx = Math.abs(gx - 24) - (24 * body - corner), qy = Math.abs(gy - 24) - (24 * body - corner); if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= corner) col = o.bg; }
      if (o.track && coverage("track", dx, dy)) col = o.track; if (coverage("arc", dx, dy)) col = o.arc; if (coverage("tick", dx, dy)) col = o.tick;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a++; }
    }
    const i = (y * size + x) * 4; out[i] = a ? r / a : 0; out[i + 1] = a ? g / a : 0; out[i + 2] = a ? b / a : 0; out[i + 3] = Math.round((a / (SS * SS)) * 255);
  }
  return png(size, size, out);
}
const CHARCOAL: Rgb = [17, 17, 17], GREY: Rgb = [92, 92, 92], CORAL: Rgb = [245, 245, 245], OFF: Rgb = [242, 242, 244], BLACK: Rgb = [0, 0, 0];
mkdirSync(assets, { recursive: true });
const set = path.join(assets, "icon.iconset"); rmSync(set, { recursive: true, force: true }); mkdirSync(set);
for (const [name, size] of [["16x16", 16], ["16x16@2x", 32], ["32x32", 32], ["32x32@2x", 64], ["128x128", 128], ["128x128@2x", 256], ["256x256", 256], ["256x256@2x", 512], ["512x512", 512], ["512x512@2x", 1024]] as [string, number][])
  writeFileSync(path.join(set, `icon_${name}.png`), draw(size, { bg: CHARCOAL, track: GREY, arc: CORAL, tick: OFF, scale: 0.78, body: 824 / 1024 }));
writeFileSync(path.join(assets, "icon.png"), draw(1024, { bg: CHARCOAL, track: GREY, arc: CORAL, tick: OFF, scale: 0.78, body: 824 / 1024 }));
execFileSync("/usr/bin/iconutil", ["-c", "icns", set, "-o", path.join(assets, "icon.icns")]); rmSync(set, { recursive: true, force: true });
// the menu-bar glyph: black on transparent (macOS tints a "template" image for light and dark bars)
writeFileSync(path.join(assets, "trayTemplate.png"), draw(18, { bg: null, track: null, arc: BLACK, tick: BLACK, scale: 1 }));
writeFileSync(path.join(assets, "trayTemplate@2x.png"), draw(36, { bg: null, track: null, arc: BLACK, tick: BLACK, scale: 1 }));
console.log("icons written to assets/");

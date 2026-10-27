// Generates the app's icon set from the 8-bit mark.
//
// **Why this exists at all.** The only icon this app had was a single 32x32
// BMP inside an `.ico`. That is enough for Windows and nothing like enough for
// Linux packaging, which wants sizes up to 512 — and upscaling 32x32 looks
// exactly as bad as it sounds. `tauri-build` also wants an `icon.png` that was
// never there, which is the documented reason the CI workflow has always been
// Windows-only.
//
// **Why there is no image library here.** The mark is eight pixels by eight of
// flat colour, so "rasterising" it is filling squares — a dependency to do that
// would be a dependency to run a nested loop. Every size is generated from the
// same grid, so the icon cannot drift between platforms, and PNG is written
// directly using zlib, which Node already has.
//
// **Nearest-neighbour on purpose.** Every output size is a whole multiple of 8,
// and each source pixel becomes an exact block. Smoothing it would turn a
// deliberate 8-bit mark into a blurry one, which is the single way this design
// can look like a mistake.
//
// Run with: node make-icons.mjs
import { deflateSync } from "node:zlib";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The four environment colours, as the website's mark and the app's tabs use
// them: Product, Develop, Test, Admin.
const INK = [0x12, 0x15, 0x1a];
const PRODUCT = [0x8b, 0x5c, 0xf6];
const DEVELOP = [0x14, 0xb8, 0xa6];
const TEST = [0xf5, 0x9e, 0x0b];
const ADMIN = [0xf4, 0x3f, 0x5e];

// A "C", read top to bottom through the four colours. `.` is the dark ground.
// Kept as text because that is the one form in which a mistake is visible.
const GRID = [
  "........",
  "..PPPD..",
  ".P....D.",
  ".D......",
  ".T......",
  ".A....A.",
  "..AAAA..",
  "........",
];
const COLOURS = { ".": INK, P: PRODUCT, D: DEVELOP, T: TEST, A: ADMIN };

/** CRC-32, which every PNG chunk carries and Node does not provide. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** The mark at `size` pixels square, as a PNG. */
function png(size) {
  const scale = size / GRID.length;
  if (!Number.isInteger(scale)) {
    throw new Error(`${size} is not a whole multiple of ${GRID.length}`);
  }

  // RGBA, one filter byte per row — filter 0, "none", because flat colour
  // gains nothing from prediction and this stays readable.
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    const row = GRID[Math.floor(y / scale)];
    for (let x = 0; x < size; x++) {
      const [r, g, b] = COLOURS[row[Math.floor(x / scale)]];
      const at = y * stride + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An `.ico` wrapping PNG entries — which the format has allowed since Vista,
 *  and which keeps one encoder rather than a second one for BMP. */
function ico(sizes) {
  const images = sizes.map((s) => ({ size: s, data: png(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const e = Buffer.alloc(16);
    // 0 means 256 in this format; every size here is smaller than that.
    e[0] = image.size === 256 ? 0 : image.size;
    e[1] = image.size === 256 ? 0 : image.size;
    e[4] = 1; // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32BE(0, 8);
    e.writeUInt32LE(image.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += image.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// The set Tauri looks for. `icon.png` is the one whose absence kept every
// non-Windows build from ever running.
const WANTED = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];

for (const [name, size] of WANTED) {
  await fs.writeFile(path.join(here, name), png(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
await fs.writeFile(path.join(here, "icon.ico"), ico([16, 32, 48, 256]));
console.log("wrote icon.ico (16, 32, 48, 256)");

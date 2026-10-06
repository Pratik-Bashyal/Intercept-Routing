// One-off: generate PWA icons (brand "intercept target" mark) as PNGs.
// Pure Node (zlib only) — no deps. Run: node src/makeIcons.js  then delete.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "public");

// --- tiny PNG encoder (RGBA, 8-bit) ---
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- draw the icon: blue rounded square + white target (rings + crosshair) ---
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.46;          // background rounded-square radius influence
  const corner = size * 0.22;     // rounding
  const ring1 = size * 0.30, ring2 = size * 0.185; // target rings
  const ringW = size * 0.055;
  const crossLen = size * 0.40, crossW = size * 0.045;
  // brand blue
  const bg = [26, 115, 232], white = [255, 255, 255];

  const inRounded = (x, y) => {
    const m = size * 0.06; // margin
    const lx = m, rx = size - m, ty = m, by = size - m;
    if (x < lx || x > rx || y < ty || y > by) return false;
    // rounded corners
    const dxl = lx + corner, dxr = rx - corner, dyt = ty + corner, dyb = by - corner;
    let ccx = null, ccy = null;
    if (x < dxl && y < dyt) { ccx = dxl; ccy = dyt; }
    else if (x > dxr && y < dyt) { ccx = dxr; ccy = dyt; }
    else if (x < dxl && y > dyb) { ccx = dxl; ccy = dyb; }
    else if (x > dxr && y > dyb) { ccx = dxr; ccy = dyb; }
    if (ccx != null) return (x - ccx) ** 2 + (y - ccy) ** 2 <= corner * corner;
    return true;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = null, a = 0;
      if (inRounded(x + 0.5, y + 0.5)) { col = bg; a = 255; }
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      // outer ring
      if (Math.abs(r - ring1) <= ringW / 2) { col = white; a = 255; }
      // inner ring
      if (Math.abs(r - ring2) <= ringW / 2) { col = white; a = 255; }
      // center dot
      if (r <= size * 0.055) { col = white; a = 255; }
      // crosshair arms
      if (Math.abs(dy) <= crossW / 2 && Math.abs(dx) <= crossLen / 2) { col = white; a = 255; }
      if (Math.abs(dx) <= crossW / 2 && Math.abs(dy) <= crossLen / 2) { col = white; a = 255; }
      if (col) { buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = a; }
      else { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0; }
    }
  }
  return png(size, size, buf);
}

for (const s of [192, 512]) {
  const file = path.join(OUT, `icon-${s}.png`);
  fs.writeFileSync(file, makeIcon(s));
  console.log("wrote", file);
}
// maskable (same art, safe padding already included)
fs.writeFileSync(path.join(OUT, "icon-maskable-512.png"), makeIcon(512));
console.log("done");

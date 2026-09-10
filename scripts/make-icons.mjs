#!/usr/bin/env node
/**
 * Generate the favicon and launcher icons from the brand mark.
 *
 * These used to be a synthetic mark drawn in code - a rounded square, a curve
 * and a dot - because there was no logo yet. There is one now, so the icons are
 * derived from `public/brand/accesspafos-mark.png` instead. That matters beyond
 * looking right: a generator that still drew the old shapes would silently
 * replace the real icons with the placeholder the next time anyone ran
 * `npm run icons`.
 *
 * Still dependency-free. Reading a PNG needs an inflate, which Node has, plus
 * the un-filtering below; writing one needs the deflate and CRC at the bottom.
 * That is about a hundred lines against a native imaging dependency in
 * `npm install`, for an asset that is regenerated roughly never.
 *
 * The icons are a solid brand tile with the mark knocked out in white, rather
 * than the mark on white. A favicon sits on browser chrome that is already
 * white, and a home-screen icon sits on whatever wallpaper the phone has: an
 * icon with no edge of its own disappears into both. iOS also composites an
 * `apple-touch-icon` onto black, so transparency there is not an option at all.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'icons');
const markPath = join(root, 'public', 'brand', 'accesspafos-mark.png');

/** The tile, and the mark knocked out of it. */
const BRAND = [0x14, 0x89, 0xb8];
const KNOCKOUT = [0xff, 0xff, 0xff];

// --- reading -----------------------------------------------------------------

/**
 * Decode an 8-bit RGBA PNG.
 *
 * Deliberately narrow: it handles the one file this script reads and refuses
 * anything else by name rather than by producing a subtly wrong image. A
 * palette or 16-bit export of the mark should fail loudly here, not silently
 * come out looking odd at 32 pixels where nobody would notice.
 */
function decodePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => buffer[i] === byte)) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`expected an 8-bit PNG, got ${data[8]}-bit`);
      if (data[9] !== 6) throw new Error(`expected RGBA (colour type 6), got type ${data[9]}`);
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;                    // length + type + data + CRC
  }

  return { width, height, pixels: unfilter(inflateSync(Buffer.concat(idat)), width, height) };
}

/**
 * Undo the per-scanline filters PNG applies before compression.
 *
 * Each row is prefixed with a filter byte describing how it was encoded against
 * the row above and the pixel to the left; this reverses all five.
 */
function unfilter(raw, width, height) {
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let value = line[x];

      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);

      out[y * stride + x] = value & 0xff;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// --- drawing -----------------------------------------------------------------

/**
 * Box-average downscale.
 *
 * Every target here is smaller than the 512px source, and averaging the source
 * pixels that fall inside each destination pixel is both the correct filter for
 * that direction and the simplest. Point sampling would shred the mark's thin
 * strokes - the hair, the castle crenellations - at 32 pixels.
 *
 * Alpha-weighted, so the transparent surround does not bleed white into the
 * edges of the strokes.
 */
function downscale(src, srcSize, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = srcSize / size;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(srcSize, Math.ceil((y + 1) * scale));

    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(srcSize, Math.ceil((x + 1) * scale));

      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * srcSize + sx) * 4;
          const alpha = src[i + 3] / 255;
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += src[i + 3];
          n += 1;
        }
      }

      const i = (y * size + x) * 4;
      const weight = a / 255 || 1;            // avoid dividing by a fully clear box
      out[i] = Math.round(r / weight);
      out[i + 1] = Math.round(g / weight);
      out[i + 2] = Math.round(b / weight);
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * A brand tile with the mark centred on it.
 *
 * `inset` is the share of the icon left as margin on each side. Maskable icons
 * get a much larger one: Android may crop them to any shape inside a circle of
 * 80% of the width, so anything outside that can be cut off.
 */
function compose(size, mark, markSize, inset) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = BRAND[0];
    pixels[i * 4 + 1] = BRAND[1];
    pixels[i * 4 + 2] = BRAND[2];
    pixels[i * 4 + 3] = 255;
  }

  const inner = Math.round(size * (1 - 2 * inset));
  const scaled = downscale(mark, markSize, inner);
  const origin = Math.round((size - inner) / 2);

  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const alpha = scaled[(y * inner + x) * 4 + 3] / 255;
      if (alpha === 0) continue;

      const i = ((y + origin) * size + (x + origin)) * 4;
      for (let c = 0; c < 3; c += 1) {
        pixels[i + c] = Math.round(pixels[i + c] * (1 - alpha) + KNOCKOUT[c] * alpha);
      }
    }
  }
  return pixels;
}

// --- writing -----------------------------------------------------------------

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;              // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;                                // bit depth
  ihdr[9] = 6;                                // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- run ---------------------------------------------------------------------

const mark = decodePng(readFileSync(markPath));
if (mark.width !== mark.height) throw new Error('the brand mark must be square');

mkdirSync(outDir, { recursive: true });

const targets = [
  // Favicons. The mark is given less margin the smaller the icon gets: at 16px
  // the tile edge is the only thing still legible, so it should not eat a
  // quarter of the pixels.
  { name: 'icon-16.png', size: 16, inset: 0.04 },
  { name: 'icon-32.png', size: 32, inset: 0.06 },
  { name: 'icon-48.png', size: 48, inset: 0.07 },
  // Home screen.
  { name: 'icon-180.png', size: 180, inset: 0.10 },
  { name: 'icon-192.png', size: 192, inset: 0.10 },
  { name: 'icon-512.png', size: 512, inset: 0.10 },
  // Android may crop a maskable icon to any shape inside the central 80%.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.20 }
];

for (const target of targets) {
  const png = encodePng(target.size, compose(target.size, mark.pixels, mark.width, target.inset));
  writeFileSync(join(outDir, target.name), png);
  console.log(`[icons] ${target.name} (${target.size}×${target.size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

// Tiny PNG reader and image measurements for the stylized scene checks. Node standard library only (zlib), no Pillow or sharp.
// decodePng reads 8-bit grey, RGB, RGBA and indexed PNGs without interlacing, which is what the engine screenshot writer produces.
// Measurements: distinct luminance bands inside a region, pixel counts near a colour, and a silhouette against the backdrop.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0, palette = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported colour type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 6) [r, g, b, a] = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]];
    else if (colorType === 2) [r, g, b] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
    else if (colorType === 0) r = g = b = out[i];
    else if (colorType === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else [r, g, b] = [palette[out[i] * 3], palette[out[i] * 3 + 1], palette[out[i] * 3 + 2]];
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba };
}

export const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
export const pixel = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };

/** Pixels whose colour differs from `bg` by more than `tolerance` in any channel, inside the region (default: whole image). */
export function foreground(img, bg, tolerance = 10, region = { x0: 0, y0: 0, x1: img.width, y1: img.height }) {
  const hits = [];
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    const p = pixel(img, x, y);
    if (Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2])) > tolerance) hits.push({ x, y, p });
  }
  return hits;
}

/**
 * Flat luminance bands among pixels. A flat level is an 8-bit luminance value that holds at least `minShare` of the pixels; flat levels
 * within `gap` empty values of each other form one band (a flat colour region spreads over a value or two after tone mapping). A
 * smooth gradient has no flat level, a stepped ramp has one band per step. `levels` counts the values holding at least `minShare / 4`
 * of the pixels, so a gradient reports many levels and a stepped ramp few.
 */
export function luminanceBands(pixels, { minShare = 0.07, gap = 1 } = {}) {
  const hist = new Array(256).fill(0);
  for (const { p } of pixels) hist[luma(p[0], p[1], p[2])]++;
  const total = pixels.length || 1, runs = [];
  let run = null;
  for (let v = 0; v < 256; v++) {
    if (hist[v] / total < minShare) continue;
    if (run && v - run.to <= gap + 1) { run.to = v; run.count += hist[v]; }
    else { if (run) runs.push(run); run = { from: v, to: v, count: hist[v] }; }
  }
  if (run) runs.push(run);
  const levels = hist.filter((c) => c / total >= minShare / 4).length;
  return { bands: runs.length, levels, total: pixels.length, runs: runs.map((r) => ({ from: r.from, to: r.to, share: +(r.count / total).toFixed(3) })) };
}

/** Number of pixels within `tolerance` (per channel) of `color`, inside the region. */
export function countNear(img, color, tolerance = 6, region = { x0: 0, y0: 0, x1: img.width, y1: img.height }) {
  let n = 0;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    const p = pixel(img, x, y);
    if (Math.abs(p[0] - color[0]) <= tolerance && Math.abs(p[1] - color[1]) <= tolerance && Math.abs(p[2] - color[2]) <= tolerance) n++;
  }
  return n;
}

/** A stable short fingerprint of a region, used to tell whether two frames differ. */
export function regionHash(img, region) {
  let h = 2166136261;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    const i = (y * img.width + x) * 4;
    for (let c = 0; c < 3; c++) h = Math.imul(h ^ img.rgba[i + c], 16777619) >>> 0;
  }
  return h.toString(16);
}

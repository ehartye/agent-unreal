import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function safeRelativePath(path) {
  return typeof path === 'string' && path.length > 0 && !/[\\:\x00-\x1f]/.test(path) && !path.startsWith('/') && path.split('/').every((part) => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}

/** Filesystem boundary: every segment stays under root and no symlink is followed. */
export function readArtifact(root, path) {
  if (!safeRelativePath(path)) throw new Error('unsafe relative artifact path');
  const base = realpathSync(root);
  let current = base;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('symbolic link artifact refused');
  }
  const real = realpathSync(current), rel = relative(base, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== real || !lstatSync(real).isFile()) throw new Error('artifact is not a contained regular file');
  return readFileSync(real);
}

/** Enumerate copied plugin inputs, including additions; generated engine output is outside this scope. */
export function collectSourceFiles(root, manifest) {
  const files = Object.fromEntries(manifest.files.map(({ path }) => {
    try { return [path, readArtifact(root, path)]; } catch { return [path, null]; }
  }));
  const walk = (path) => {
    const absolute = resolve(root, path);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error('source symbolic link refused');
    if (lstatSync(absolute).isDirectory()) for (const child of readdirSync(absolute)) walk(`${path}/${child}`);
    else files[path] = readArtifact(root, path);
  };
  for (const directory of ['Source', 'Config', 'Resources', 'Content']) if (existsSync(resolve(root, directory))) walk(directory);
  for (const path of readdirSync(root)) if (path.toLowerCase().endsWith('.uplugin')) walk(path);
  return files;
}

/** PCM16 or IEEE float32 WAV, interleaved channels; malformed/truncated chunks fail. */
export function readWav(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' || data.readUInt32LE(4) + 8 !== data.length) throw new Error('audio_truncated_or_invalid');
  let fmt, pcm;
  for (let cursor = 12; cursor < data.length;) {
    if (cursor + 8 > data.length) throw new Error('audio_truncated_or_invalid');
    const kind = data.toString('ascii', cursor, cursor + 4), size = data.readUInt32LE(cursor + 4), start = cursor + 8;
    if (start + size > data.length) throw new Error('audio_truncated_or_invalid');
    if (kind === 'fmt ') {
      if (fmt || size < 16) throw new Error('audio_format_invalid');
      fmt = { format: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), sampleRate: data.readUInt32LE(start + 4), byteRate: data.readUInt32LE(start + 8), align: data.readUInt16LE(start + 12), bits: data.readUInt16LE(start + 14) };
    }
    if (kind === 'data') { if (pcm) throw new Error('audio_duplicate_data'); pcm = data.subarray(start, start + size); }
    cursor = start + size + (size % 2);
    if (cursor > data.length) throw new Error('audio_truncated_or_invalid');
  }
  if (!fmt || !pcm || !fmt.channels || !fmt.sampleRate || !((fmt.format === 1 && fmt.bits === 16) || (fmt.format === 3 && fmt.bits === 32)) || fmt.align !== fmt.channels * fmt.bits / 8 || fmt.byteRate !== fmt.sampleRate * fmt.align || pcm.length % fmt.align) throw new Error('audio_format_invalid');
  const samples = Array.from({ length: pcm.length / (fmt.bits / 8) }, (_, index) => fmt.format === 1 ? pcm.readInt16LE(index * 2) / 32768 : pcm.readFloatLE(index * 4));
  if (samples.some((value) => !Number.isFinite(value) || Math.abs(value) > 1)) throw new Error('audio_samples_invalid');
  return { sample_rate: fmt.sampleRate, channels: fmt.channels, frame_count: samples.length / fmt.channels, samples };
}

export function rmsDb(wav, startFrame, frameCount) {
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(frameCount) || startFrame < 0 || frameCount < 1 || startFrame + frameCount > wav.frame_count) throw new Error('audio_truncated');
  const lo = startFrame * wav.channels, hi = (startFrame + frameCount) * wav.channels;
  let square = 0;
  for (let i = lo; i < hi; i++) square += wav.samples[i] ** 2 / (hi - lo);
  return 10 * Math.log10(Math.max(square, 1e-12));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate an actual bounded 8-bit non-interlaced engine PNG, including CRCs and inflated scanlines. */
export function pngDimensions(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('capture_invalid_png');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[25]];
  if (!width || !height || width * height > 64 * 1024 * 1024 || data[24] !== 8 || !channels || data[26] || data[27] || data[28]) throw new Error('capture_png_format_unsupported');
  let cursor = 8, ended = false, headerCount = 0;
  const compressed = [];
  while (cursor + 12 <= data.length) {
    const length = data.readUInt32BE(cursor), kind = data.toString('ascii', cursor + 4, cursor + 8);
    if (cursor + 12 + length > data.length) throw new Error('capture_truncated');
    if (crc32(data.subarray(cursor + 4, cursor + 8 + length)) !== data.readUInt32BE(cursor + 8 + length)) throw new Error('capture_png_crc');
    if (kind === 'IHDR') headerCount++;
    if (kind === 'IDAT') compressed.push(data.subarray(cursor + 8, cursor + 8 + length));
    cursor += 12 + length;
    if (kind === 'IEND') { ended = length === 0 && cursor === data.length; break; }
  }
  if (headerCount !== 1 || !compressed.length || !ended) throw new Error('capture_truncated');
  const stride = width * channels + 1, expected = height * stride;
  let raw;
  try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { throw new Error('capture_png_pixels_invalid'); }
  if (raw.length !== expected) throw new Error('capture_png_pixels_invalid');
  for (let y = 0; y < height; y++) if (raw[y * stride] > 4) throw new Error('capture_png_filter_invalid');
  return { width, height };
}

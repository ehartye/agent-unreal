// Prepared 2026-10-26; not yet run on an engine. Pure helpers of the opt-in Niagara probes (nts_probe.mjs): the sample assets the wire group imports, a small PNG reader for the
// screenshots, and a built-in static cube. No Unreal, no engine; nts-probe.test.mjs covers all of it. Node standard library only.
//   atlasGrid(json)         the cell grid of an Aseprite-style atlas, for the Sub Image Size
//   resolveWireAssets(...)  where the GLB and the atlas are, or why they are not
//   cubeGlb()               a valid binary glTF with one cube, so the mesh chain does not depend on a rigged sample model
//   decodePng / changedPixels / encodePng   screenshot comparison
import { inflateSync, deflateSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * The grid an atlas image is cut into, for the sprite renderer's Sub Image Size. The atlas JSON lists raw cells, each tag's frames and
 * named cells together, so rectangles repeat and sizes can differ; the grid is read from the cells of the most common size.
 * @param {any} atlas  parsed Aseprite-style JSON ({ frames: [{ frame: {x, y, w, h} }] | { name: { frame } }, meta: { size: {w, h} } })
 * @returns {{ error: string } | { cols: number, rows: number, cellW: number, cellH: number, cells: number, ignored: number, sheetW: number|null, sheetH: number|null, full: boolean, powerOfTwo: boolean|null }}
 */
export function atlasGrid(atlas) {
  const list = Array.isArray(atlas && atlas.frames) ? atlas.frames : Object.values((atlas && atlas.frames) || {});
  const rects = list.map((f) => f && f.frame).filter((r) => r && [r.x, r.y, r.w, r.h].every(Number.isInteger) && r.w > 0 && r.h > 0);
  if (rects.length === 0) return { error: 'the atlas JSON has no frames with integer x, y, w and h' };
  const sizes = new Map();
  for (const r of rects) sizes.set(`${r.w}x${r.h}`, (sizes.get(`${r.w}x${r.h}`) || 0) + 1);
  const [common] = [...sizes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const [cellW, cellH] = common.split('x').map(Number);
  const same = rects.filter((r) => r.w === cellW && r.h === cellH);
  const cells = new Set(same.map((r) => `${r.x},${r.y}`));
  const xs = [...new Set(same.map((r) => r.x))].sort((a, b) => a - b), ys = [...new Set(same.map((r) => r.y))].sort((a, b) => a - b);
  const regular = xs.every((x, i) => x === xs[0] + i * cellW) && ys.every((y, i) => y === ys[0] + i * cellH);
  if (!regular) return { error: `the ${cellW}x${cellH} cells do not sit on a regular grid (x: ${xs.join(',')}; y: ${ys.join(',')})` };
  const size = atlas.meta && atlas.meta.size, sheetW = size && Number.isInteger(size.w) ? size.w : null, sheetH = size && Number.isInteger(size.h) ? size.h : null;
  const cols = xs.length, rows = ys.length;
  if (sheetW !== null && sheetH !== null && (cols * cellW !== sheetW || rows * cellH !== sheetH)) {
    return { error: `${cols}x${rows} cells of ${cellW}x${cellH} do not cover the ${sheetW}x${sheetH} sheet; Sub Image Size cuts the whole image evenly` };
  }
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  return { cols, rows, cellW, cellH, cells: cells.size, ignored: rects.length - same.length, sheetW, sheetH, full: cells.size === cols * rows,
    powerOfTwo: sheetW !== null && sheetH !== null ? pow2(sheetW) && pow2(sheetH) : null };
}

/**
 * Find the files of the wire group. A path option wins over the workspace layout of examples/unreal/README.md
 * (assets/meshes/fox.glb, assets/sprites/campfire.png and campfire.atlas.json under the scenes folder). `--glb builtin` imports only
 * the built-in cube. The built-in cube is always imported too, because the sample model is rigged and a mesh renderer needs a static mesh.
 * @param {{ scenes?: string, glb?: string, atlasPng?: string, atlasJson?: string }} options
 * @param {{ exists: (p: string) => boolean, readText: (p: string) => string }} io
 * @returns {{ error?: string, problems: string[], meshes: { id: string, path: string, skinned: boolean }[], atlas?: { png: string, json: string, grid: object } }}
 */
export function resolveWireAssets(options, io) {
  const problems = [], meshes = [];
  const { scenes, glb, atlasPng, atlasJson } = options;
  const under = (...parts) => (scenes ? join(scenes, ...parts) : undefined);
  const wantBuiltinOnly = glb === 'builtin';
  const glbPath = wantBuiltinOnly ? undefined : glb || under('assets', 'meshes', 'fox.glb');
  const png = atlasPng || under('assets', 'sprites', 'campfire.png'), json = atlasJson || under('assets', 'sprites', 'campfire.atlas.json');
  const need = [];
  if (!wantBuiltinOnly && !glbPath) need.push('--glb <file> (or builtin)');
  if (!png) need.push('--atlas-png <file>');
  if (!json) need.push('--atlas-json <file>');
  if (need.length) problems.push(`no ${scenes ? 'path' : 'scenes folder'} for ${need.join(', ')}: pass them, or pass --scenes <folder> (or set AGENT_UNREAL_SCENES) with the layout in examples/unreal/README.md`);
  for (const [what, path] of [['GLB', glbPath], ['atlas image', png], ['atlas JSON', json]]) {
    if (path && !io.exists(path)) problems.push(`${what} not found: ${path}`);
  }
  let grid;
  if (json && io.exists(json)) {
    try {
      grid = atlasGrid(JSON.parse(io.readText(json)));
      if (grid.error) problems.push(`atlas JSON ${json}: ${grid.error}`);
    } catch (error) {
      problems.push(`atlas JSON ${json} is not valid JSON: ${error.message}`);
    }
  }
  if (glbPath) meshes.push({ id: 'sample', path: glbPath, skinned: true });
  meshes.push({ id: 'builtin', path: '', skinned: false });   // the runner writes the cube and fills in the path
  if (problems.length) return { error: problems.join('\n'), problems, meshes };
  return { problems, meshes, atlas: { png, json, grid } };
}

/** A binary glTF 2.0 with one cube (24 vertices with normals, 36 uint16 indices, one orange material). `half` is half the edge length in metres. */
export function cubeGlb(half = 0.5) {
  const faces = [   // outward normal, then four corners counter-clockwise seen from outside
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]]],
    [[0, 1, 0], [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const positions = new Float32Array(24 * 3), normals = new Float32Array(24 * 3), indices = new Uint16Array(36);
  faces.forEach(([normal, corners], f) => {
    corners.forEach((corner, i) => {
      positions.set(corner.map((v) => v * half), (f * 4 + i) * 3);
      normals.set(normal, (f * 4 + i) * 3);
    });
    indices.set([0, 1, 2, 0, 2, 3].map((k) => f * 4 + k), f * 6);
  });
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0', generator: 'nts_probe' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'ProbeCube' }],
    meshes: [{ name: 'ProbeCube', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ name: 'ProbeOrange', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.5, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-half, -half, -half], max: [half, half, half] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 288, target: 34962 },
      { buffer: 0, byteOffset: 288, byteLength: 288, target: 34962 },
      { buffer: 0, byteOffset: 576, byteLength: 72, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const jsonChunk = Buffer.from(text), pad = (4 - (bin.length % 4)) % 4, binChunk = Buffer.concat([bin, Buffer.alloc(pad)]);
  const header = Buffer.alloc(12), chunkHead = (length, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.writeUInt32LE(type, 4); return b; };
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  return Buffer.concat([header, chunkHead(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHead(binChunk.length, 0x004e4942), binChunk]);
}

/** Read an 8-bit, non-interlaced grey, RGB, RGBA or indexed PNG (what the engine screenshot writer produces). Throws on anything else. */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0, palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
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

/** A minimal PNG writer (8-bit RGBA, filter 0), for the tests. */
export function encodePng({ width, height, rgba }) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** Number of pixels whose colour differs by more than `tolerance` in any channel; -1 when the images differ in size. */
export function changedPixels(a, b, tolerance = 12) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return -1;
  let n = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    if (Math.max(Math.abs(a.rgba[o] - b.rgba[o]), Math.abs(a.rgba[o + 1] - b.rgba[o + 1]), Math.abs(a.rgba[o + 2] - b.rgba[o + 2])) > tolerance) n++;
  }
  return n;
}

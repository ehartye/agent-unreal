// node tiny_glb.mjs <output folder>
// Writes two minimal valid binary glTF files with no outside assets, for the Interchange import check in ep_friction_validate.mjs:
//   static.glb   three quads in three nodes, three materials (opaque, alphaMode BLEND, alphaMode MASK)
//   skinned.glb  one mesh skinned to two joints, one alphaMode BLEND material, one animation clip named Sway
// Exports buildStatic() and buildSkinned() (each returns a Buffer) so a test can parse the result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pad4 = (buf, fill) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), fill)]));

/** Pack a glTF document and its binary buffer into a .glb (GLB 2.0: header, JSON chunk, BIN chunk). */
export function packGlb(json, bin) {
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad4(bin, 0);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const chunkHead = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'ascii'); return b; };
  return Buffer.concat([head, chunkHead(jsonChunk.length, 'JSON'), jsonChunk, chunkHead(binChunk.length, 'BIN\0'), binChunk]);
}

/** Collects binary blocks and the bufferViews and accessors that describe them. */
class Pack {
  constructor() { this.blocks = []; this.size = 0; this.bufferViews = []; this.accessors = []; }
  add(typedArray, { type, componentType, target, min, max }) {
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const offset = this.size;
    const padded = pad4(bytes, 0);
    this.blocks.push(padded);
    this.size += padded.length;
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) view.target = target;
    this.bufferViews.push(view);
    const count = typedArray.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const accessor = { bufferView: this.bufferViews.length - 1, componentType, count, type };
    if (min) accessor.min = min;
    if (max) accessor.max = max;
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }
  get bin() { return Buffer.concat(this.blocks); }
}

const FLOAT = 5126, USHORT = 5123, UBYTE = 5121, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

function quad(pack, size) {
  const h = size / 2;
  const position = pack.add(new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]),
    { type: 'VEC3', componentType: FLOAT, target: ARRAY_BUFFER, min: [-h, 0, -h], max: [h, 0, h] });
  const normal = pack.add(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), { type: 'VEC3', componentType: FLOAT, target: ARRAY_BUFFER });
  const indices = pack.add(new Uint16Array([0, 2, 1, 0, 3, 2]), { type: 'SCALAR', componentType: USHORT, target: ELEMENT_ARRAY_BUFFER });
  return { position, normal, indices };
}

export function buildStatic() {
  const pack = new Pack();
  const a = quad(pack, 1), b = quad(pack, 1), c = quad(pack, 1);
  const json = {
    asset: { version: '2.0', generator: 'tiny_glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ name: 'Plate', mesh: 0 }, { name: 'Pane', mesh: 1, translation: [2, 0, 0] }, { name: 'Screen', mesh: 2, translation: [4, 0, 0] }],
    meshes: [
      { name: 'Plate', primitives: [{ attributes: { POSITION: a.position, NORMAL: a.normal }, indices: a.indices, material: 0 }] },
      { name: 'Pane', primitives: [{ attributes: { POSITION: b.position, NORMAL: b.normal }, indices: b.indices, material: 1 }] },
      { name: 'Screen', primitives: [{ attributes: { POSITION: c.position, NORMAL: c.normal }, indices: c.indices, material: 2 }] },
    ],
    materials: [
      { name: 'Opaque', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
      { name: 'Glass', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.9, 0.5], metallicFactor: 0, roughnessFactor: 0.2 } },
      { name: 'Cutout', alphaMode: 'MASK', alphaCutoff: 0.5, pbrMetallicRoughness: { baseColorFactor: [0.9, 0.8, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.5 } },
    ],
    accessors: pack.accessors, bufferViews: pack.bufferViews, buffers: [{ byteLength: pack.size }],
  };
  return packGlb(json, pack.bin);
}

export function buildSkinned() {
  const pack = new Pack();
  // a strip of two quads, three rows of vertices at y = 0, 1, 2; the lower joint at y = 0, the upper joint at y = 1
  const rows = [0, 1, 2];
  const positions = rows.flatMap((y) => [-0.5, y, 0, 0.5, y, 0]);
  const position = pack.add(new Float32Array(positions), { type: 'VEC3', componentType: FLOAT, target: ARRAY_BUFFER, min: [-0.5, 0, 0], max: [0.5, 2, 0] });
  const normal = pack.add(new Float32Array(rows.flatMap(() => [0, 0, 1, 0, 0, 1])), { type: 'VEC3', componentType: FLOAT, target: ARRAY_BUFFER });
  const joints = pack.add(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), { type: 'VEC4', componentType: UBYTE, target: ARRAY_BUFFER });
  const weights = pack.add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), { type: 'VEC4', componentType: FLOAT, target: ARRAY_BUFFER });
  const indices = pack.add(new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]), { type: 'SCALAR', componentType: USHORT, target: ELEMENT_ARRAY_BUFFER });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const inverseBind = pack.add(new Float32Array([...identity, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), { type: 'MAT4', componentType: FLOAT });
  const s = Math.sin(0.2), c = Math.cos(0.2);
  const times = pack.add(new Float32Array([0, 1, 2]), { type: 'SCALAR', componentType: FLOAT, min: [0], max: [2] });
  const rotations = pack.add(new Float32Array([0, 0, 0, 1, 0, 0, s, c, 0, 0, 0, 1]), { type: 'VEC4', componentType: FLOAT });
  const json = {
    asset: { version: '2.0', generator: 'tiny_glb.mjs' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'Strip', mesh: 0, skin: 0 }, { name: 'Root', children: [2] }, { name: 'Tip', translation: [0, 1, 0] }],
    meshes: [{ name: 'Strip', primitives: [{ attributes: { POSITION: position, NORMAL: normal, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0 }] }],
    skins: [{ name: 'Rig', joints: [1, 2], skeleton: 1, inverseBindMatrices: inverseBind }],
    materials: [{ name: 'Cloth', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [0.3, 0.7, 0.4, 0.8], metallicFactor: 0, roughnessFactor: 0.8 } }],
    animations: [{ name: 'Sway', samplers: [{ input: times, output: rotations, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }] }],
    accessors: pack.accessors, bufferViews: pack.bufferViews, buffers: [{ byteLength: pack.size }],
  };
  return packGlb(json, pack.bin);
}

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const out = resolve(process.argv[2] || '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'static.glb'), buildStatic());
  writeFileSync(join(out, 'skinned.glb'), buildSkinned());
  console.log(`wrote static.glb and skinned.glb to ${out}`);
}

// Pure checks and helpers of the UMG probe (umg_probe.mjs). No Unreal, no network, no files: umg-probe.test.mjs feeds them canned reports, canned MCP
// responses and small generated images, and umg_probe.mjs feeds them real ones.
// The report shapes are the ones umg-session.mjs (the MCP half, run from node) and umg_stage.py (the Play-In-Editor half) write.
//   toolsets  the MCP server over loopback: list_toolsets and describe_toolset name the UMG, MVVM and widget-animation toolsets with their tools
//   widget    a Widget Blueprint with a canvas, a text block, a button and an image, properties set, compiled, saved and read back
//   capture   that widget added to the viewport of a Play-In-Editor session run offscreen, frames saved with and without it, regions compared
//   commonui  Common UI: the quickstart's requirements set from a script, an activatable widget with a Common button created, activated, captured
//   animation a widget animation of a saved Widget Blueprint: the Sequencer and Control Rig toolsets described, a track and a key added through them, read back by a fresh editor
//   mvvm      the MVVM toolset: a view model with a property, added to a widget, bound to a text block, read back with the List tools, compiled, loaded by a fresh editor
//   viewport  the class of the game viewport client that runs in a Play-In-Editor session, against the class the project settings saved
//   input     a simulated key or click delivered to the active Common button in a Play-In-Editor session: every route tried, and whether anything observable changed
import { decodePng } from '../niagara_toolsets/nts-probe-assets.mjs';

export { decodePng };
export const GROUPS = ['toolsets', 'widget', 'capture', 'commonui', 'animation', 'mvvm', 'viewport', 'input'];

/**
 * The engine phases. `mcp` starts a rendering editor with Epic's MCP server and drives it from node; `editor` plays the map offscreen and quits itself; `play` does both
 * in one editor (the stage script plays and waits at a barrier file while node calls the server). `key` is where a phase's report lands in the reports of its project.
 */
export const PHASES = {
  session: { name: 'session', key: 'session', mode: 'mcp', project: 'base' },
  capture: { name: 'capture', key: 'capture', mode: 'editor', project: 'base', script: 'umg_stage.py', stage: 'widget', prefix: 'umg' },
  readback: { name: 'readback', key: 'readback', mode: 'mcp', project: 'base' },
  'commonui-session': { name: 'commonui-session', key: 'session', mode: 'mcp', project: 'commonui' },
  'commonui-capture': { name: 'commonui-capture', key: 'capture', mode: 'editor', project: 'commonui', script: 'umg_stage.py', stage: 'commonui', prefix: 'umgc' },
  play: { name: 'play', key: 'play', mode: 'play', project: 'commonui', script: 'umg_stage.py', stage: 'input', prefix: 'umgi' },
};

/**
 * The phases a list of groups needs, in order: toolsets, widget, animation and mvvm share one session, capture needs the session's saved widget, animation and mvvm are read
 * back by a fresh editor (the readback), the Common UI groups have their own project, and viewport and input share the one Play-In-Editor session that follows its session.
 */
export function planPhases(groups) {
  const want = new Set(groups), any = (names) => names.some((g) => want.has(g));
  const out = [];
  if (any(['toolsets', 'widget', 'capture', 'animation', 'mvvm'])) out.push(PHASES.session);
  if (want.has('capture')) out.push(PHASES.capture);
  if (any(['animation', 'mvvm'])) out.push(PHASES.readback);
  if (any(['commonui', 'viewport', 'input'])) out.push(PHASES['commonui-session']);
  if (want.has('commonui')) out.push(PHASES['commonui-capture']);
  if (any(['viewport', 'input'])) out.push(PHASES.play);
  return out;
}

export const USAGE = 'usage: node umg_probe.mjs --engine <UE_5.8 folder> [--only <group>[,<group>...]] [--keep] [--plan] [--hold] [--port <number>]'
  + `   groups: ${GROUPS.join(', ')}   (no --only: every group; capture runs the widget session first)`;

/**
 * @param {string[]} argv  process.argv without node and the script
 * @param {Record<string, string|undefined>} [env]  UE_ROOT supplies the engine folder
 * @returns {{ error?: string, engine?: string, keep?: boolean, plan?: boolean, hold?: boolean, groups?: string[], named?: boolean, port?: number }}
 */
export function parseProbeOptions(argv, env = {}) {
  const values = {}, valued = { '--engine': 'engine', '--only': 'only', '--port': 'port' };
  let keep = false, plan = false, hold = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep') keep = true;
    else if (arg === '--plan') plan = true;
    else if (arg === '--hold') hold = true;
    else if (valued[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (values[valued[arg]] !== undefined) return { error: `${arg} given twice` };
      values[valued[arg]] = value;
      i++;
    } else return { error: `unknown option ${arg}` };
  }
  const engine = values.engine || env.UE_ROOT;
  if (!engine) return { error: 'no engine folder: pass --engine or set UE_ROOT' };
  let groups = GROUPS;
  const named = values.only !== undefined;
  if (named) {
    const asked = values.only.split(',').map((g) => g.trim()).filter(Boolean);
    const unknown = asked.filter((g) => !GROUPS.includes(g));
    if (asked.length === 0) return { error: '--only needs at least one group' };
    if (unknown.length) return { error: `unknown group ${unknown.join(', ')}; the groups are ${GROUPS.join(', ')}` };
    groups = GROUPS.filter((g) => asked.includes(g));
  }
  let port;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { error: `--port needs a number from 1024 to 65535, got ${values.port}` };
  }
  return { engine, keep, plan, hold, groups, named, port };
}

/** True when an engine log says the process stopped for lack of video memory (the run is then recorded as not run because of memory). */
export function looksLikeMemoryFailure(logText) {
  return /out of video memory|out of device memory|VK_ERROR_OUT_OF_DEVICE_MEMORY|DXGI_ERROR_DEVICE_REMOVED|DXGI_ERROR_DEVICE_HUNG|E_OUTOFMEMORY|failed to allocate .*(GPU|video|texture)|GPU crash|Device lost/i.test(String(logText || ''));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// MCP responses

/** Take the complete server-sent events out of a buffer. Returns the JSON messages found and the unfinished rest. */
export function takeSseEvents(buffer) {
  const parts = String(buffer).split(/\r?\n\r?\n/);
  const rest = parts.pop();
  const events = [];
  for (const part of parts) {
    const data = part.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { events.push(JSON.parse(data)); } catch { /* a keep-alive or a non-JSON event */ }
  }
  return { events, rest };
}

const tryJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

/**
 * A JSON-RPC `result` of tools/call: { content: [{ type: 'text', text }], isError, structuredContent }.
 * @returns {{ isError: boolean, text: string, json: any, images: number, error: string }}
 */
export function decodeToolResult(result) {
  const r = result || {};
  const blocks = Array.isArray(r.content) ? r.content : [];
  const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  const images = blocks.filter((b) => b && b.type === 'image').length;
  let json = r.structuredContent !== undefined ? r.structuredContent : tryJson(text);
  const inner = json && typeof json === 'object' && 'error' in json ? json.error : undefined;
  const innerError = typeof inner === 'string' ? inner : inner && typeof inner === 'object' ? JSON.stringify(inner) : '';
  const isError = Boolean(r.isError) || Boolean(innerError);
  return { isError, text, json, images, error: isError ? (innerError || text).slice(0, 600) : '' };
}

/** The value a tool returned: the `returnValue` of the registry's result object, or the whole JSON. A JSON string inside is parsed. */
export function returnValue(decoded) {
  let v = decoded && decoded.json !== undefined ? decoded.json : decoded && decoded.text;
  if (v && typeof v === 'object' && !Array.isArray(v) && 'returnValue' in v) v = v.returnValue;
  if (typeof v === 'string') { const parsed = tryJson(v); if (parsed !== undefined && typeof parsed === 'object') return parsed; }
  return v;
}

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The toolset names a list_toolsets result holds. The server answers with text, one "- <module>.<class>: <description>" line per toolset (a description may run on
 * over several lines); JSON with names under a `name` key or bare strings is read too, and dotted words are the last resort.
 */
export function collectToolsetNames(decoded) {
  const text = String((decoded && decoded.text) || '');
  const lines = [...text.matchAll(/^- ([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+):/gm)].map((m) => m[1]);
  if (lines.length) return [...new Set(lines)];
  const out = new Set();
  const walk = (v, key) => {
    if (typeof v === 'string') { if (/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(v) && (key === undefined || /name|toolset/i.test(key))) out.add(v); return; }
    if (Array.isArray(v)) { for (const item of v) walk(item, typeof item === 'string' ? undefined : key); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  const root = returnValue(decoded);
  if (root && typeof root === 'object') walk(root, undefined);
  if (out.size === 0) for (const m of text.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\b/g)) out.add(m[1]);
  return [...out];
}

/** Tools of a describe_toolset result: [{ name, short, params: string[], required: string[] }]. Empty when the result is not the registry's JSON. */
export function collectTools(decoded) {
  const found = [];
  const seen = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v.tools)) { v.tools.forEach(walk); return; }   // the toolset itself has a name and a description and is not one of its tools
    if (typeof v.name === 'string' && (v.inputSchema || v.input_schema || v.parameters || typeof v.description === 'string') && !seen.has(v.name)) {
      const schema = v.inputSchema || v.input_schema || {};
      const props = schema.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : Array.isArray(v.parameters) ? v.parameters.map((p) => p && p.name).filter(Boolean) : [];
      seen.add(v.name);
      found.push({ name: v.name, short: v.name.split('.').pop(), params: props, required: Array.isArray(schema.required) ? schema.required : [] });
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(returnValue(decoded));
  return found;
}

/** True when `want` is among the tool names (compared without case or underscores), or, for a result that is not JSON, appears in its text. */
export function hasTool(tools, text, want) {
  if (tools.length) return tools.some((t) => norm(t.short) === norm(want));
  return norm(text).includes(norm(want));
}

/** The first name matching: the toolset names are fully qualified, so the choice is by pattern. */
export const pickName = (names, pattern) => names.find((n) => pattern.test(n));

// ---------------------------------------------------------------------------------------------------------------------------------
// JSON shapes read back from the object tools

const keyOf = (obj, want) => (obj && typeof obj === 'object' ? Object.keys(obj).find((k) => norm(k) === norm(want)) : undefined);

/** Case-insensitive lookup along a path of keys. */
export function getCI(obj, path) {
  let v = obj;
  for (const key of path) {
    const k = keyOf(v, key);
    if (k === undefined) return undefined;
    v = v[k];
  }
  return v;
}

/** Set the value at a path that already exists (case-insensitive, keeping the key's own spelling). Returns false when the path is missing. */
export function setCI(obj, path, value) {
  const parent = path.length === 1 ? obj : getCI(obj, path.slice(0, -1));
  const k = keyOf(parent, path[path.length - 1]);
  if (k === undefined) return false;
  parent[k] = value;
  return true;
}

/** A two-number vector from {x,y}, [x,y] or "(X=1,Y=2)". */
export function readVec2(v) {
  if (Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === 'number')) return [v[0], v[1]];
  if (v && typeof v === 'object') { const x = getCI(v, ['x']), y = getCI(v, ['y']); if (typeof x === 'number' && typeof y === 'number') return [x, y]; }
  if (typeof v === 'string') { const m = /X=([-\d.e]+).*Y=([-\d.e]+)/i.exec(v); if (m) return [Number(m[1]), Number(m[2])]; }
  return undefined;
}

/** A colour from {r,g,b,a}, [r,g,b,a], "(R=1,G=0,B=0,A=1)" or "#RRGGBB[AA]" (a hex colour is read as sRGB bytes divided by 255). */
export function readColor(v) {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')) return [v[0], v[1], v[2], v[3] ?? 1];
  if (v && typeof v === 'object') {
    const c = ['r', 'g', 'b'].map((k) => getCI(v, [k]));
    if (c.every((n) => typeof n === 'number')) { const a = getCI(v, ['a']); return [...c, typeof a === 'number' ? a : 1]; }
    const nested = getCI(v, ['specifiedColor']) ?? getCI(v, ['color']);
    if (nested !== undefined) return readColor(nested);
  }
  if (typeof v === 'string') {
    const m = /R=([-\d.e]+).*G=([-\d.e]+).*B=([-\d.e]+)(?:.*A=([-\d.e]+))?/i.exec(v);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    const h = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
    if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16) / 255).concat(h[2] ? parseInt(h[2], 16) / 255 : 1);
  }
  return undefined;
}

/** A vector written in the shape of `sample` (an object keeps its key spelling, an array stays an array, a string stays export text). */
export function vec2Like(sample, x, y) {
  if (Array.isArray(sample)) return [x, y];
  if (typeof sample === 'string') return `(X=${x},Y=${y})`;
  const out = { ...(sample && typeof sample === 'object' ? sample : { X: 0, Y: 0 }) };
  out[keyOf(out, 'x') ?? 'X'] = x;
  out[keyOf(out, 'y') ?? 'Y'] = y;
  return out;
}

/** A colour written in the shape of `sample`. */
export function colorLike(sample, [r, g, b, a = 1]) {
  if (Array.isArray(sample)) return [r, g, b, a];
  if (typeof sample === 'string') return sample.startsWith('#') ? `#${[r, g, b, a].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0')).join('')}` : `(R=${r},G=${g},B=${b},A=${a})`;
  const out = { ...(sample && typeof sample === 'object' ? sample : { R: 0, G: 0, B: 0, A: 1 }) };
  for (const [k, n] of [['r', r], ['g', g], ['b', b], ['a', a]]) out[keyOf(out, k) ?? k.toUpperCase()] = n;
  return out;
}

/** A text written in the shape of `sample`: a string stays a string, an object gets its first text-like string field set. */
export function textLike(sample, text) {
  if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
    const k = Object.keys(sample).find((key) => typeof sample[key] === 'string' && /string|text|value|source/i.test(key));
    if (k) return { ...sample, [k]: text };
  }
  return text;
}

/** The text of a read-back Text property: a string, or an object's text-like string field. */
export function readText(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') { const k = Object.keys(v).find((key) => typeof v[key] === 'string' && /string|text|value|source/i.test(key)); if (k) return v[k]; }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The widget the session builds, and the regions its frames are checked in

export const WIDGET_ASSET = '/Game/UI/WBP_ProbeHud';
export const PROBE_TEXT = 'UMG PROBE';
/** Canvas slot anchors as fractions of the viewport (stretch anchors with zero offsets, so the regions do not depend on the DPI scale). */
export const LAYOUT = {
  ProbeText: { min: [0.30, 0.08], max: [0.70, 0.24] },
  ProbeButton: { min: [0.35, 0.42], max: [0.65, 0.58] },
  ProbeImage: { min: [0.40, 0.70], max: [0.60, 0.90] },
};
export const EXPECTED_WIDGETS = [
  { name: 'ProbeRoot', cls: 'CanvasPanel' }, { name: 'ProbeText', cls: 'TextBlock' }, { name: 'ProbeButton', cls: 'Button' },
  { name: 'ProbeButtonLabel', cls: 'TextBlock' }, { name: 'ProbeImage', cls: 'Image' },
];
export const BUTTON_COLOR = [1, 0, 0, 1];
export const IMAGE_COLOR = [0, 1, 0, 1];

// ---------------------------------------------------------------------------------------------------------------------------------
// Frames

const NO_RECT = undefined;
/** The pixel rectangle of a fractional box: `rect` is where the viewport sits in the frame ({ x0, y0, w, h }); without it the box is a share of the whole frame. */
function pixelBox(img, box, rect) {
  const r = rect || { x0: 0, y0: 0, w: img.width, h: img.height };
  return {
    x0: Math.max(0, Math.floor(r.x0 + box.min[0] * r.w)), x1: Math.min(img.width, Math.ceil(r.x0 + box.max[0] * r.w)),
    y0: Math.max(0, Math.floor(r.y0 + box.min[1] * r.h)), y1: Math.min(img.height, Math.ceil(r.y0 + box.max[1] * r.h)),
  };
}
const differs = (a, b, o, tolerance) => Math.max(Math.abs(a.rgba[o] - b.rgba[o]), Math.abs(a.rgba[o + 1] - b.rgba[o + 1]), Math.abs(a.rgba[o + 2] - b.rgba[o + 2])) > tolerance;

/** Pixels of `img` inside a box given as fractions of the viewport rectangle, tested by `pred(r, g, b)`: { count, total }. */
export function regionCount(img, box, pred, rect = NO_RECT) {
  if (!img) return { count: 0, total: 0 };
  const p = pixelBox(img, box, rect);
  let count = 0, total = 0;
  for (let y = p.y0; y < p.y1; y++) {
    for (let x = p.x0; x < p.x1; x++) {
      const o = (y * img.width + x) * 4;
      total++;
      if (pred(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2])) count++;
    }
  }
  return { count, total };
}
export const isBright = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b >= 170;
export const isRed = (r, g, b) => r >= 110 && r > 1.8 * g && r > 1.8 * b;
export const isGreen = (r, g, b) => g >= 110 && g > 1.8 * r && g > 1.8 * b;

/** Pixels in the box that differ between two frames of the same size by more than `tolerance` in any channel (and, when `pred` is given, satisfy it in the second frame); -1 when the sizes differ. */
export function changedInRegion(a, b, box, tolerance = 12, rect = NO_RECT, pred = () => true) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return -1;
  const p = pixelBox(a, box, rect);
  let n = 0;
  for (let y = p.y0; y < p.y1; y++) {
    for (let x = p.x0; x < p.x1; x++) {
      const o = (y * a.width + x) * 4;
      if (differs(a, b, o, tolerance) && pred(b.rgba[o], b.rgba[o + 1], b.rgba[o + 2])) n++;
    }
  }
  return n;
}

/** The bounding box of the pixels that changed between two frames and satisfy `pred` in the second: { x0, y0, w, h, n }; n is 0 when there are none. */
export function changedBlob(base, shown, pred, tolerance = 12) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < shown.height; y++) {
    for (let x = 0; x < shown.width; x++) {
      const o = (y * shown.width + x) * 4;
      if (differs(base, shown, o, tolerance) && pred(shown.rgba[o], shown.rgba[o + 1], shown.rgba[o + 2])) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  return n ? { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n } : { x0: 0, y0: 0, w: 0, h: 0, n: 0 };
}

/**
 * Where the viewport sits in a frame. A frame of a window holds the editor around the viewport, so the button, a solid colour that changed between the two frames, places it:
 * its size against its share of the viewport gives the scale, and its position the corner. A frame the size of the viewport needs no such help.
 * @param {{ width: number, height: number }} viewport  the size the stage read in pixels
 * @returns {{ rect?: { x0: number, y0: number, w: number, h: number }, how: string, blob: ReturnType<typeof changedBlob> }}
 */
export function locateViewport(base, shown, viewport) {
  const vp = viewport && viewport.width > 0 && viewport.height > 0 ? viewport : { width: shown.width, height: shown.height };
  const blob = changedBlob(base, shown, isRed);
  let note = blob.n ? `a button-coloured blob ${blob.w}x${blob.h} is not the button` : 'no button-coloured pixels changed';
  // the button first, then the image (a solid colour too): each is a solid blob whose size against its share of the viewport gives the scale
  for (const [name, box, pred, found] of [['button', LAYOUT.ProbeButton, isRed, blob], ['image', LAYOUT.ProbeImage, isGreen, undefined]]) {
    const b = found || changedBlob(base, shown, pred);
    if (!b.n) continue;
    const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1];
    const scale = b.w / (w * vp.width), expectedH = h * vp.height * scale;
    const solid = b.n >= 0.6 * b.w * b.h, sized = Math.abs(b.h - expectedH) <= 0.15 * expectedH && scale >= 0.2 && scale <= 5;
    if (solid && sized) return { rect: { x0: b.x0 - box.min[0] * vp.width * scale, y0: b.y0 - box.min[1] * vp.height * scale, w: vp.width * scale, h: vp.height * scale }, how: `placed by the ${name} (scale ${scale.toFixed(2)})`, blob };
    if (name === 'image') note += `; a green blob ${b.w}x${b.h} is not the image`;
  }
  if (Math.abs(shown.width - vp.width) <= 2 && Math.abs(shown.height - vp.height) <= 2) return { rect: { x0: 0, y0: 0, w: shown.width, h: shown.height }, how: 'the frame is the viewport', blob };
  return { rect: undefined, how: `not placed (${note})`, blob };
}

/**
 * Judge one route's pair of frames. The button: a solid blob of the button colour that appeared, of the size its anchors give. The text: bright pixels that appeared in
 * the text region (placed from the button), at least 1 percent of it and at least five times the rate in a control region beside it (a moving scene changes pixels too).
 * @returns {{ comparable: boolean, text: boolean, button: boolean, image: number, detail: string }}
 */
export function judgeFrames(base, shown, viewport) {
  if (!base || !shown || base.width !== shown.width || base.height !== shown.height) {
    return { comparable: false, text: false, button: false, image: 0, detail: !base || !shown ? 'a frame is missing' : `sizes differ (${base.width}x${base.height} and ${shown.width}x${shown.height})` };
  }
  const pct = (f) => `${(f * 100).toFixed(1)}%`;
  const located = locateViewport(base, shown, viewport);
  const rect = located.rect;
  const control = { min: [0.02, LAYOUT.ProbeText.min[1]], max: [0.28, LAYOUT.ProbeText.max[1]] };
  const rate = (box) => { const p = pixelBox(shown, box, rect), total = Math.max(1, (p.x1 - p.x0) * (p.y1 - p.y0)); return changedInRegion(base, shown, box, 12, rect, isBright) / total; };
  const textRate = rect ? rate(LAYOUT.ProbeText) : 0, controlRate = rect ? rate(control) : 0;
  const share = (img, box, pred) => { if (!rect) return 0; const c = regionCount(img, box, pred, rect); return c.count / Math.max(1, c.total); };
  const buttonFraction = share(shown, LAYOUT.ProbeButton, isRed), buttonBaseFraction = share(base, LAYOUT.ProbeButton, isRed);
  const imageGain = share(shown, LAYOUT.ProbeImage, isGreen) - share(base, LAYOUT.ProbeImage, isGreen);
  const blob = located.blob;
  return {
    comparable: true,
    text: Boolean(rect) && textRate >= 0.01 && textRate >= 5 * Math.max(controlRate, 0.001),
    button: Boolean(rect) && blob.n > 0 && buttonFraction >= 0.4 && buttonBaseFraction <= 0.05,
    image: imageGain,
    detail: `${shown.width}x${shown.height}; viewport ${located.how}; bright pixels that appeared in the text region ${pct(textRate)} (control region ${pct(controlRate)}); `
      + `button-colour pixels in the button region ${pct(buttonBaseFraction)} without the widget and ${pct(buttonFraction)} with it (blob ${blob.w}x${blob.h}); green gained in the image region ${pct(imageGain)}`,
  };
}

/** The frames a stage report lists, keyed by label and route: { base: { showui: stem, hires: stem }, widget: {...} }. */
export function shotTable(stage) {
  const out = {};
  for (const s of Array.isArray(stage && stage.shots) ? stage.shots : []) {
    if (s && s.label && s.route && s.stem) (out[s.label] ||= {})[s.route] = s.stem;
  }
  return out;
}

/** The frame stems a stage report asks for (to look up under Saved/Screenshots). */
export function shotNames(stage) {
  return (Array.isArray(stage && stage.shots) ? stage.shots : []).map((s) => s && s.stem).filter(Boolean);
}

/**
 * Judge every route that has both frames. `images` maps a stem to a decoded frame.
 * @returns {{ routes: Record<string, ReturnType<typeof judgeFrames>>, named: string[] }}  named: routes in which both the text and the button show
 */
export function judgeRoutes(stage, images) {
  const table = shotTable(stage), routes = {};
  for (const route of ['showui', 'hires']) {
    const baseStem = table.base && table.base[route], shownStem = table.widget && table.widget[route];
    routes[route] = judgeFrames(images && images[baseStem], images && images[shownStem], stageStep(stage, 'viewport'));
  }
  return { routes, named: Object.keys(routes).filter((r) => routes[r].text && routes[r].button) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Judging

const steps = (report) => (report && Array.isArray(report.steps) ? report.steps : []);
const step = (report, name) => steps(report).find((s) => s.step === name) || {};
const ok = (s) => Boolean(s) && Boolean(s.step) && !s.error;   // a step that is missing is {} and does not count
const list = (x) => (Array.isArray(x) ? x : []);
const near = (a, b, tolerance = 0.02) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const short = (text, n = 160) => String(text ?? '').split(/\r?\n/)[0].slice(0, n);
const stageStep = (stage, name) => (stage && stage.steps && stage.steps[name]) || {};

export const META_TOOLS = ['list_toolsets', 'describe_toolset', 'call_tool'];
/** Tools of the UMG toolset the widget route and the quickstart use. */
export const UMG_CORE_TOOLS = ['CreateWidgetBlueprint', 'AddWidget', 'MoveWidget', 'GetWidgets', 'GetWidgetDescription', 'BindToEventProperty', 'CompileWidgetBlueprint'];

function describedToolset(session, key, label, expectTools) {
  const resolved = step(session, 'resolve'), desc = step(session, `describe_${key}`);
  const name = resolved[key];
  if (!name) return { pass: false, detail: `${label}: absent (${resolved.toolset_count ?? '?'} toolsets listed: ${list(resolved.sample).join(', ') || 'none recorded'})` };
  const tools = list(desc.tools);
  const missing = expectTools.filter((t) => !tools.some((x) => norm(x) === norm(t)));
  const pass = ok(desc) && (tools.length > 0 || desc.mentions_all === true) && missing.length === 0;
  return { pass, detail: `${label}: ${name}, ${desc.tool_count ?? tools.length} tools${missing.length ? `; missing ${missing.join(', ')}` : ''}${desc.error ? `; ${short(desc.error)}` : ''}` };
}

function toolsetChecks(session, check) {
  const connect = step(session, 'connect'), meta = step(session, 'meta_tools'), listed = step(session, 'list_toolsets'), resolved = step(session, 'resolve');
  check('toolsets', 'the MCP server answers over loopback with a session',
    'An initialize POST (streamable HTTP, Accept application/json and text/event-stream) returns a result and an Mcp-Session-Id header, and tools/list names list_toolsets, describe_toolset and call_tool',
    ok(connect) && connect.session_id === true && META_TOOLS.every((t) => list(meta.names).includes(t)),
    connect.error ? short(connect.error) : `ready after ${connect.ready_seconds} s; session id ${connect.session_id}; protocol ${connect.protocol_version}; tools ${list(meta.names).join(', ') || 'none'}${meta.error ? `; ${short(meta.error)}` : ''}`);
  check('toolsets', 'list_toolsets lists toolsets by fully qualified name',
    'list_toolsets over the session returns at least one toolset name of the form <module>.<class>',
    ok(listed) && list(listed.names).length > 0, listed.error ? short(listed.error) : `${listed.count} toolsets: ${list(listed.names).slice(0, 40).join(', ')}`);
  const umg = describedToolset(session, 'umg', 'UMG toolset', UMG_CORE_TOOLS);
  check('toolsets', 'the UMG toolset is listed with its tools',
    `describe_toolset names the UMG toolset's tools, including ${UMG_CORE_TOOLS.join(', ')}`, umg.pass, umg.detail);
  const mvvm = describedToolset(session, 'mvvm', 'MVVM toolset', []);
  check('toolsets', 'the MVVM toolset is listed with its tools',
    'list_toolsets names an MVVM toolset and describe_toolset lists at least one of its tools', mvvm.pass && ok(step(session, 'describe_mvvm')) && (step(session, 'describe_mvvm').tool_count > 0), mvvm.detail);
  const anim = describedToolset(session, 'widget_animation', 'widget-animation toolset', []);
  check('toolsets', 'the widget-animation toolset is listed with its tools',
    'list_toolsets names a widget-animation toolset and describe_toolset lists at least one of its tools', anim.pass && ok(step(session, 'describe_widget_animation')) && (step(session, 'describe_widget_animation').tool_count > 0), anim.detail);
  check('toolsets', 'the object and asset toolsets the widget route needs are listed',
    'The object toolset (get_properties, set_properties) and the asset toolset (save_assets) are listed, because the UMG toolset leaves widget properties and saving to them',
    Boolean(resolved.object) && Boolean(resolved.asset) && hasAll(step(session, 'describe_object'), ['get_properties', 'set_properties']) && hasAll(step(session, 'describe_asset'), ['save_assets']),
    `object ${resolved.object || 'absent'} (${step(session, 'describe_object').tool_count ?? '?'} tools); asset ${resolved.asset || 'absent'} (${step(session, 'describe_asset').tool_count ?? '?'} tools)`);
}

const hasAll = (desc, names) => names.every((n) => list(desc.tools).some((t) => norm(t) === norm(n)));

function widgetChecks(session, stage, check) {
  const create = step(session, 'create'), tree = step(session, 'tree'), props = step(session, 'properties'), compile = step(session, 'compile'), save = step(session, 'save'), back = step(session, 'read_back');
  check('widget', 'a Widget Blueprint is created through the toolset',
    'CreateWidgetBlueprint with the UserWidget parent class returns the new blueprint, and a read of the tree finds it',
    ok(create) && create.created === true && back.widget_count > 0, create.error ? short(create.error) : `created ${create.created}; route ${create.route || 'none'}; tool name form ${create.name_form || 'unknown'}; widget count ${back.widget_count}`);
  const present = list(back.widgets);
  const missing = EXPECTED_WIDGETS.filter((w) => !present.some((p) => norm(p.name) === norm(w.name) && norm(p.class) === norm(w.cls)));
  check('widget', 'a canvas, a text block, a button and an image are in the tree',
    'GetWidgets lists a canvas panel root (ProbeRoot), a text block, a button with a text block label, and an image, by name and class',
    ok(back) && missing.length === 0, back.error ? short(back.error) : missing.length ? `missing ${missing.map((m) => `${m.name} (${m.cls})`).join(', ')}; found ${present.map((p) => `${p.name}:${p.class}`).join(', ') || 'none'}${list(tree.errors).length ? `; ${list(tree.errors).map((e) => short(e, 100)).join(' | ')}` : ''}` : `${present.length} widgets: ${present.map((p) => `${p.name}:${p.class}`).join(', ')}`);
  const anchors = back.anchors || {};
  const anchorMiss = Object.entries(LAYOUT).filter(([name, box]) => {
    const a = anchors[name];
    return !a || !a.min || !a.max || !near(a.min[0], box.min[0]) || !near(a.min[1], box.min[1]) || !near(a.max[0], box.max[0]) || !near(a.max[1], box.max[1]);
  }).map(([name]) => name);
  const color = back.button_color, imageColor = back.image_color;
  const colorOk = Array.isArray(color) && near(color[0], BUTTON_COLOR[0], 0.05) && near(color[1], BUTTON_COLOR[1], 0.05) && near(color[2], BUTTON_COLOR[2], 0.05);
  check('widget', 'the properties set through the object toolset read back as set',
    `After set_properties, get_properties returns the text "${PROBE_TEXT}", the button background colour red, the image colour green, and stretch anchors for the three widgets that match the layout`,
    ok(back) && back.text_value === PROBE_TEXT && colorOk && Array.isArray(imageColor) && near(imageColor[1], 1, 0.05) && anchorMiss.length === 0,
    `text ${JSON.stringify(back.text_value)}; button colour ${JSON.stringify(color)}; image colour ${JSON.stringify(imageColor)}; anchors off or unread for ${anchorMiss.join(', ') || 'none'}${list(props.errors).length ? `; set errors: ${list(props.errors).map((e) => short(e, 120)).join(' | ')}` : ''}${back.samples ? `; shapes read: ${JSON.stringify(back.samples).slice(0, 300)}` : ''}`);
  const loaded = stage && stage.steps ? stageStep(stage, 'asset') : undefined;
  check('widget', 'the blueprint compiles, saves and loads as a compiled class in a new process',
    'CompileWidgetBlueprint returns true, save_assets returns true and, when the capture phase ran, a fresh editor loads the saved blueprint as a generated class whose status reads up to date',
    compile.returned === true && save.returned === true && (!loaded || (loaded.class_loaded === true && /UP_TO_DATE/i.test(String(loaded.blueprint_status || '')))),
    `compile ${compile.returned}${compile.error ? ` (${short(compile.error, 100)})` : ''}; save ${save.returned}${save.error ? ` (${short(save.error, 100)})` : ''}; fresh process: ${loaded ? `class ${loaded.class_name}, status ${loaded.blueprint_status}` : 'not run'}`);
}

function captureChecks(session, stage, images, check) {
  const added = stageStep(stage, 'added'), created = stageStep(stage, 'create'), asset = stageStep(stage, 'asset');
  const judged = judgeRoutes(stage, images), routes = judged.routes;
  check('capture', 'the compiled widget is created and added to the viewport of a Play-In-Editor session',
    'In a rendering editor run offscreen, WidgetLibrary.create returns an instance of the saved class and add_to_viewport leaves is_in_viewport true',
    asset.class_loaded === true && created.created === true && added.in_viewport === true,
    stage ? `class ${asset.class_name}; instance ${created.class_name} (route ${created.route}); in viewport ${added.in_viewport}; viewport ${JSON.stringify(stageStep(stage, 'viewport'))}${created.error ? `; ${short(created.error)}` : ''}` : 'the stage report was not written');
  const comparable = Object.values(routes).filter((r) => r.comparable);
  check('capture', 'frames were saved with and without the widget',
    'At least one route saved a frame before and a frame after, of the same size',
    comparable.length > 0, `${Object.entries(routes).map(([r, j]) => `${r}: ${j.comparable ? 'pair saved' : j.detail}`).join('; ')}`);
  const textRoute = Object.keys(routes).find((r) => routes[r].text), buttonRoute = Object.keys(routes).find((r) => routes[r].button);
  check('capture', 'the saved frame shows the text',
    'Against the same frame without the widget, bright pixels appeared in the text block region (at least 1 percent of it and five times the rate beside it)',
    Boolean(textRoute), Object.entries(routes).map(([r, j]) => `${r}: ${j.detail}`).join(' || ') || 'no frames');
  check('capture', 'the saved frame shows the button',
    'Against the same frame without the widget, a solid blob of the button colour appeared in the button region and covers at least 40 percent of it (at most 5 percent before)',
    Boolean(buttonRoute), Object.entries(routes).map(([r, j]) => `${r}: ${j.comparable ? `button ${j.button}` : j.detail}`).join('; ') || 'no frames');
  const image = Object.values(routes).filter((r) => r.comparable).map((r) => r.image);
  check('capture', 'whether the image widget draws is recorded',
    'The image widget has no texture; the share of its region that turns green is recorded, not required',
    comparable.length > 0, `green share gained: ${image.map((n) => `${(n * 100).toFixed(1)}%`).join(', ') || 'no frames'}`);
  check('capture', 'the capture route is named',
    'The route whose frame shows both the text and the button is named: the console command Shot showui (the viewport with its UI) or the high-resolution shot',
    judged.named.length > 0, judged.named.length ? `shown by ${judged.named.join(' and ')}; not shown by ${Object.keys(routes).filter((r) => !judged.named.includes(r)).join(', ') || 'none'}` : 'no route showed both');
}

const CONFIG_PIECES = [['config_viewport', 'Game Viewport Client Class'], ['config_input', 'Common Input Settings Input Data']];

function commonUiChecks(session, stage, images, check) {
  const table = step(session, 'table'), inputData = step(session, 'input_data'), button = step(session, 'button_blueprint'), act = step(session, 'activatable'), save = step(session, 'save');
  const settings = stageStep(stage, 'settings'), before = stageStep(stage, 'before_activation'), after = stageStep(stage, 'after_activation'), added = stageStep(stage, 'added');
  check('commonui', 'an input action data table is created from a script',
    'DataTableTools.create with the CommonInputActionDataBase row struct makes a table and add_rows adds a Confirm and a Back row',
    ok(table) && table.created === true && table.rows_added === true, table.error ? short(table.error) : `created ${table.created}; rows ${table.rows_added}`);
  check('commonui', 'a Common UI input data Blueprint is created and its click and back actions point at the table',
    'A Blueprint of CommonUIInputData is created, and DefaultClickAction and DefaultBackAction are set to rows of the data table and read back',
    ok(inputData) && inputData.created === true && inputData.click_set === true && inputData.back_set === true, inputData.error ? short(inputData.error) : `created ${inputData.created}; click ${inputData.click_set}; back ${inputData.back_set}`);
  const viewportRead = JSON.stringify(settings.engine || {}), inputRead = JSON.stringify(settings.input_settings || {});
  const cfgV = step(session, 'config_viewport'), cfgI = step(session, 'config_input');
  check('commonui', 'the Game Viewport Client Class is set to CommonGameViewportClient from a script and a new editor reads it',
    'The settings toolset finds the Game Viewport Client Class property, sets it and saves the section, and the next editor process reads CommonGameViewportClient back',
    cfgV.saved === true && /CommonGameViewportClient/.test(viewportRead),
    `${cfgV.found ? `found in ${cfgV.found}` : 'property not found in a settings section'}; set ${cfgV.set}; saved ${cfgV.saved}${cfgV.error ? ` (${short(cfgV.error, 140)})` : ''}; fresh editor read ${viewportRead.slice(0, 160)}`);
  check('commonui', 'the Common Input Settings Input Data is set to the Blueprint from a script and a new editor reads it',
    'The settings toolset sets Input Data on the Common Input Settings section and saves it, and the next editor process reads the Blueprint class back',
    cfgI.saved === true && /BP_ProbeInputData/.test(inputRead),
    `${cfgI.found ? `found in ${cfgI.found}` : 'property not found in a settings section'}; set ${cfgI.set}; saved ${cfgI.saved}${cfgI.error ? ` (${short(cfgI.error, 140)})` : ''}; fresh editor read ${inputRead.slice(0, 160)}`);
  check('commonui', 'an activatable widget with a Common button is created, compiled and saved',
    'A Widget Blueprint of CommonActivatableWidget holds a canvas, a text block and an instance of a CommonButtonBase Widget Blueprint; both compile and save',
    ok(button) && button.created === true && button.compiled === true && ok(act) && act.created === true && act.compiled === true && save.returned === true && act.has_common_button === true,
    `button blueprint created ${button.created}, compiled ${button.compiled}${button.error ? ` (${short(button.error, 100)})` : ''}; activatable created ${act.created}, compiled ${act.compiled}, common button in tree ${act.has_common_button}${act.error ? ` (${short(act.error, 100)})` : ''}; save ${save.returned}`);
  check('commonui', 'the widget reads back inactive, then active once it is activated',
    'In Play In Editor the new instance is an activatable widget, is_activated() is false before activate_widget() and true after',
    added.in_viewport === true && before.is_activatable === true && before.activated === false && after.activated === true,
    stage ? `before ${JSON.stringify(before)}; added ${JSON.stringify(added)}; after ${JSON.stringify(after)}` : 'the stage report was not written');
  const judged = judgeRoutes(stage, images), routes = judged.routes;
  check('commonui', 'a saved frame shows the Common UI widget',
    'Against the frame without it, the title text region holds bright pixels and the Common button region is mostly the button colour',
    judged.named.length > 0, Object.entries(routes).map(([r, j]) => `${r}: ${j.detail}`).join(' || ') || 'no frames');
  const unset = CONFIG_PIECES.filter(([key]) => !(step(session, key).saved === true)).map(([, label]) => label);
  check('commonui', 'every required piece could be set from a script, or the report lists the ones that could not',
    'The pieces of the quickstart that the probe tries to set from a script (data table, input data Blueprint, Game Viewport Client Class, Common Input Settings) are all set; the detail lists the ones that were not',
    table.created === true && inputData.created === true && inputData.click_set === true && inputData.back_set === true && unset.length === 0, unset.length ? `could not be set and saved from a script: ${unset.join(', ')}` : 'all four pieces were set from a script');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Widget animation, MVVM, the running viewport client and simulated input

/** The Widget Blueprints the session builds for the animation and MVVM groups (each holds a canvas and a text block), and the names the MVVM calls use. */
export const ANIMATION_ASSET = '/Game/UI/WBP_ProbeAnim';
export const MVVM_ASSET = '/Game/UI/WBP_ProbeMvvm';
export const MVVM_NAMES = { viewModelFolder: '/Game/UI', viewModel: 'VM_ProbeScore', property: 'ScoreText', widget: 'ProbeText', widgetProperty: 'Text' };
export const ANIMATION_NAME = 'ProbeFade';
export const ANIMATION_TOOLSET_PATTERN = /(^|\.)animation_toolset\./i;

/**
 * Count what an animation holds in a property tree read back from a Widget Blueprint: arrays under Tracks (and MasterTracks) are tracks, arrays under Keys, Times or
 * Keyframes are keys, arrays under Sections are sections. A tree that holds only references to other objects counts nothing, so the reader walks the references first.
 * @returns {{ tracks: number, keys: number, sections: number }}
 */
export function summarizeAnimationTree(tree) {
  const count = { tracks: 0, keys: 0, sections: 0 };
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      if (/^(master)?tracks$/i.test(key || '')) count.tracks += v.length;
      else if (/^(keys|keyframes|times)$/i.test(key || '')) count.keys += v.length;
      else if (/^sections$/i.test(key || '')) count.sections += v.length;
      for (const item of v) walk(item, undefined);
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(tree, undefined);
  return count;
}

/**
 * True when a route record counts as observed: an input route (not a control or a precondition) for which the click counter or a button state read back changed. A frame that
 * differs is not counted: A-Q4 run 3 had a frame that differed by 248,649 pixels because the control that opens the editor's Content Drawer had changed the layout (the drawer was open
 * in the frame before and closed in the frame after), with no change to the button; the count is kept in the detail only.
 */
export const routeObserved = (route) => Boolean(route) && route.kind === 'input' && route.observed === true;

/**
 * The game viewport client objects an `obj list class=GameViewportClient` console command printed into the log: lines of the form "<Class> /Path.Outer:Name_0 <sizes>"; the
 * summary line (class, count, sizes) has no object path and is skipped.
 * @returns {{ cls: string, path: string }[]}
 */
export function viewportClientsFromLog(lines) {
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const m = /\s(\w*GameViewportClient\w*)\s+(\/[^\s:]+:\S+)\s/.exec(String(line));
    if (m) out.push({ cls: m[1], path: m[2] });
  }
  return out;
}

/** The class that ran: the stage script's own read when it got one, else the one class the engine listed (not when two differ). */
export function runningViewportClass(play) {
  const vp = (play && play.steps && play.steps.viewport_client) || {};
  if (typeof vp.running_class === 'string' && vp.running_class) return { cls: vp.running_class, how: 'read by the stage script' };
  const listed = [...new Set(viewportClientsFromLog(play && play.log_viewport).map((c) => c.cls))];
  return listed.length === 1 ? { cls: listed[0], how: 'listed by the engine (obj list class=GameViewportClient) in the session log' } : { cls: null, how: listed.length ? `the engine listed ${listed.join(', ')}` : 'no class' };
}

/** The ref ("[ref=g5]") of the first snapshot line the pattern matches, or undefined. */
export function findSlateRef(snapshot, pattern) {
  for (const line of String(snapshot ?? '').split(/\r?\n/)) {
    if (pattern.test(line)) { const m = /\[ref=([^\]]+)\]/.exec(line); if (m) return m[1]; }
  }
  return undefined;
}

const callLine = (c) => `${c.tool}${c.ok ? ' ok' : ` FAILED: ${short(c.error, 300)}`}`;

function animationChecks(session, readback, check) {
  const described = step(session, 'animation_toolsets'), attempt = step(session, 'animation_attempt'), back = step(readback, 'animation_readback');
  const sets = list(described.toolsets);
  check('animation', 'the animation toolsets are described and each description is saved',
    'describe_toolset returns the tools of each of the eight animation_toolset.* toolsets, and the report keeps each description',
    ok(described) && sets.length >= 8 && sets.every((t) => t.tool_count > 0 && t.raw_length > 0),
    described.error ? short(described.error) : `${sets.length} toolsets: ${sets.map((t) => `${t.name} ${t.tool_count} tools`).join('; ')}`);
  const calls = list(attempt.calls);
  check('animation', 'a track is added to a widget animation of a saved Widget Blueprint through the described tools',
    'A tool of a Sequencer or Control Rig toolset adds a track to a widget animation of the Widget Blueprint and the call succeeds',
    ok(attempt) && attempt.track_added === true, attempt.error ? short(attempt.error) : `${calls.map(callLine).join(' | ') || 'no call was made'}${attempt.note ? `; ${short(attempt.note, 300)}` : ''}`);
  check('animation', 'a key on a widget property is added through the described tools',
    'A tool adds a key to the track of a widget property and the call succeeds', ok(attempt) && attempt.key_added === true, `key added ${attempt.key_added}`);
  check('animation', 'a fresh editor reads the animation back from the saved Widget Blueprint with the track and the key',
    'After a new editor process loads the saved blueprint, its animation list holds the animation, and the animation holds at least one track and one key',
    ok(back) && back.animation_found === true && back.track_count > 0 && back.key_count > 0,
    back.error ? short(back.error) : `animations ${JSON.stringify(back.animations ?? [])}; tracks ${back.track_count}; keys ${back.key_count}${back.note ? `; ${short(back.note, 300)}` : ''}`);
}

function mvvmChecks(session, readback, check) {
  const calls = step(session, 'mvvm_calls'), lists = step(session, 'mvvm_lists'), compile = step(session, 'mvvm_compile'), back = step(readback, 'mvvm_readback');
  const line = list(calls.calls).map(callLine).join(' | ') || calls.error || 'no call was made';
  check('mvvm', 'a view model with a property is created through the MVVM toolset',
    'CreateViewModel makes a view model and AddViewModelProperty adds a property to it', ok(calls) && calls.view_model_created === true && calls.property_added === true, line);
  check('mvvm', 'the view model is added to the widget',
    'AddViewModelToWidget adds the view model to the Widget Blueprint that holds a text block', ok(calls) && calls.added_to_widget === true, `added ${calls.added_to_widget}`);
  check('mvvm', 'a binding from the property to the text block is created',
    'CreateViewBinding binds the view model property to the text block Text property and the call succeeds', ok(calls) && calls.binding_created === true, `binding ${calls.binding_created}`);
  check('mvvm', 'ListViewModels, ListWidgetViewModels and ListWidgetViewBindings read the view model and the binding back',
    'The three List tools return the view model, its place on the widget and the binding', ok(lists) && lists.view_model_listed === true && lists.widget_view_model_listed === true && lists.binding_listed === true,
    lists.error ? short(lists.error) : `view model ${lists.view_model_listed}; on widget ${lists.widget_view_model_listed}; binding ${lists.binding_listed}; ${short(lists.excerpt, 400)}`);
  check('mvvm', 'the Widget Blueprint compiles with no error after the binding',
    'CompileWidgetBlueprint returns true after the binding was added', compile.returned === true, compile.error ? short(compile.error, 300) : `compile ${compile.returned}`);
  check('mvvm', 'a fresh editor loads the saved Widget Blueprint with the binding present',
    'After a new editor process loads the saved blueprint, ListWidgetViewBindings still names the view model property and the text block',
    ok(back) && back.binding_present === true, back.error ? short(back.error) : `binding present ${back.binding_present}; ${short(back.excerpt, 400)}`);
}

function viewportChecks(play, check) {
  const vp = stageStep(play, 'viewport_client'), settings = stageStep(play, 'settings');
  const saved = JSON.stringify((settings.engine && (settings.engine.values || settings.engine)) || {});
  const running = runningViewportClass(play);
  check('viewport', 'the class of the running game viewport client is read in the Play-In-Editor session',
    'The class name of the game viewport client of the running Play-In-Editor world is read by the stage script or listed by the engine in the session log', typeof running.cls === 'string',
    `${running.cls ? `${running.cls} (${running.how})` : running.how}; routes: ${list(vp.routes).map((r) => `${r.route} ${r.error ? `FAILED ${short(r.error, 120)}` : JSON.stringify(r.value)}`).join(' | ') || 'none'}`);
  const logged = list(play && play.log_viewport).filter((l) => /\[umg_stage\] viewport_client class=\S+/.test(l) || viewportClientsFromLog([l]).length > 0);
  check('viewport', 'the session log holds the class the stage script logged',
    'The engine log of the Play-In-Editor session holds the stage script line "viewport_client class=<name>" or the object line the engine printed for the console command the stage script ran', logged.length > 0, logged.join(' | ') || 'no such line in the log');
  check('viewport', 'the running class equals the saved Game Viewport Client Class',
    'The running game viewport client class is CommonGameViewportClient, the class the project settings saved and the fresh editor read back',
    /CommonGameViewportClient/.test(saved) && running.cls === 'CommonGameViewportClient', `running ${JSON.stringify(running.cls)} (${running.how}); saved setting read in this session ${saved.slice(0, 160)}`);
}

function inputChecks(play, images, check) {
  const input = stageStep(play, 'input'), mcp = (play && play.mcp && play.mcp.steps) || [], mstep = (name) => mcp.find((s) => s.step === name) || {};
  const slate = mstep('slate_describe'), routes = [...list(input.routes), ...list(mstep('slate_routes').routes), ...list(mstep('slate_input').routes)];
  const table = shotTable(play), before = images && images[table.before && table.before.showui], after = images && images[table.after && table.after.showui];
  const diff = before && after ? Math.max(0, changedInRegion(before, after, { min: [0, 0], max: [1, 1] })) : 0;
  check('input', 'the Slate inspector toolset is described before any route uses it',
    'describe_toolset lists the tools of the Slate inspector toolset and the report keeps the description', slate.step === 'slate_describe' && !slate.error && slate.tool_count > 0 && slate.raw_length > 0,
    slate.error ? short(slate.error) : `${slate.toolset}: ${slate.tool_count} tools (${list(slate.tools).join(', ')})`);
  check('input', 'every route tried is recorded with its result',
    'At least three routes (Python reach, the Slate inspector toolset, a direct control) are listed, each with what was tried and what came back',
    routes.length >= 3 && routes.every((r) => r.route && (r.detail || r.error)), routes.map((r) => `${r.route}: ${r.kind || '?'} delivered ${r.delivered} observed ${r.observed}`).join('; ') || 'none');
  check('input', 'a control shows that the observable is wired',
    'Calling the Common button click delegate directly runs the log handler the other routes rely on', routes.some((r) => r.kind === 'control' && /broadcast/.test(r.route) && r.observed === true),
    routes.filter((r) => r.kind === 'control' && /broadcast/.test(r.route)).map((r) => `${r.route}: observed ${r.observed}; ${short(r.detail || r.error, 160)}`).join('; ') || 'no control route');
  check('input', 'a Slate inspector click reaches an editor widget (control)',
    'Clicking the editor Content Drawer button through the Slate inspector grows the snapshot, so the tool delivers clicks to Slate widgets', routes.some((r) => r.kind === 'control' && /slate inspector/.test(r.route) && r.observed === true),
    routes.filter((r) => r.kind === 'control' && /slate inspector/.test(r.route)).map((r) => `${r.route}: observed ${r.observed}; ${short(r.detail || r.error, 160)}`).join('; ') || 'no Slate control route');
  const worked = routes.filter((r) => routeObserved(r));
  check('input', 'a simulated key or click delivered to the active Common button changes an observable state',
    'One route delivers a key or click to the button and a log line, a state read back or a differing frame shows it', worked.length > 0,
    `${worked.length ? `worked: ${worked.map((r) => r.route).join(', ')}; ` : 'no route changed the button (log counter or state read back); '}frame pixels that differ before and after ${diff} (recorded, not counted: the frames also hold whatever else changed in the editor window)`);
}

/**
 * @param {{ groups: string[], reports: { base?: { session?: any, capture?: any, readback?: any, images?: Record<string, any> }, commonui?: { session?: any, capture?: any, play?: any, images?: Record<string, any>, playImages?: Record<string, any> } } }} input
 * @returns {{ group: string, name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateProbes({ groups, reports }) {
  const out = [];
  const check = (group, name, claim, pass, detail = '') => out.push({ group, name, claim, pass: Boolean(pass), detail: String(detail) });
  const base = (reports && reports.base) || {}, ui = (reports && reports.commonui) || {};
  for (const group of groups) {
    if (group === 'toolsets') toolsetChecks(base.session, check);
    else if (group === 'widget') widgetChecks(base.session, base.capture, check);
    else if (group === 'capture') captureChecks(base.session, base.capture, base.images, check);
    else if (group === 'commonui') commonUiChecks(ui.session, ui.capture, ui.images, check);
    else if (group === 'animation') animationChecks(base.session, base.readback, check);
    else if (group === 'mvvm') mvvmChecks(base.session, base.readback, check);
    else if (group === 'viewport') viewportChecks(ui.play, check);
    else if (group === 'input') inputChecks(ui.play, ui.playImages, check);
  }
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}

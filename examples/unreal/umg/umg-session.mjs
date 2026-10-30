// The MCP half of the UMG probe: drives a running editor through Epic's MCP server (umg-mcp.mjs) and returns a report of steps for umg-probe-checks.mjs.
//   baseSession      list_toolsets, describe_toolset for the UMG, MVVM and widget-animation toolsets, then the widget: a Widget Blueprint with a canvas, a text
//                    block, a button and an image, properties set through the object toolset, compiled, saved, read back
//   commonUiSession  the Common UI quickstart pieces that can be reached from a script (a data table, an input data Blueprint, two project settings) and an
//                    activatable widget with a Common button
//   baseSession also runs the animation and MVVM attempts when asked (each on its own small Widget Blueprint), readbackSession reads them back in a fresh editor, and
//   slateSession is the half of the Play-In-Editor phase that calls the Slate inspector toolset from node while the stage script waits.
// The tools are found by name in the lists the server returns and their argument names are matched against the schemas it describes, so a spelling difference
// between builds is a recorded result and not a crash. A write is never sent twice: only a call refused because the tool name was not found is sent again, with the
// other spelling of the name (short or qualified).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  norm, pickName, collectToolsetNames, collectTools, returnValue, getCI, setCI, readVec2, readColor, vec2Like, colorLike, textLike, readText,
  hasTool, findSlateRef, PROBE_TEXT, LAYOUT, BUTTON_COLOR, IMAGE_COLOR, WIDGET_ASSET, UMG_CORE_TOOLS,
  ANIMATION_ASSET, MVVM_ASSET, MVVM_NAMES, ANIMATION_NAME, ANIMATION_TOOLSET_PATTERN, summarizeAnimationTree,
} from './umg-probe-checks.mjs';

const PATTERNS = {
  umg: /(^|\.)UMGToolSet(\.|$)/i, mvvm: /mvvm/i, widget_animation: /widget.?animation|umg.?animation/i,
  object: /ObjectTools$/i, asset: /AssetTools$/i, blueprint: /BlueprintTools$/i, data_table: /DataTableTools$/i, config: /ConfigSettings/i, slate: /SlateInspector/i,
};
const assetRef = (path) => ({ refPath: `${path}.${path.split('/').pop()}` });
const classRef = (path) => ({ refPath: path });
const message = (error) => String((error && error.stack) || error).split('\n').slice(0, 3).join(' | ').slice(0, 500);
const cut = (value, n = 600) => { const t = typeof value === 'string' ? value : JSON.stringify(value); return (t ?? '').slice(0, n); };

class Recorder {
  constructor(probe, project) { this.report = { probe, project, steps: [] }; }
  /** Run fn; its fields are the step. A throw is recorded as the step's error and the next step still runs. */
  async step(name, fn) {
    try { const fields = (await fn()) || {}; this.report.steps.push({ step: name, ...fields }); return fields; } catch (error) { this.report.steps.push({ step: name, error: message(error) }); return undefined; }
  }
}

/** The calls of one session: the toolsets found, the argument shapes, the spelling of tool names that worked. */
class Session {
  constructor(client) { this.client = client; this.sets = {}; this.qualifiedFirst = false; this.nameForm = undefined; }

  shape(tool, args) {
    if (!tool || !tool.params.length) return args;
    const by = new Map(tool.params.map((p) => [norm(p), p]));
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [by.get(norm(k)) ?? k, v]));
  }

  async invoke(key, short, args) {
    const set = this.sets[key];
    if (!set) throw new Error(`the ${key} toolset is not listed`);
    const tool = set.tools.find((t) => norm(t.short) === norm(short));
    const shaped = this.shape(tool, args);
    const forms = this.qualifiedFirst ? [tool ? tool.name : `${set.name}.${short}`, short] : [short, tool ? tool.name : `${set.name}.${short}`];
    let out;
    for (const form of forms) {
      out = await this.client.inner(set.name, form, shaped);
      const refused = !out.ok && !out.timedOut && /unknown tool|no such tool|unrecognized tool|invalid tool|tool [^.]{0,80}not found|not found[^.]{0,40}\btool\b/i.test(out.error || '');
      if (!refused) { this.nameForm = form === short ? 'short' : 'qualified'; if (form !== forms[0]) this.qualifiedFirst = form !== short; break; }
    }
    return { ...out, value: out.ok ? returnValue(out.decoded) : undefined };
  }

  /** A call that must succeed; returns its value. */
  async need(key, short, args) {
    const out = await this.invoke(key, short, args);
    if (!out.ok) throw new Error(`${short}: ${out.timedOut ? 'timed out (read the state back before sending it again)' : out.error}`);
    return out.value;
  }

  async getProps(instance, names) {
    let v = await this.need('object', 'get_properties', { instance, properties: names });
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* leave the text */ } }
    return v;
  }

  async setProps(instance, values) {
    const v = await this.need('object', 'set_properties', { instance, values: JSON.stringify(values) });
    if (v !== true) throw new Error(`set_properties returned ${cut(v, 120)} for ${cut(values, 160)}`);
  }
}

/** A partial object in the spelling of `sample`: edits is [[path, value]]; a path the sample does not have is reported in `missing`. */
export function partialFrom(sample, edits) {
  const out = {}, missing = [];
  for (const [path, value] of edits) {
    let src = sample, dst = out, ok = true;
    for (let i = 0; i < path.length; i++) {
      const key = src && typeof src === 'object' ? Object.keys(src).find((k) => norm(k) === norm(path[i])) : undefined;
      if (key === undefined) { ok = false; break; }
      if (i === path.length - 1) dst[key] = value;
      else { dst[key] = dst[key] && typeof dst[key] === 'object' ? dst[key] : {}; dst = dst[key]; src = src[key]; }
    }
    if (!ok) missing.push(path.join('.'));
  }
  return { partial: out, missing };
}

const refOf = (x) => (x && typeof x === 'object' && typeof x.refPath === 'string' ? x : typeof x === 'string' && x ? { refPath: x } : undefined);

// ---------------------------------------------------------------------------------------------------------------------------------
// discovery

async function discover(s, rec, keys, keepRaw = []) {
  const client = s.client;
  const meta = await rec.step('meta_tools', async () => { const t = await client.listTools(); return { names: t.names, call_tool_arguments_type: t.argumentsType, error: t.error }; });
  let names = [];
  await rec.step('list_toolsets', async () => {
    const out = await client.listToolsets();
    if (!out.ok) throw new Error(out.error);
    names = collectToolsetNames(out.decoded);
    s.names = names;
    return { names, count: names.length, kind: out.decoded.json !== undefined ? 'json' : 'text', excerpt: cut(out.decoded.text, 300) };
  });
  const resolved = { toolset_count: names.length, sample: names.slice(0, 12), absent: [] };
  for (const key of keys) {
    const name = pickName(names, PATTERNS[key]);
    if (name) { s.sets[key] = { name, tools: [] }; resolved[key] = name; } else resolved.absent.push(key);
  }
  await rec.step('resolve', async () => resolved);
  for (const key of keys) {
    if (!s.sets[key]) continue;
    await rec.step(`describe_${key}`, async () => {
      const out = await client.describeToolset(s.sets[key].name);
      if (!out.ok) throw new Error(out.error);
      const tools = collectTools(out.decoded);
      s.sets[key].tools = tools;
      const fields = { toolset: s.sets[key].name, tool_count: tools.length, tools: tools.map((t) => t.short) };
      if (keepRaw.includes(key)) { fields.raw = String(out.decoded.text || '').slice(0, 60000); fields.raw_length = String(out.decoded.text || '').length; fields.tool_params = Object.fromEntries(tools.map((t) => [t.short, t.params])); }
      if (!tools.length) { fields.excerpt = cut(out.decoded.text, 400); fields.mentions_all = key === 'umg' && UMG_CORE_TOOLS.every((t) => hasTool([], out.decoded.text, t)); }
      return fields;
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// widget helpers

async function addWidget(s, bp, cls, name, parent) {
  const info = await s.need('umg', 'AddWidget', { widgetBlueprint: bp, widgetClass: classRef(cls), widgetDisplayName: name, ...(parent ? { parentWidget: parent } : {}) });
  const widget = refOf(getCI(info, ['widget'])), slot = refOf(getCI(info, ['slot']));
  if (!widget) throw new Error(`AddWidget ${name} returned no widget: ${cut(info, 200)}`);
  return { widget, slot };
}

/** Write a struct property: the changed fields only, in the spelling that was read; when that is refused, the whole value read with the fields changed. */
async function setStruct(s, instance, prop, edits) {
  const got = await s.getProps(instance, [prop]);
  const whole = getCI(got, [prop]);
  const key = Object.keys(got || {}).find((k) => norm(k) === norm(prop)) ?? prop;
  const { partial, missing } = partialFrom({ [key]: whole }, edits.map(([path, value]) => [[key, ...path], value]));
  if (missing.length) throw new Error(`${prop} has no ${missing.join(', ')} in ${cut(whole, 300)}`);
  try { await s.setProps(instance, partial); return 'partial'; } catch (first) {
    const copy = structuredClone(whole);
    for (const [path, value] of edits) setCI(copy, path, value);
    try { await s.setProps(instance, { [key]: copy }); return 'whole'; } catch (second) { throw new Error(`${message(first)} / then the whole value: ${message(second)}`); }
  }
}

async function setText(s, widget, text, size) {
  const got = await s.getProps(widget, ['Text']);
  const sample = getCI(got, ['Text']);
  const key = Object.keys(got || {}).find((k) => norm(k) === 'text') ?? 'Text';
  try { await s.setProps(widget, { [key]: textLike(sample, text) }); } catch (first) {
    if (typeof sample === 'string') throw first;
    await s.setProps(widget, { [key]: text });   // the object spelling was refused: the plain string
  }
  if (size) await setStruct(s, widget, 'Font', [[['Size'], size]]);
}

async function setColor(s, widget, prop, rgba) {
  const got = await s.getProps(widget, [prop]);
  const key = Object.keys(got || {}).find((k) => norm(k) === norm(prop)) ?? prop;
  await s.setProps(widget, { [key]: colorLike(getCI(got, [prop]), rgba) });
}

async function setAnchors(s, slot, box) {
  const got = await s.getProps(slot, ['LayoutData']);
  const layout = getCI(got, ['LayoutData']);
  const edits = [[['Anchors', 'Minimum'], vec2Like(getCI(layout, ['Anchors', 'Minimum']), ...box.min)], [['Anchors', 'Maximum'], vec2Like(getCI(layout, ['Anchors', 'Maximum']), ...box.max)]];
  for (const side of ['Left', 'Top', 'Right', 'Bottom']) if (getCI(layout, ['Offsets', side]) !== undefined) edits.push([['Offsets', side], 0]);
  await setStruct(s, slot, 'LayoutData', edits);
}

async function readTree(s, bp) {
  const tree = await s.need('umg', 'GetWidgets', { widgetBlueprint: bp });
  const widgets = (getCI(tree, ['widgets']) || []).map((w) => {
    const cls = getCI(w, ['widgetClassPath']);
    const clsText = typeof cls === 'string' ? cls : cls && cls.refPath ? cls.refPath : '';
    return { name: getCI(w, ['widgetName']), class: clsText.split('.').pop().replace(/_C$/, ''), classPath: clsText, widget: refOf(getCI(w, ['widget'])), slot: refOf(getCI(w, ['slot'])) };
  });
  return { widgets, count: getCI(tree, ['info', 'widgetCount']) ?? widgets.length };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the session of the base project

export async function baseSession({ client, say, build, animation = false, mvvm = false, py }) {
  const rec = new Recorder('session', 'base');
  const s = new Session(client);
  const keys = ['umg', 'mvvm', 'widget_animation', 'object', 'asset', 'blueprint'];
  await discover(s, rec, keys);
  if (build) await buildProbeWidget(s, rec, say);
  if (animation) await animationAttempt(s, rec, py);
  if (mvvm) await mvvmAttempt(s, rec);
  return rec.report;
}

/** The widget of the capture group: a canvas, a text block, a button and an image, properties set, compiled, saved and read back. */
async function buildProbeWidget(s, rec, say) {
  const bpRef = assetRef(WIDGET_ASSET);
  const refs = {};
  say('  building the widget through the toolsets');
  await rec.step('create', async () => {
    try { await s.need('asset', 'create_folder', { path: '/Game/UI' }); } catch { /* the UMG tool makes the folder itself, or says so */ }
    const made = await s.need('umg', 'CreateWidgetBlueprint', { folderPath: '/Game/UI', assetName: 'WBP_ProbeHud', parentClass: classRef('/Script/UMG.UserWidget') });
    const returned = refOf(made);
    return { created: Boolean(returned), blueprint: returned ? returned.refPath : cut(made, 200), route: 'mcp', name_form: s.nameForm };
  });
  const errors = [];
  await rec.step('tree', async () => {
    const add = async (name, cls, parent) => { try { refs[name] = await addWidget(s, bpRef, cls, name, parent); } catch (error) { errors.push(message(error)); } };
    await add('ProbeRoot', '/Script/UMG.CanvasPanel');
    const root = refs.ProbeRoot && refs.ProbeRoot.widget;
    await add('ProbeText', '/Script/UMG.TextBlock', root);
    await add('ProbeButton', '/Script/UMG.Button', root);
    await add('ProbeButtonLabel', '/Script/UMG.TextBlock', refs.ProbeButton && refs.ProbeButton.widget);
    await add('ProbeImage', '/Script/UMG.Image', root);
    return { added: Object.keys(refs), errors };
  });
  const propErrors = [];
  await rec.step('properties', async () => {
    const tryStep = async (label, fn) => { try { await fn(); } catch (error) { propErrors.push(`${label}: ${message(error)}`); } };
    if (refs.ProbeText) await tryStep('ProbeText text', () => setText(s, refs.ProbeText.widget, PROBE_TEXT, 48));
    if (refs.ProbeButtonLabel) await tryStep('ProbeButtonLabel text', () => setText(s, refs.ProbeButtonLabel.widget, 'GO', 32));
    if (refs.ProbeButton) await tryStep('ProbeButton colour', () => setColor(s, refs.ProbeButton.widget, 'BackgroundColor', BUTTON_COLOR));
    if (refs.ProbeImage) await tryStep('ProbeImage colour', () => setColor(s, refs.ProbeImage.widget, 'ColorAndOpacity', IMAGE_COLOR));
    for (const name of Object.keys(LAYOUT)) if (refs[name] && refs[name].slot) await tryStep(`${name} anchors`, () => setAnchors(s, refs[name].slot, LAYOUT[name]));
    return { errors: propErrors };
  });
  await rec.step('compile', async () => {
    const out = await s.invoke('umg', 'CompileWidgetBlueprint', { widgetBlueprint: bpRef });
    return { returned: out.ok ? out.value : undefined, error: out.ok && out.value === true ? undefined : out.error || `returned ${cut(out.value, 200)}` };
  });
  await rec.step('save', async () => {
    const out = await s.invoke('asset', 'save_assets', { assetPaths: [WIDGET_ASSET] });
    return { returned: out.ok ? out.value : undefined, error: out.ok ? undefined : out.error };
  });
  await rec.step('read_back', async () => {
    const { widgets, count } = await readTree(s, bpRef);
    const by = (name) => widgets.find((w) => norm(w.name) === norm(name));
    const out = { widget_count: count, widgets: widgets.map((w) => ({ name: w.name, class: w.class })), anchors: {}, samples: {}, errors: [] };
    const read = async (label, fn) => { try { await fn(); } catch (error) { out.errors.push(`${label}: ${message(error)}`); } };
    const text = by('ProbeText'), button = by('ProbeButton'), image = by('ProbeImage');
    if (text) await read('text', async () => { const v = await s.getProps(text.widget, ['Text']); out.samples.Text = cut(getCI(v, ['Text']), 120); out.text_value = readText(getCI(v, ['Text'])); });
    if (button) await read('button colour', async () => { const v = await s.getProps(button.widget, ['BackgroundColor']); out.samples.BackgroundColor = cut(getCI(v, ['BackgroundColor']), 120); out.button_color = readColor(getCI(v, ['BackgroundColor'])) ?? null; });
    if (image) await read('image colour', async () => { const v = await s.getProps(image.widget, ['ColorAndOpacity']); out.image_color = readColor(getCI(v, ['ColorAndOpacity'])) ?? null; });
    for (const name of Object.keys(LAYOUT)) {
      const w = by(name);
      if (w && w.slot) await read(`${name} anchors`, async () => {
        const v = await s.getProps(w.slot, ['LayoutData']);
        if (name === 'ProbeText') out.samples.LayoutData = cut(getCI(v, ['LayoutData']), 300);
        const min = readVec2(getCI(v, ['LayoutData', 'Anchors', 'Minimum'])), max = readVec2(getCI(v, ['LayoutData', 'Anchors', 'Maximum']));
        out.anchors[name] = min && max ? { min, max } : null;
      });
    }
    if (text) await read('list_properties', async () => { out.samples.list_text = cut(await s.need('object', 'list_properties', { instance: text.widget }), 700); });
    await read('description', async () => { const d = await s.need('umg', 'GetWidgetDescription', { widgetBlueprint: bpRef }); out.description = cut(getCI(d, ['description']), 1500); });
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the session of the Common UI project

const BUTTON_ASSET = '/Game/UI/WBP_ProbeCommonButton', ACTIVATABLE_ASSET = '/Game/UI/WBP_ProbeActivatable', TABLE_ASSET = '/Game/UI/DT_ProbeActions', INPUT_DATA_ASSET = '/Game/UI/BP_ProbeInputData';
export const COMMONUI_ASSETS = { activatable: ACTIVATABLE_ASSET, inputData: INPUT_DATA_ASSET };

/** Find the settings section that holds a property by asking each section for its schema (a bounded search), set it, save the section and read it back. */
async function setSetting(s, propName, wantPath, leaf, rec, key) {
  await rec.step(key, async () => {
    const out = { found: null, set: false, saved: false, tried: 0 };
    const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');   // the whole schema: the property can be anywhere in it
    const containers = (await s.need('config', 'ListContainers', {})) || [];
    outer: for (const container of containers.filter((c) => /project/i.test(c)).concat(containers.filter((c) => !/project/i.test(c)))) {
      const listed = (await s.need('config', 'ListCategories', { containerName: container })) || [];
      const categories = ['Engine', 'Game', 'Project', 'Plugins'].filter((c) => listed.includes(c)).concat(listed.filter((c) => !['Engine', 'Game', 'Project', 'Plugins'].includes(c)));
      for (const category of categories) {
        const sections = (await s.need('config', 'ListSections', { containerName: container, categoryName: category })) || [];
        for (const section of sections) {
          if (out.tried >= 400) break outer;
          out.tried++;
          const r = await s.invoke('config', 'GetSectionSchema', { containerName: container, categoryName: category, sectionName: section });
          if (r.ok && new RegExp(`"${propName}"`, 'i').test(text(r.value))) { out.found = `${container} / ${category} / ${section}`; out.location = { container, category, section }; break outer; }
        }
      }
    }
    if (!out.location) return out;
    const loc = { containerName: out.location.container, categoryName: out.location.category, sectionName: out.location.section };
    const current = await s.need('config', 'GetSectionPropertyValues', { ...loc, propertyNames: [propName] });
    const parsed = typeof current === 'string' ? (() => { try { return JSON.parse(current); } catch { return current; } })() : current;
    const sample = getCI(parsed, [propName]);
    out.current = cut(sample, 160);
    const value = sample && typeof sample === 'object' && 'refPath' in sample ? { refPath: wantPath } : wantPath;
    const realKey = Object.keys(parsed || {}).find((k) => norm(k) === norm(propName)) ?? propName;
    out.set = (await s.need('config', 'SetSectionProperties', { ...loc, propertiesJson: JSON.stringify({ [realKey]: value }) })) === true;
    out.saved = (await s.need('config', 'SaveSection', loc)) === true;
    const back = await s.need('config', 'GetSectionPropertyValues', { ...loc, propertyNames: [propName] });
    out.read_back = cut(back, 200);
    out.saved = out.saved && new RegExp(leaf).test(cut(back, 400));
    delete out.location;
    return out;
  });
}

export async function commonUiSession({ client, say }) {
  const rec = new Recorder('session', 'commonui');
  const s = new Session(client);
  await discover(s, rec, ['umg', 'object', 'asset', 'blueprint', 'data_table', 'config']);
  say('  setting the Common UI pieces and building the widgets through the toolsets');
  const saved = [];

  await rec.step('table', async () => {
    const made = await s.need('data_table', 'create', { folderPath: '/Game/UI', assetName: 'DT_ProbeActions', schema: classRef('/Script/CommonUI.CommonInputActionDataBase') });
    const ref = refOf(made);
    if (!ref) throw new Error(`create returned ${cut(made, 200)}`);
    await s.need('data_table', 'add_rows', { dataTable: ref, rowNames: ['Confirm', 'Back'] });
    saved.push(TABLE_ASSET);
    return { created: true, rows_added: true, table: ref.refPath };
  });

  await rec.step('input_data', async () => {
    const made = await s.need('blueprint', 'create', { folderPath: '/Game/UI', assetName: 'BP_ProbeInputData', assetType: classRef('/Script/CommonInput.CommonUIInputData') });
    const bp = refOf(made);
    if (!bp) throw new Error(`create returned ${cut(made, 200)}`);
    const out = { created: true, click_set: false, back_set: false };
    const got = await s.getProps(bp, ['DefaultClickAction', 'DefaultBackAction']);
    out.sample = cut(got, 300);
    for (const [prop, row, flag] of [['DefaultClickAction', 'Confirm', 'click_set'], ['DefaultBackAction', 'Back', 'back_set']]) {
      const sample = getCI(got, [prop]);
      const tableKey = sample && typeof sample === 'object' ? Object.keys(sample).find((k) => norm(k) === 'datatable') : undefined;
      const value = {}; value[tableKey ?? 'DataTable'] = { refPath: assetRef(TABLE_ASSET).refPath }; value[(sample && typeof sample === 'object' ? Object.keys(sample).find((k) => norm(k) === 'rowname') : undefined) ?? 'RowName'] = row;
      await s.setProps(bp, { [Object.keys(got || {}).find((k) => norm(k) === norm(prop)) ?? prop]: value });
      const back = await s.getProps(bp, [prop]);
      out[flag] = new RegExp(row).test(cut(getCI(back, [prop]), 400));
    }
    try { await s.need('blueprint', 'compile_blueprint', { blueprint: bp, warningsAsErrors: false }); out.compiled = true; } catch (error) { out.compile_error = message(error); }
    saved.push(INPUT_DATA_ASSET);
    return out;
  });

  await setSetting(s, 'GameViewportClientClassName', '/Script/CommonUI.CommonGameViewportClient', 'CommonGameViewportClient', rec, 'config_viewport');
  await setSetting(s, 'InputData', `${assetRef(INPUT_DATA_ASSET).refPath}_C`, 'BP_ProbeInputData', rec, 'config_input');

  const buttonRef = assetRef(BUTTON_ASSET), actRef = assetRef(ACTIVATABLE_ASSET);
  await rec.step('button_blueprint', async () => {
    await s.need('umg', 'CreateWidgetBlueprint', { folderPath: '/Game/UI', assetName: 'WBP_ProbeCommonButton', parentClass: classRef('/Script/CommonUI.CommonButtonBase') });
    const out = { created: true, compiled: false };
    const border = await addWidget(s, buttonRef, '/Script/UMG.Border', 'ButtonBackground');
    const label = await addWidget(s, buttonRef, '/Script/UMG.TextBlock', 'ButtonLabel', border.widget);
    try { await setColor(s, border.widget, 'BrushColor', BUTTON_COLOR); } catch (error) { out.colour_error = message(error); }
    try { await setText(s, label.widget, 'GO', 32); } catch (error) { out.text_error = message(error); }
    out.compiled = (await s.need('umg', 'CompileWidgetBlueprint', { widgetBlueprint: buttonRef })) === true;
    saved.push(BUTTON_ASSET);
    return out;
  });

  await rec.step('activatable', async () => {
    await s.need('umg', 'CreateWidgetBlueprint', { folderPath: '/Game/UI', assetName: 'WBP_ProbeActivatable', parentClass: classRef('/Script/CommonUI.CommonActivatableWidget') });
    const out = { created: true, compiled: false, errors: [] };
    const root = await addWidget(s, actRef, '/Script/UMG.CanvasPanel', 'ProbeRoot');
    const text = await addWidget(s, actRef, '/Script/UMG.TextBlock', 'ProbeText', root.widget);
    const button = await addWidget(s, actRef, `${buttonRef.refPath}_C`, 'ProbeButton', root.widget);
    for (const [label, fn] of [['text', () => setText(s, text.widget, 'COMMON UI', 48)], ['text anchors', () => setAnchors(s, text.slot, LAYOUT.ProbeText)], ['button anchors', () => setAnchors(s, button.slot, LAYOUT.ProbeButton)]]) {
      try { await fn(); } catch (error) { out.errors.push(`${label}: ${message(error)}`); }
    }
    out.compiled = (await s.need('umg', 'CompileWidgetBlueprint', { widgetBlueprint: actRef })) === true;
    const { widgets } = await readTree(s, actRef);
    out.widgets = widgets.map((w) => ({ name: w.name, class: w.class }));
    out.has_common_button = widgets.some((w) => norm(w.name) === 'probebutton' && /WBP_ProbeCommonButton/.test(w.classPath));
    saved.push(ACTIVATABLE_ASSET);
    return out;
  });

  await rec.step('save', async () => {
    const out = await s.invoke('asset', 'save_assets', { assetPaths: saved });
    return { returned: out.ok ? out.value : undefined, error: out.ok ? undefined : out.error, assets: saved };
  });
  return rec.report;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// widget animation and MVVM: attempts in the base session, the read-back in a fresh editor

/** The argument object for a tool from its described parameter names: the first hint whose pattern matches a name supplies its value. Required names with no hint are listed. */
export function fillArgs(tool, hints) {
  const args = {}, unfilled = [];
  for (const p of tool ? tool.params : []) {
    const hit = hints.find(([re]) => re.test(p));
    if (hit) args[p] = typeof hit[1] === 'function' ? hit[1](p) : hit[1];
  }
  for (const r of tool ? tool.required : []) if (!(r in args)) unfilled.push(r);
  return { args, unfilled };
}

/** Call a described tool once with arguments filled from hints; the call is recorded whether it works or not and never sent again. */
async function tryCall(s, key, shortName, hints, calls) {
  const set = s.sets[key], tool = set && set.tools.find((t) => norm(t.short) === norm(shortName));
  const label = `${set ? set.name : key}.${shortName}`;
  if (!tool) { calls.push({ tool: label, ok: false, error: 'the tool is not in the described list' }); return undefined; }
  const { args, unfilled } = fillArgs(tool, hints);
  const out = await s.invoke(key, shortName, args);
  calls.push({ tool: label, ok: out.ok, args, unfilled, error: out.ok ? undefined : (out.timedOut ? 'timed out (read the state back before sending it again)' : out.error), value: out.ok ? cut(out.value, 500) : undefined });
  return out;
}

/** A small Widget Blueprint (canvas, text block) compiled and saved, for the animation and MVVM attempts. */
async function smallWidget(s, assetPath) {
  const folder = assetPath.slice(0, assetPath.lastIndexOf('/')), name = assetPath.split('/').pop(), bp = assetRef(assetPath);
  try { await s.need('asset', 'create_folder', { path: folder }); } catch { /* the UMG tool makes the folder itself, or says so */ }
  await s.need('umg', 'CreateWidgetBlueprint', { folderPath: folder, assetName: name, parentClass: classRef('/Script/UMG.UserWidget') });
  const root = await addWidget(s, bp, '/Script/UMG.CanvasPanel', 'ProbeRoot');
  const text = await addWidget(s, bp, '/Script/UMG.TextBlock', MVVM_NAMES.widget, root.widget);
  await setText(s, text.widget, 'MVVM PROBE', 32);
  const compiled = (await s.need('umg', 'CompileWidgetBlueprint', { widgetBlueprint: bp })) === true;
  const saved = (await s.need('asset', 'save_assets', { assetPaths: [assetPath] })) === true;
  return { created: true, compiled, saved, asset: assetPath, text_widget: text.widget.refPath };
}

async function describeAnimationToolsets(s, rec) {
  await rec.step('animation_toolsets', async () => {
    const names = (s.names || []).filter((n) => ANIMATION_TOOLSET_PATTERN.test(n));
    const toolsets = [];
    for (const name of names) {
      const out = await s.client.describeToolset(name);
      if (!out.ok) { toolsets.push({ name, tool_count: 0, tools: [], raw_length: 0, error: out.error }); continue; }
      const tools = collectTools(out.decoded), text = String(out.decoded.text || '');
      s.sets[`anim:${name}`] = { name, tools };
      toolsets.push({ name, tool_count: tools.length, tools: tools.map((t) => t.short), tool_params: Object.fromEntries(tools.map((t) => [t.short, t.params])), raw_length: text.length, raw: text.slice(0, 60000) });
    }
    return { toolsets, count: toolsets.length, listed: names };
  });
}

const hereDir = import.meta.dirname;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * Question 1. The eight animation toolsets are described first. A widget animation has to exist before a track can go on it, and no tool of the eight (or of the UMG toolset)
 * makes one, so editor Python makes the container (umg_anim_container.py, run through the stage script's rpc mode) and tries to link it; then the Sequencer tools are called on
 * it: the ones typed for a level sequence, and the one whose binding is typed for any movie scene sequence. Every call is made once and recorded with its message.
 */
async function animationAttempt(s, rec, py) {
  await describeAnimationToolsets(s, rec);
  let made;
  await rec.step('animation_blueprint', async () => { made = await smallWidget(s, ANIMATION_ASSET); return made; });
  await rec.step('animation_attempt', async () => {
    const calls = [];
    const out = { calls, track_added: false, key_added: false };
    const all = Object.entries(s.sets).filter(([k]) => k.startsWith('anim:')).flatMap(([, v]) => v.tools.map((t) => ({ set: v.name, short: t.short })));
    out.track_tools = all.filter((t) => /add.*track/i.test(t.short)).map((t) => `${t.set}.${t.short}`);
    out.key_tools = all.filter((t) => /add.*key/i.test(t.short)).map((t) => `${t.set}.${t.short}`);
    out.widget_tools = all.filter((t) => /widget|umg/i.test(t.short)).map((t) => `${t.set}.${t.short}`);
    const animName = ANIMATION_NAME, assetName = ANIMATION_ASSET.split('/').pop();
    const animRef = { refPath: `${ANIMATION_ASSET}.${assetName}:${animName}` };
    if (py) {
      const header = `ASSET = ${JSON.stringify(ANIMATION_ASSET)}\nANIM_NAME = ${JSON.stringify(animName)}\nTEXT_WIDGET = ${JSON.stringify(made ? made.text_widget : '')}\n`;
      const code = header + readFileSync(join(hereDir, 'umg_anim_container.py'), 'utf8');
      const answer = await py(code, { timeoutMs: 120000 });
      const steps = (answer.result && answer.result.steps) || [];
      out.container = { ok: answer.ok, error: answer.error, steps };
      out.note = answer.ok ? `editor Python, outside the toolsets: ${steps.map((x) => `${x.step}: ${x.ok ? 'ok' : `FAILED ${x.error}`}`).join('; ')}` : `the container script failed: ${answer.error}`;
    } else out.note = 'no editor Python was available beside the server, so no animation container was made';
    const key = (shortName) => Object.keys(s.sets).find((k) => k.startsWith('anim:') && s.sets[k].tools.some((t) => norm(t.short) === norm(shortName)));
    const floatTrack = classRef('/Script/MovieSceneTracks.MovieSceneFloatTrack');
    const seqKey = key('add_track_to_sequence'), bindKey = key('add_track_to_binding');
    if (seqKey) await tryCall(s, seqKey, 'add_track_to_sequence', [[/sequence/i, animRef], [/track.?type/i, floatTrack]], calls);
    if (bindKey) {
      const added = await tryCall(s, bindKey, 'add_track_to_binding', [[/binding/i, { bindingId: ZERO_GUID, sequence: animRef }], [/track.?type/i, floatTrack]], calls);
      out.track_added = Boolean(added && added.ok && refOf(added.value));
    }
    return out;
  });
}

const vmParent = '/Script/ModelViewViewModel.MVVMViewModelBase';

/**
 * Question 2: the MVVM tools in the order the toolset allows, read back with the three List tools, then compile and save. The argument shapes are the toolset's own
 * (run A-Q2 run 1 recorded them): CreateViewModel takes a name, a package path and a parent class; AddViewModelProperty a view model asset, a name, a pin type and a default
 * value; AddViewModelToWidget the widget blueprint and the generated view model class; CreateViewBinding the widget blueprint, a source context (the view model class), a
 * source property path, a destination context (the widget) and a destination property path; ListViewModels a search path.
 */
async function mvvmAttempt(s, rec) {
  let made;
  await rec.step('mvvm_blueprint', async () => { made = await smallWidget(s, MVVM_ASSET); return made; });
  const bp = assetRef(MVVM_ASSET), calls = [];
  const out = { calls, view_model_created: false, property_added: false, added_to_widget: false, binding_created: false };
  const vmPath = `${MVVM_NAMES.viewModelFolder}/${MVVM_NAMES.viewModel}`;
  let vmAsset = assetRef(vmPath);
  const widgetRef = { refPath: made ? made.text_widget : `${MVVM_ASSET}.WBP_ProbeMvvm:WidgetTree.${MVVM_NAMES.widget}` };
  await rec.step('mvvm_calls', async () => {
    const created = await tryCall(s, 'mvvm', 'CreateViewModel', [
      [/package|folder|directory/i, MVVM_NAMES.viewModelFolder], [/name/i, MVVM_NAMES.viewModel], [/parent|base|class/i, classRef(vmParent)],
    ], calls);
    if (created && created.ok) {
      out.view_model_created = true;
      vmAsset = refOf(created.value) || vmAsset;
    }
    const vmClass = classRef(`${vmAsset.refPath}_C`);
    if (out.view_model_created) {
      for (const pinType of ['text', 'string']) {
        const prop = await tryCall(s, 'mvvm', 'AddViewModelProperty', [
          [/default/i, 'Probe'], [/view.?model|blueprint|asset/i, vmAsset], [/property.?name|^name$/i, MVVM_NAMES.property], [/type/i, pinType],
        ], calls);
        out.property_added = Boolean(prop && prop.ok && prop.value !== false);
        out.property_type = pinType;
        if (out.property_added) break;
      }
      // the generated class holds the property only after the view model blueprint is compiled (A-Q2 run 3: CreateViewBinding said "Property does not exist in 'VM_ProbeScore_C'" before it)
      if (out.property_added) {
        const compiled = await tryCall(s, 'blueprint', 'compile_blueprint', [[/blueprint/i, vmAsset], [/warnings/i, false]], calls);
        out.view_model_compiled = Boolean(compiled && compiled.ok);
      }
      const added = await tryCall(s, 'mvvm', 'AddViewModelToWidget', [[/view.?model/i, vmClass], bpHint0(bp)], calls);
      out.added_to_widget = Boolean(added && added.ok);
      const bound = await tryCall(s, 'mvvm', 'CreateViewBinding', [
        [/source.*context/i, vmClass], [/dest.*context/i, widgetRef], [/source.*(property|path)/i, MVVM_NAMES.property], [/dest.*(property|path)/i, MVVM_NAMES.widgetProperty], [/conversion/i, ''], bpHint0(bp),
      ], calls);
      out.binding_created = Boolean(bound && bound.ok);
      out.binding_id = bound && bound.ok ? cut(bound.value, 80) : undefined;
    }
    return out;
  });
  await rec.step('mvvm_lists', async () => {
    const lists = [];
    const a = await tryCall(s, 'mvvm', 'ListViewModels', [[/search|path/i, MVVM_NAMES.viewModelFolder]], lists);
    const b = await tryCall(s, 'mvvm', 'ListWidgetViewModels', [bpHint0(bp)], lists);
    const c = await tryCall(s, 'mvvm', 'ListWidgetViewBindings', [bpHint0(bp)], lists);
    const has = (r, words) => Boolean(r && r.ok) && words.every((w) => JSON.stringify(r.value ?? '').includes(w));
    return {
      view_model_listed: has(a, [MVVM_NAMES.viewModel]), widget_view_model_listed: has(b, [MVVM_NAMES.viewModel]), binding_listed: has(c, [MVVM_NAMES.property]),
      calls: lists, excerpt: `ListViewModels ${cut(a && a.value, 300)} | ListWidgetViewModels ${cut(b && b.value, 300)} | ListWidgetViewBindings ${cut(c && c.value, 600)}`,
    };
  });
  await rec.step('mvvm_compile', async () => {
    const compile = await s.invoke('umg', 'CompileWidgetBlueprint', { widgetBlueprint: bp });
    const saveAssets = [MVVM_ASSET, ...(out.view_model_created ? [vmAsset.refPath.split('.')[0]] : [])];
    const save = await s.invoke('asset', 'save_assets', { assetPaths: saveAssets });
    return { returned: compile.ok ? compile.value : undefined, error: compile.ok && compile.value === true ? undefined : compile.error || `returned ${cut(compile.value, 200)}`, saved: save.ok ? save.value : undefined, saved_assets: saveAssets, save_error: save.ok ? undefined : save.error };
  });
}
const bpHint0 = (bp) => [/widget.?blueprint|^blueprint$|^widget$/i, bp];

// ---------------------------------------------------------------------------------------------------------------------------------
// the fresh editor: read the saved blueprints back

const CRAWL_NAMES = ['Animations', 'MovieScene', 'AnimationBindings', 'ObjectBindings', 'Tracks', 'MasterTracks', 'Sections', 'Channels', 'FloatCurve', 'Times', 'Values', 'Keys', 'PropertyName', 'PropertyPath', 'Possessables'];

/** Walk object references from a blueprint through its animations, a bounded number of objects deep, recording what each object lists and what was read. */
async function crawl(s, root, limit = 60) {
  const seen = new Set(), queue = [{ ref: root, depth: 0 }], visited = [];
  while (queue.length && visited.length < limit) {
    const { ref, depth } = queue.shift();
    if (seen.has(ref.refPath) || depth > 8) continue;
    seen.add(ref.refPath);
    const entry = { ref: ref.refPath, depth };
    visited.push(entry);
    try {
      const listed = await s.need('object', 'list_properties', { instance: ref });
      const text = typeof listed === 'string' ? listed : JSON.stringify(listed);
      entry.listed = cut(text, 600);
      const names = CRAWL_NAMES.filter((n) => new RegExp(`"?\\b${n}\\b"?`).test(text));
      if (!names.length) continue;
      const got = await s.getProps(ref, names);
      entry.read = got;
      const found = [];
      const scan = (v) => { if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') { if (typeof v.refPath === 'string') found.push(v); else Object.values(v).forEach(scan); } else if (typeof v === 'string' && /^\/(Game|Engine|Script)\//.test(v)) found.push({ refPath: v }); };
      scan(got);
      for (const f of found) queue.push({ ref: f, depth: depth + 1 });
    } catch (error) { entry.error = message(error); }
  }
  return visited;
}

export async function readbackSession({ client, say, animation, mvvm, projectDir }) {
  const rec = new Recorder('readback', 'base');
  const s = new Session(client);
  await discover(s, rec, ['umg', 'mvvm', 'object']);
  if (animation) {
    say('  reading the animation back from the saved Widget Blueprint');
    await rec.step('animation_readback', async () => {
      const visited = await crawl(s, assetRef(ANIMATION_ASSET));
      const trees = visited.map((v) => v.read).filter(Boolean);
      const counts = summarizeAnimationTree(trees);
      const animations = visited.filter((v) => v.depth === 1).map((v) => v.ref);   // the references the blueprint's Animations list holds
      // an asset reference resolves to the class default object, which has no animation list, so the saved file is also searched for the names a widget animation writes
      const file = projectDir ? join(projectDir, 'Content', ...ANIMATION_ASSET.replace('/Game/', '').split('/')) + '.uasset' : '';
      const markers = {};
      if (file && existsSync(file)) {
        const bytes = readFileSync(file);
        for (const name of ['WidgetAnimation', 'MovieScene', 'MovieSceneFloatTrack', 'MovieSceneFloatSection', ANIMATION_NAME]) markers[name] = bytes.toString('latin1').split(name).length - 1;
      }
      const foundInFile = (markers.WidgetAnimation || 0) > 0 && (markers[ANIMATION_NAME] || 0) > 0;
      return {
        animation_found: animations.length > 0 || counts.tracks > 0 || foundInFile, animations: animations.length ? animations : foundInFile ? [`${ANIMATION_NAME} (named in the saved asset)`] : [],
        track_count: counts.tracks + ((markers.MovieSceneFloatTrack || 0) > 0 ? 1 : 0), key_count: counts.keys, section_count: counts.sections, file_markers: markers, visited: visited.length, crawl: visited,
        note: `walked ${visited.length} objects from ${ANIMATION_ASSET}; names in the saved file: ${JSON.stringify(markers)}`,
      };
    });
  }
  if (mvvm && s.sets.mvvm) {
    say('  reading the view models and the binding back from the saved Widget Blueprint');
    await rec.step('mvvm_readback', async () => {
      const calls = [];
      const bp = assetRef(MVVM_ASSET);
      const a = await tryCall(s, 'mvvm', 'ListWidgetViewModels', [bpHint0(bp)], calls);
      const b = await tryCall(s, 'mvvm', 'ListWidgetViewBindings', [bpHint0(bp)], calls);
      const bindingText = JSON.stringify((b && b.value) ?? '');
      return { binding_present: Boolean(b && b.ok) && bindingText.includes(MVVM_NAMES.property), view_model_present: Boolean(a && a.ok) && JSON.stringify(a.value ?? '').includes(MVVM_NAMES.viewModel), calls, excerpt: `ListWidgetViewModels ${cut(a && a.value, 300)} | ListWidgetViewBindings ${cut(b && b.value, 400)}` };
    });
  }
  return rec.report;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the Slate inspector, called from node while the stage script waits in Play In Editor

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const MODS = { bShift: false, bCtrl: false, bAlt: false, bCmd: false };

/** The click counter and the button state the stage script publishes once a second while it waits (null when it has not written them). */
function readWait(readStage) {
  const stage = readStage && readStage();
  const wait = stage && stage.steps && stage.steps.input_wait;
  return wait ? { clicks: wait.clicks, state: wait.state, mouse: wait.mouse } : { clicks: null, state: null, mouse: null };
}

/**
 * Describe the Slate inspector toolset (kept word for word), call its tools that need no argument, then, when the stage script is publishing the click counter, drive the
 * active Common button through it: Observe all windows, Snapshot, find the "GO" widget's ref, Hover, Click and PressKey it, and read the counter and the button state after
 * each; the Content Drawer button of the editor is clicked last as the control that a Slate click reaches editor widgets (the snapshot must grow). Each call is made once.
 */
export async function slateSession({ client, say, readStage, settleMs = 1500 }) {
  const rec = new Recorder('slate', 'commonui');
  const s = new Session(client);
  await discover(s, rec, ['slate'], ['slate']);
  const described = rec.report.steps.find((x) => x.step === 'describe_slate') || {};
  rec.report.steps.push({ step: 'slate_describe', toolset: described.toolset, tool_count: described.tool_count || 0, tools: described.tools || [], tool_params: described.tool_params, raw_length: described.raw_length || 0, raw: described.raw, error: described.error || (s.sets.slate ? undefined : 'the Slate inspector toolset is not listed') });
  if (!s.sets.slate) return rec.report;
  say('  calling the Slate inspector tools that need no argument');
  await rec.step('slate_routes', async () => {
    const routes = [];
    for (const tool of s.sets.slate.tools) {
      const input = /click|press|key|simulate|input|focus|navigate|mouse|type|send|hover|drag|fill/i.test(tool.short);
      if (tool.required.length || input) {
        routes.push({ route: `slate inspector ${tool.short}`, kind: input ? 'input' : 'read', tried: false, delivered: false, observed: false, detail: `not called in this step: ${tool.required.length ? `needs ${tool.required.join(', ')}` : 'an input-like tool'}` });
        continue;
      }
      const out = await s.invoke('slate', tool.short, {});
      routes.push({ route: `slate inspector ${tool.short}`, kind: 'read', tried: true, delivered: false, observed: false, detail: out.ok ? cut(out.value, 800) : undefined, error: out.ok ? undefined : (out.timedOut ? 'timed out' : out.error) });
    }
    return { routes };
  });
  if (!readStage) return rec.report;
  say('  driving the Common button through the Slate inspector');
  await rec.step('slate_input', async () => {
    const routes = [];
    const snapshot = async () => { const r = await s.invoke('slate', 'Snapshot', { ref: '', maxDepth: 60, bIncludeSourceLocations: false }); return r.ok && typeof r.value === 'string' ? r.value : ''; };
    const observed = await s.invoke('slate', 'Observe', { ref: '', maxDepth: 60 });
    await sleepMs(settleMs);
    const tree = await snapshot();
    const goRef = findSlateRef(tree, /generic "GO"/) || findSlateRef(tree, /text "GO"/), drawerRef = findSlateRef(tree, /button "Content Drawer"/);
    const excerpt = tree.split('\n').filter((l) => /COMMON UI|"GO"|Content Drawer/.test(l)).map((l) => l.trim()).slice(0, 8);
    const shown = { observe: observed.ok ? cut(observed.value, 80) : observed.error, lines: tree ? tree.split('\n').length : 0, button_ref: goRef, drawer_ref: drawerRef, excerpt };
    const drive = async (route, kind, tool, args) => {
      const before = readWait(readStage);
      const out = await s.invoke('slate', tool, args);
      await sleepMs(settleMs);
      const after = readWait(readStage);
      const clicked = after.clicks !== null && before.clicks !== null && after.clicks > before.clicks;
      const changed = Object.keys(after.state || {}).filter((k) => JSON.stringify((before.state || {})[k]) !== JSON.stringify(after.state[k]));
      routes.push({
        route, kind, tried: true, delivered: out.ok && out.value === true, observed: kind !== 'precondition' && (clicked || changed.length > 0),
        detail: `${tool} returned ${out.ok ? cut(out.value, 60) : out.error}; click counter ${before.clicks} to ${after.clicks}; button state changed ${JSON.stringify(changed)}; the game viewport sees the cursor at ${JSON.stringify(before.mouse)} then ${JSON.stringify(after.mouse)}`,
        error: out.ok ? undefined : (out.timedOut ? 'timed out' : out.error),
      });
    };
    if (goRef) {
      await drive(`slate inspector Hover on the Common button (${goRef})`, 'precondition', 'Hover', { ref: goRef });
      await drive(`slate inspector Click on the Common button (${goRef})`, 'input', 'Click', { ref: goRef, button: 'left', doubleClick: false, modifiers: MODS });
      await drive('slate inspector PressKey Enter', 'input', 'PressKey', { key: 'Enter' });
    } else routes.push({ route: 'slate inspector Click on the Common button', kind: 'input', tried: true, delivered: false, observed: false, error: `no widget named GO in the snapshot (${shown.lines} lines)` });
    if (drawerRef) {
      const before = tree.split('\n').length;
      const out = await s.invoke('slate', 'Click', { ref: drawerRef, button: 'left', doubleClick: false, modifiers: MODS });
      await sleepMs(settleMs);
      const after = (await snapshot()).split('\n').length;
      routes.push({ route: `control: slate inspector Click on the editor's Content Drawer button (${drawerRef})`, kind: 'control', tried: true, delivered: out.ok && out.value === true, observed: after > before + 10, detail: `Click returned ${out.ok ? cut(out.value, 60) : out.error}; snapshot lines ${before} to ${after}` });
    }
    return { routes, ...shown };
  });
  return rec.report;
}

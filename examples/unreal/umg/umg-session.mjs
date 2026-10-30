// The MCP half of the UMG probe: drives a running editor through Epic's MCP server (umg-mcp.mjs) and returns a report of steps for umg-probe-checks.mjs.
//   baseSession      list_toolsets, describe_toolset for the UMG, MVVM and widget-animation toolsets, then the widget: a Widget Blueprint with a canvas, a text
//                    block, a button and an image, properties set through the object toolset, compiled, saved, read back
//   commonUiSession  the Common UI quickstart pieces that can be reached from a script (a data table, an input data Blueprint, two project settings) and an
//                    activatable widget with a Common button
// The tools are found by name in the lists the server returns and their argument names are matched against the schemas it describes, so a spelling difference
// between builds is a recorded result and not a crash. A write is never sent twice: only a call refused because the tool name was not found is sent again, with the
// other spelling of the name (short or qualified).
import {
  norm, pickName, collectToolsetNames, collectTools, returnValue, getCI, setCI, readVec2, readColor, vec2Like, colorLike, textLike, readText,
  hasTool, PROBE_TEXT, LAYOUT, BUTTON_COLOR, IMAGE_COLOR, WIDGET_ASSET, UMG_CORE_TOOLS,
} from './umg-probe-checks.mjs';

const PATTERNS = {
  umg: /(^|\.)UMGToolSet(\.|$)/i, mvvm: /mvvm/i, widget_animation: /widget.?animation|umg.?animation/i,
  object: /ObjectTools$/i, asset: /AssetTools$/i, blueprint: /BlueprintTools$/i, data_table: /DataTableTools$/i, config: /ConfigSettings/i,
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
      const refused = !out.ok && !out.timedOut && /not found|unknown tool|no such tool|unrecognized tool|invalid tool|does not exist/i.test(out.error || '');
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

async function discover(s, rec, keys) {
  const client = s.client;
  const meta = await rec.step('meta_tools', async () => { const t = await client.listTools(); return { names: t.names, call_tool_arguments_type: t.argumentsType, error: t.error }; });
  let names = [];
  await rec.step('list_toolsets', async () => {
    const out = await client.listToolsets();
    if (!out.ok) throw new Error(out.error);
    names = collectToolsetNames(out.decoded);
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

export async function baseSession({ client, say, build }) {
  const rec = new Recorder('session', 'base');
  const s = new Session(client);
  const keys = ['umg', 'mvvm', 'widget_animation', 'object', 'asset'];
  await discover(s, rec, keys);
  if (!build) return rec.report;

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
  return rec.report;
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

// node --test examples/unreal/umg/umg-probe.test.mjs
// The pure judging code of the UMG probe (umg-probe-checks.mjs), its MCP client against a small fake server (umg-mcp.mjs) and its session logic against a fake
// editor (umg-session.mjs). No Unreal. Each check changes one fact of a passing report and expects the matching check to fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../niagara_toolsets/nts-probe-assets.mjs';
import {
  GROUPS, PHASES, planPhases, parseProbeOptions, looksLikeMemoryFailure, takeSseEvents, decodeToolResult, returnValue, collectToolsetNames, collectTools, hasTool,
  getCI, setCI, readVec2, readColor, vec2Like, colorLike, textLike, readText, regionCount, changedInRegion, judgeFrames, judgeRoutes, shotTable, shotNames,
  evaluateProbes, summarize, decodePng, LAYOUT, PROBE_TEXT, UMG_CORE_TOOLS, isBright, isRed,
} from './umg-probe-checks.mjs';
import { McpClient, waitForServer } from './umg-mcp.mjs';
import { baseSession, commonUiSession, partialFrom } from './umg-session.mjs';

const here = import.meta.dirname;
const passed = (checks) => checks.every((c) => c.pass);
const failing = (checks) => checks.filter((c) => !c.pass).map((c) => c.name);

// ---------------------------------------------------------------- images
const W = 320, H = 180;
function frame(paint = () => undefined) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([0, 0, 0, 255], i * 4);
  const img = { width: W, height: H, rgba };
  paint(img);
  return img;
}
function fill(img, box, color, every = 1) {
  for (let y = Math.floor(box.min[1] * H); y < Math.ceil(box.max[1] * H); y++) {
    for (let x = Math.floor(box.min[0] * W); x < Math.ceil(box.max[0] * W); x++) if ((x + y) % every === 0) img.rgba.set([...color, 255], (y * W + x) * 4);
  }
}
const withWidget = () => frame((img) => {
  fill(img, LAYOUT.ProbeText, [255, 255, 255], 6);
  fill(img, LAYOUT.ProbeButton, [200, 20, 20]);
  fill(img, LAYOUT.ProbeImage, [20, 200, 20]);
});
const without = () => frame();

// ---------------------------------------------------------------- reports
const REAL_TOOLS = (names) => names.map((n) => ({ name: `UMGToolSet.UMGToolSet.${n}`, description: n, inputSchema: { type: 'object', properties: { widgetBlueprint: {} }, required: [] } }));
function goodSession() {
  const widgets = [['ProbeRoot', 'CanvasPanel'], ['ProbeText', 'TextBlock'], ['ProbeButton', 'Button'], ['ProbeButtonLabel', 'TextBlock'], ['ProbeImage', 'Image']].map(([name, cls]) => ({ name, class: cls }));
  return {
    probe: 'session', project: 'base',
    steps: [
      { step: 'connect', ready_seconds: 40, session_id: true, protocol_version: '2025-03-26' },
      { step: 'meta_tools', names: ['list_toolsets', 'describe_toolset', 'call_tool'] },
      { step: 'list_toolsets', names: ['UMGToolSet.UMGToolSet', 'MVVMToolset.MVVMToolset', 'WidgetAnimationToolset.WidgetAnimationToolset'], count: 3 },
      { step: 'resolve', umg: 'UMGToolSet.UMGToolSet', mvvm: 'MVVMToolset.MVVMToolset', widget_animation: 'WidgetAnimationToolset.WidgetAnimationToolset', object: 'editor_toolset.toolsets.object.ObjectTools', asset: 'editor_toolset.toolsets.asset.AssetTools', toolset_count: 3, sample: [] },
      { step: 'describe_umg', tool_count: 23, tools: [...UMG_CORE_TOOLS, 'ListWidgetClasses'] },
      { step: 'describe_mvvm', tool_count: 9, tools: ['CreateViewModel'] },
      { step: 'describe_widget_animation', tool_count: 4, tools: ['AddAnimation'] },
      { step: 'describe_object', tool_count: 6, tools: ['get_properties', 'set_properties', 'list_properties'] },
      { step: 'describe_asset', tool_count: 21, tools: ['save_assets', 'create_folder'] },
      { step: 'create', created: true, route: 'mcp', name_form: 'short' },
      { step: 'tree', added: [], errors: [] },
      { step: 'properties', errors: [] },
      { step: 'compile', returned: true },
      { step: 'save', returned: true },
      { step: 'read_back', widget_count: 5, widgets, text_value: PROBE_TEXT, button_color: [1, 0, 0, 1], image_color: [0, 1, 0, 1],
        anchors: Object.fromEntries(Object.entries(LAYOUT).map(([k, b]) => [k, { min: b.min, max: b.max }])), errors: [] },
    ],
  };
}
const stageShots = () => [
  { label: 'base', route: 'showui', stem: 'umg_base_showui' }, { label: 'base', route: 'hires', stem: 'umg_base_hires' },
  { label: 'widget', route: 'showui', stem: 'umg_widget_showui' }, { label: 'widget', route: 'hires', stem: 'umg_widget_hires' },
];
function goodStage(extra = {}) {
  return {
    probe: 'stage', mode: 'widget',
    steps: { asset: { asset_loaded: true, class_loaded: true, class_name: 'WBP_ProbeHud_C', blueprint_status: 'BlueprintStatus.UP_TO_DATE' }, viewport: { width: 1280, height: 720 },
      create: { created: true, class_name: 'WBP_ProbeHud_C' }, added: { class_name: 'WBP_ProbeHud_C', in_viewport: true } },
    shots: stageShots(), events: [], ...extra,
  };
}
const goodImages = () => ({ umg_base_showui: without(), umg_widget_showui: withWidget(), umg_base_hires: without(), umg_widget_hires: withWidget() });
const goodBase = () => ({ session: goodSession(), capture: goodStage(), images: goodImages() });

function goodCommonSession() {
  return {
    probe: 'session', project: 'commonui',
    steps: [
      { step: 'table', created: true, rows_added: true }, { step: 'input_data', created: true, click_set: true, back_set: true },
      { step: 'config_viewport', found: 'Project / Engine / General Settings', set: true, saved: true }, { step: 'config_input', found: 'Project / Game / Common Input Settings', set: true, saved: true },
      { step: 'button_blueprint', created: true, compiled: true }, { step: 'activatable', created: true, compiled: true, has_common_button: true }, { step: 'save', returned: true },
    ],
  };
}
function goodCommonStage() {
  return goodStage({
    mode: 'commonui',
    steps: {
      asset: { class_loaded: true, blueprint_status: 'BlueprintStatus.UP_TO_DATE' },
      settings: { engine: { values: { GameViewportClientClassName: '/Script/CommonUI.CommonGameViewportClient' } }, input_settings: { values: { InputData: '/Game/UI/BP_ProbeInputData.BP_ProbeInputData_C' } } },
      before_activation: { in_viewport: false, activated: false, is_activatable: true }, added: { in_viewport: true, activated: false, is_activatable: true }, after_activation: { in_viewport: true, activated: true, is_activatable: true },
    },
  });
}
const goodCommon = () => ({ session: goodCommonSession(), capture: goodCommonStage(), images: goodImages() });
const everything = () => evaluateProbes({ groups: GROUPS, reports: { base: goodBase(), commonui: goodCommon() } });
const mutateSession = (fn) => { const base = goodBase(); fn(base.session.steps, base); return base; };
const setStep = (steps, name, patch) => Object.assign(steps.find((s) => s.step === name), patch);

test('a report in which every claim holds passes every check', () => {
  const checks = everything();
  assert.equal(passed(checks), true, failing(checks).join(' | '));
  assert.ok(checks.length >= 20);
  assert.deepEqual(summarize(checks), { passed: checks.length, total: checks.length });
  for (const c of checks) assert.ok(c.group && c.name && c.claim && typeof c.detail === 'string', JSON.stringify(c));
});

test('an empty or missing report fails the groups instead of throwing', () => {
  for (const reports of [undefined, {}, { base: {}, commonui: {} }]) {
    const checks = evaluateProbes({ groups: GROUPS, reports });
    assert.ok(checks.length >= 20);
    assert.equal(checks.some((c) => c.pass && c.group !== 'capture'), false, failing(checks).join(' | '));
  }
});

// ---------------------------------------------------------------- toolsets
test('toolsets: each toolset has its own check and absence is recorded in the detail', () => {
  const one = (fn) => evaluateProbes({ groups: ['toolsets'], reports: { base: mutateSession(fn) } });
  const noAnim = one((steps) => { setStep(steps, 'resolve', { widget_animation: undefined, absent: ['widget_animation'], toolset_count: 34, sample: ['A.B'] }); });
  assert.deepEqual(failing(noAnim), ['the widget-animation toolset is listed with its tools']);
  assert.match(noAnim.find((c) => !c.pass).detail, /absent \(34 toolsets listed/);
  const noMvvm = one((steps) => { setStep(steps, 'resolve', { mvvm: undefined }); });
  assert.deepEqual(failing(noMvvm), ['the MVVM toolset is listed with its tools']);
  const fewUmg = one((steps) => { setStep(steps, 'describe_umg', { tools: ['AddWidget'], tool_count: 1 }); });
  assert.deepEqual(failing(fewUmg), ['the UMG toolset is listed with its tools']);
  assert.match(fewUmg.find((c) => !c.pass).detail, /missing CreateWidgetBlueprint/);
  const noSession = one((steps) => { setStep(steps, 'connect', { session_id: false }); });
  assert.deepEqual(failing(noSession), ['the MCP server answers over loopback with a session']);
  const noObject = one((steps) => { setStep(steps, 'resolve', { object: undefined }); });
  assert.deepEqual(failing(noObject), ['the object and asset toolsets the widget route needs are listed']);
  const refused = one((steps) => { steps.splice(0, steps.length, { step: 'connect', error: 'no answer within 420 s' }); });
  assert.ok(failing(refused).length >= 5);
});

// ---------------------------------------------------------------- widget
test('widget: each fact has its own check', () => {
  const run = (fn) => evaluateProbes({ groups: ['widget'], reports: { base: mutateSession(fn) } });
  assert.deepEqual(failing(run((steps) => setStep(steps, 'create', { created: false, error: 'CreateWidgetBlueprint: refused' }))), ['a Widget Blueprint is created through the toolset']);
  assert.deepEqual(failing(run((steps) => setStep(steps, 'read_back', { widgets: [{ name: 'ProbeRoot', class: 'CanvasPanel' }] }))), ['a canvas, a text block, a button and an image are in the tree']);
  assert.deepEqual(failing(run((steps) => setStep(steps, 'read_back', { text_value: 'Text Block' }))), ['the properties set through the object toolset read back as set']);
  assert.deepEqual(failing(run((steps) => setStep(steps, 'read_back', { button_color: [0.5, 0.5, 0.5, 1] }))), ['the properties set through the object toolset read back as set']);
  assert.deepEqual(failing(run((steps) => setStep(steps, 'read_back', { anchors: { ProbeText: null } }))), ['the properties set through the object toolset read back as set']);
  assert.deepEqual(failing(run((steps) => setStep(steps, 'compile', { returned: false }))), ['the blueprint compiles, saves and loads as a compiled class in a new process']);
  const stale = goodBase();
  stale.capture.steps.asset.blueprint_status = 'BlueprintStatus.DIRTY';
  assert.deepEqual(failing(evaluateProbes({ groups: ['widget'], reports: { base: stale } })), ['the blueprint compiles, saves and loads as a compiled class in a new process']);
  const noCapture = goodBase();
  delete noCapture.capture;
  assert.equal(passed(evaluateProbes({ groups: ['widget'], reports: { base: noCapture } })), true, 'without the capture phase the compile and save still count');
});

// ---------------------------------------------------------------- capture
test('capture: the text, the button and the route are judged from the frames', () => {
  const run = (images, stage = goodStage()) => evaluateProbes({ groups: ['capture'], reports: { base: { session: goodSession(), capture: stage, images } } });
  assert.equal(passed(run(goodImages())), true);
  const noText = frame((img) => { fill(img, LAYOUT.ProbeButton, [200, 20, 20]); });
  const a = run({ ...goodImages(), umg_widget_showui: noText, umg_widget_hires: noText });
  assert.deepEqual(failing(a), ['the saved frame shows the text', 'the capture route is named']);
  const noButton = frame((img) => { fill(img, LAYOUT.ProbeText, [255, 255, 255], 6); fill(img, LAYOUT.ProbeImage, [20, 200, 20]); });
  const b = run({ ...goodImages(), umg_widget_showui: noButton, umg_widget_hires: noButton });
  assert.deepEqual(failing(b), ['the saved frame shows the button', 'the capture route is named']);
  const same = run({ ...goodImages(), umg_widget_showui: without(), umg_widget_hires: without() });
  assert.ok(failing(same).includes('the saved frame shows the text') && failing(same).includes('the saved frame shows the button'));
  // one route shows the widget and the other does not: the checks pass and the route is named
  const oneRoute = run({ ...goodImages(), umg_widget_hires: without() });
  assert.equal(passed(oneRoute), true);
  assert.match(oneRoute.find((c) => c.name === 'the capture route is named').detail, /shown by showui; not shown by hires/);
  const missing = run({});
  assert.ok(failing(missing).includes('frames were saved with and without the widget'));
  const offByOne = run({ ...goodImages(), umg_widget_showui: { ...withWidget(), width: W - 1 }, umg_widget_hires: { ...withWidget(), width: W - 1 } });
  assert.ok(failing(offByOne).includes('frames were saved with and without the widget'));
  const notAdded = goodStage();
  notAdded.steps.added.in_viewport = false;
  assert.deepEqual(failing(run(goodImages(), notAdded)), ['the compiled widget is created and added to the viewport of a Play-In-Editor session']);
  assert.equal(run({}, null).find((c) => c.name.startsWith('the compiled widget')).pass, false);
});

test('frames: the region checks read pixels inside the boxes only', () => {
  const shown = withWidget(), base = without();
  const j = judgeFrames(base, shown);
  assert.deepEqual([j.comparable, j.text, j.button], [true, true, true]);
  assert.ok(j.image > 0.9);
  assert.ok(regionCount(shown, LAYOUT.ProbeButton, isRed).count > 0.9 * regionCount(shown, LAYOUT.ProbeButton, isRed).total);
  assert.equal(regionCount(shown, LAYOUT.ProbeImage, isBright).count, 0);
  assert.ok(changedInRegion(base, shown, LAYOUT.ProbeText) > 0);
  assert.equal(changedInRegion(base, shown, { min: [0.0, 0.95], max: [0.2, 1.0] }), 0, 'nothing changed outside the boxes');
  assert.equal(changedInRegion(base, { ...shown, height: H + 1 }, LAYOUT.ProbeText), -1);
  // a frame that already had the colours in it does not count as the widget being shown
  const redBefore = frame((img) => fill(img, LAYOUT.ProbeButton, [200, 20, 20]));
  assert.equal(judgeFrames(redBefore, shown).button, false);
  const dim = frame((img) => { fill(img, LAYOUT.ProbeText, [90, 90, 90], 1); fill(img, LAYOUT.ProbeButton, [200, 20, 20]); });
  assert.equal(judgeFrames(base, dim).text, false, 'grey text under the brightness cut is not read as shown');
  assert.equal(judgeFrames(undefined, shown).comparable, false);
  const routes = judgeRoutes(goodStage(), goodImages());
  assert.deepEqual(routes.named, ['showui', 'hires']);
  assert.deepEqual(shotTable(goodStage()).widget, { showui: 'umg_widget_showui', hires: 'umg_widget_hires' });
  assert.deepEqual(shotNames(goodStage()), stageShots().map((s) => s.stem));
  assert.deepEqual(shotNames(undefined), []);
});

test('frames: a frame of the whole editor window is judged inside the viewport the button places', () => {
  // a 640x360 window shot: chrome around a 507x275 viewport at (10, 40), half the size the stage read (1014x550); the scene moves a little between the frames
  const WW = 640, WH = 360, rect = { x0: 10, y0: 40, w: 507, h: 275 };
  const windowFrame = (widgets, seed) => {
    const rgba = Buffer.alloc(WW * WH * 4);
    for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) {
      const inside = x >= rect.x0 && x < rect.x0 + rect.w && y >= rect.y0 && y < rect.y0 + rect.h;
      const sky = inside ? 120 + ((x * 7 + y * 13 + (seed && (x + y) % 9 === 0 ? 60 : 0)) % 90) : 35;   // a bright, busy scene with moving pixels
      rgba.set([sky, sky, Math.min(255, sky + 40), 255], (y * WW + x) * 4);
    }
    if (widgets) {
      const paint = (box, color, every = 1) => {
        for (let y = Math.floor(rect.y0 + box.min[1] * rect.h); y < Math.ceil(rect.y0 + box.max[1] * rect.h); y++) {
          for (let x = Math.floor(rect.x0 + box.min[0] * rect.w); x < Math.ceil(rect.x0 + box.max[0] * rect.w); x++) if ((x + y) % every === 0) rgba.set([...color, 255], (y * WW + x) * 4);
        }
      };
      paint(LAYOUT.ProbeText, [255, 255, 255], 4); paint(LAYOUT.ProbeButton, [190, 0, 0]); paint(LAYOUT.ProbeImage, [0, 255, 0]);
    }
    return { width: WW, height: WH, rgba };
  };
  const base = windowFrame(false, 0), shown = windowFrame(true, 1);
  const j = judgeFrames(base, shown, { width: 1014, height: 550 });
  assert.deepEqual([j.comparable, j.text, j.button], [true, true, true], j.detail);
  assert.match(j.detail, /placed by the button \(scale 0\.50\)/);
  // the same scene without the widgets (only the scene moved) shows neither
  const moved = judgeFrames(base, windowFrame(false, 1), { width: 1014, height: 550 });
  assert.deepEqual([moved.text, moved.button], [false, false]);
  assert.match(moved.detail, /not placed/);
  assert.match(judgeFrames(base, windowFrame(false, 1), { width: 1014, height: 550 }).detail, /no button-coloured pixels changed/);
  // a button but no text: the text check fails on its own
  const noText = windowFrame(true, 1);
  for (let y = Math.floor(rect.y0 + LAYOUT.ProbeText.min[1] * rect.h); y < Math.ceil(rect.y0 + LAYOUT.ProbeText.max[1] * rect.h); y++) {
    for (let x = Math.floor(rect.x0 + LAYOUT.ProbeText.min[0] * rect.w); x < Math.ceil(rect.x0 + LAYOUT.ProbeText.max[0] * rect.w); x++) noText.rgba.set(windowFrame(false, 1).rgba.subarray((y * WW + x) * 4, (y * WW + x) * 4 + 4), (y * WW + x) * 4);
  }
  const t = judgeFrames(base, noText, { width: 1014, height: 550 });
  assert.deepEqual([t.text, t.button], [false, true], t.detail);
  // a red blob of the wrong shape is not the button
  const wide = windowFrame(false, 1);
  for (let y = 100; y < 110; y++) for (let x = 20; x < 400; x++) wide.rgba.set([200, 0, 0, 255], (y * WW + x) * 4);
  assert.equal(judgeFrames(base, wide, { width: 1014, height: 550 }).button, false);
});

test('frames: a PNG written by the screenshot path round-trips through the reader', () => {
  const img = withWidget();
  const back = decodePng(encodePng(img));
  assert.equal(back.width, W);
  assert.equal(judgeFrames(without(), back).button, true);
});

// ---------------------------------------------------------------- commonui
test('commonui: each required piece has its own check and the unset ones are listed', () => {
  const run = (fn) => { const c = goodCommon(); fn(c.session.steps, c.capture.steps, c); return evaluateProbes({ groups: ['commonui'], reports: { commonui: c } }); };
  const step = (steps, name, patch) => Object.assign(steps.find((s) => s.step === name), patch);
  assert.deepEqual(failing(run((s) => step(s, 'table', { created: false }))), ['an input action data table is created from a script', 'every required piece could be set from a script, or the report lists the ones that could not']);
  assert.deepEqual(failing(run((s) => step(s, 'input_data', { back_set: false }))), ['a Common UI input data Blueprint is created and its click and back actions point at the table', 'every required piece could be set from a script, or the report lists the ones that could not']);
  const noViewport = run((s) => step(s, 'config_viewport', { found: null, set: false, saved: false, error: 'no section' }));
  assert.ok(failing(noViewport).includes('the Game Viewport Client Class is set to CommonGameViewportClient from a script and a new editor reads it'));
  assert.match(noViewport.find((c) => c.name.startsWith('every required piece')).detail, /could not be set and saved from a script: Game Viewport Client Class$/);
  const unread = run((s, st) => { st.settings.engine = { values: { GameViewportClientClassName: '' } }; });
  assert.deepEqual(failing(unread), ['the Game Viewport Client Class is set to CommonGameViewportClient from a script and a new editor reads it']);
  const noInput = run((s) => step(s, 'config_input', { saved: false }));
  assert.match(noInput.find((c) => c.name.startsWith('every required piece')).detail, /Common Input Settings Input Data/);
  assert.deepEqual(failing(run((s) => step(s, 'activatable', { has_common_button: false }))), ['an activatable widget with a Common button is created, compiled and saved']);
  assert.deepEqual(failing(run((s, st) => { st.after_activation.activated = false; })), ['the widget reads back inactive, then active once it is activated']);
  assert.deepEqual(failing(run((s, st) => { st.before_activation.activated = true; })), ['the widget reads back inactive, then active once it is activated']);
  const dark = goodCommon();
  dark.images = { ...goodImages(), umg_widget_showui: without(), umg_widget_hires: without() };
  assert.deepEqual(failing(evaluateProbes({ groups: ['commonui'], reports: { commonui: dark } })), ['a saved frame shows the Common UI widget']);
});

// ---------------------------------------------------------------- options and phases
test('options: groups, the engine, the port', () => {
  assert.deepEqual(parseProbeOptions(['--engine', 'E']).groups, GROUPS);
  assert.equal(parseProbeOptions([]).error, 'no engine folder: pass --engine or set UE_ROOT');
  assert.equal(parseProbeOptions([], { UE_ROOT: 'E' }).engine, 'E');
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'commonui, toolsets']).groups, ['toolsets', 'commonui']);
  assert.match(parseProbeOptions(['--engine', 'E', '--only', 'widget,nope']).error, /unknown group nope/);
  assert.match(parseProbeOptions(['--engine', 'E', '--only']).error, /needs a value/);
  assert.match(parseProbeOptions(['--engine', 'E', '--bogus']).error, /unknown option/);
  assert.match(parseProbeOptions(['--engine', 'E', '--port', '80']).error, /1024/);
  assert.equal(parseProbeOptions(['--engine', 'E', '--port', '8000']).port, 8000);
  assert.deepEqual([parseProbeOptions(['--engine', 'E', '--keep', '--plan']).keep, parseProbeOptions(['--engine', 'E', '--plan']).plan], [true, true]);
});

test('phases: toolsets and widget share one session, capture follows it, commonui has its own project', () => {
  assert.deepEqual(planPhases(['toolsets']).map((p) => p.name), ['session']);
  assert.deepEqual(planPhases(['widget']).map((p) => p.name), ['session']);
  assert.deepEqual(planPhases(['capture']).map((p) => p.name), ['session', 'capture']);
  assert.deepEqual(planPhases(['commonui']).map((p) => p.name), ['commonui-session', 'commonui-capture']);
  assert.deepEqual(planPhases(GROUPS).map((p) => p.name), ['session', 'capture', 'commonui-session', 'commonui-capture']);
  assert.notEqual(PHASES.capture.project, PHASES['commonui-capture'].project);
});

test('every phase script exists and the stage script reads the variables the runner sets', () => {
  const files = new Set(readdirSync(here));
  for (const phase of Object.values(PHASES)) if (phase.script) assert.ok(files.has(phase.script), phase.script);
  const stage = readFileSync(join(here, 'umg_stage.py'), 'utf8'), runner = readFileSync(join(here, 'umg_probe.mjs'), 'utf8');
  for (const name of ['UMG_MODE', 'UMG_REPORT', 'UMG_PREFIX', 'UMG_WIDGET', 'UMG_INPUT_DATA']) { assert.ok(stage.includes(name), `stage reads ${name}`); assert.ok(runner.includes(name), `runner sets ${name}`); }
  for (const phase of Object.values(PHASES)) if (phase.stage) assert.match(stage, new RegExp(`"${phase.stage}"`), `stage knows mode ${phase.stage}`);
});

test('a video-memory failure in a log is recognised, an ordinary log is not', () => {
  assert.equal(looksLikeMemoryFailure('LogD3D12RHI: Error: Out of video memory trying to allocate a rendering resource'), true);
  assert.equal(looksLikeMemoryFailure('DXGI_ERROR_DEVICE_REMOVED'), true);
  assert.equal(looksLikeMemoryFailure('LogInit: Display: engine exit'), false);
  assert.equal(looksLikeMemoryFailure(undefined), false);
});

// ---------------------------------------------------------------- MCP response helpers
test('server-sent events are taken whole and the rest is kept', () => {
  const a = takeSseEvents('event: message\ndata: {"id":1,"result":{}}\n\nevent: message\ndata: {"id":2');
  assert.deepEqual(a.events, [{ id: 1, result: {} }]);
  assert.equal(a.rest, 'event: message\ndata: {"id":2');
  const b = takeSseEvents(`${a.rest},"result":{"ok":true}}\r\n\r\n: keep-alive\n\n`);
  assert.deepEqual(b.events, [{ id: 2, result: { ok: true } }]);
  assert.deepEqual(takeSseEvents('data: not json\n\n').events, []);
});

test('tool results are decoded, errors found, and the registry return value unwrapped', () => {
  const ok = decodeToolResult({ content: [{ type: 'text', text: '{"returnValue":{"refPath":"/Game/A.A"}}' }] });
  assert.equal(ok.isError, false);
  assert.deepEqual(returnValue(ok), { refPath: '/Game/A.A' });
  assert.equal(decodeToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true }).error, 'boom');
  assert.match(decodeToolResult({ content: [{ type: 'text', text: '{"error":"no such toolset"}' }] }).error, /no such toolset/);
  assert.deepEqual(returnValue(decodeToolResult({ content: [{ type: 'text', text: '{"returnValue":"{\\"Text\\":\\"x\\"}"}' }] })), { Text: 'x' });
  assert.equal(returnValue(decodeToolResult({ content: [{ type: 'text', text: '{"returnValue":true}' }] })), true);
  assert.equal(decodeToolResult({ content: [{ type: 'image', data: 'x' }] }).images, 1);
  assert.deepEqual(returnValue(decodeToolResult({ structuredContent: { returnValue: [1] } })), [1]);
});

test('toolset and tool names are collected from the registry shape and from plain text', () => {
  const list = decodeToolResult({ content: [{ type: 'text', text: JSON.stringify([{ name: 'UMGToolSet.UMGToolSet', description: 'd' }, { name: 'editor_toolset.toolsets.object.ObjectTools' }]) }] });
  assert.deepEqual(collectToolsetNames(list), ['UMGToolSet.UMGToolSet', 'editor_toolset.toolsets.object.ObjectTools']);
  const strings = decodeToolResult({ content: [{ type: 'text', text: JSON.stringify({ toolsets: ['A.B', 'C.D'] }) }] });
  assert.deepEqual(collectToolsetNames(strings), ['A.B', 'C.D']);
  const text = decodeToolResult({ content: [{ type: 'text', text: '- UMGToolSet.UMGToolSet (23 tools)\n- MVVMToolset.MVVMToolset' }] });
  assert.deepEqual(collectToolsetNames(text), ['UMGToolSet.UMGToolSet', 'MVVMToolset.MVVMToolset']);
  const described = decodeToolResult({ content: [{ type: 'text', text: JSON.stringify({ name: 'UMGToolSet.UMGToolSet', tools: REAL_TOOLS(['AddWidget', 'GetWidgets']) }) }] });
  const tools = collectTools(described);
  assert.deepEqual(tools.map((t) => t.short), ['AddWidget', 'GetWidgets'], 'the toolset itself is not one of its tools');
  assert.deepEqual(tools[0].params, ['widgetBlueprint']);
  assert.equal(hasTool(tools, '', 'get_widgets'), true);
  assert.equal(hasTool([], 'tools: AddWidget, MoveWidget', 'MoveWidget'), true);
  assert.equal(hasTool(tools, '', 'MoveWidget'), false);
});

test('property shapes read back and are rewritten in their own spelling', () => {
  const layout = { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } }, Offsets: { Left: 5 } };
  assert.deepEqual(getCI(layout, ['anchors', 'minimum']), { X: 0, Y: 0 });
  assert.equal(setCI(layout, ['offsets', 'left'], 0), true);
  assert.equal(layout.Offsets.Left, 0);
  assert.equal(setCI(layout, ['nothing', 'here'], 1), false);
  assert.deepEqual([readVec2({ x: 1, y: 2 }), readVec2([3, 4]), readVec2('(X=0.5,Y=0.25)'), readVec2('nope')], [[1, 2], [3, 4], [0.5, 0.25], undefined]);
  assert.deepEqual([readColor({ R: 1, G: 0, B: 0, A: 1 }), readColor([0, 1, 0]), readColor('(R=0,G=0,B=1,A=0.5)'), readColor('#ff0000'), readColor({ SpecifiedColor: { r: 1, g: 1, b: 1 } })],
    [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 0.5], [1, 0, 0, 1], [1, 1, 1, 1]]);
  assert.deepEqual([vec2Like({ x: 9, y: 9 }, 1, 2), vec2Like([0, 0], 1, 2), vec2Like('(X=0,Y=0)', 1, 2)], [{ x: 1, y: 2 }, [1, 2], '(X=1,Y=2)']);
  assert.deepEqual([colorLike({ r: 0, g: 0, b: 0, a: 1 }, [1, 0, 0, 1]), colorLike('(R=0,G=0,B=0,A=1)', [1, 0, 0, 1]), colorLike([0, 0, 0, 0], [0, 1, 0, 1])], [{ r: 1, g: 0, b: 0, a: 1 }, '(R=1,G=0,B=0,A=1)', [0, 1, 0, 1]]);
  assert.deepEqual([textLike('Text Block', 'Hi'), textLike({ sourceString: 'a', key: 'k' }, 'Hi'), readText('Hi'), readText({ sourceString: 'Hi' })], ['Hi', { sourceString: 'Hi', key: 'k' }, 'Hi', 'Hi']);
  const sample = { Font: { Size: 24, FontObject: 'x' } };
  assert.deepEqual(partialFrom(sample, [[['font', 'size'], 48]]), { partial: { Font: { Size: 48 } }, missing: [] });
  assert.deepEqual(partialFrom(sample, [[['font', 'weight'], 1]]).missing, ['font.weight']);
});

// ---------------------------------------------------------------- the client against a fake server
function fakeServer(handler, { sse = false } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      seen.push({ headers: req.headers, msg });
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = handler(msg, req);
      if (result === 'hang') return;   // the editor is busy: no response is ever written
      const headers = { 'Mcp-Session-Id': 'sess-1' };
      if (sse) { res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream' }); res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`); setTimeout(() => res.end(), 50); } else {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, seen, port: server.address().port })));
}
const textResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

for (const sse of [false, true]) {
  test(`the client does the handshake and calls the three meta tools (${sse ? 'event stream' : 'plain JSON'} responses)`, async () => {
    const { server, seen, port } = await fakeServer((msg) => {
      if (msg.method === 'initialize') return { protocolVersion: '2025-03-26', serverInfo: { name: 'fake' }, capabilities: {} };
      if (msg.method === 'tools/list') return { tools: ['list_toolsets', 'describe_toolset', 'call_tool'].map((name) => ({ name, inputSchema: { type: 'object', properties: name === 'call_tool' ? { arguments: { type: 'object' } } : {} } })) };
      if (msg.params.name === 'list_toolsets') return { content: [{ type: 'text', text: '- UMGToolSet.UMGToolSet: UMG widgets' }] };
      if (msg.params.name === 'describe_toolset') return textResult({ name: msg.params.arguments.toolset_name, tools: REAL_TOOLS(['AddWidget']) });
      return textResult({ returnValue: msg.params.arguments });
    }, { sse });
    try {
      const client = new McpClient({ port });
      const info = await client.connect();
      assert.equal(info.sessionId, true);
      assert.equal(info.protocolVersion, '2025-03-26');
      assert.deepEqual((await client.listTools()).names, ['list_toolsets', 'describe_toolset', 'call_tool']);
      assert.deepEqual(collectToolsetNames((await client.listToolsets()).decoded), ['UMGToolSet.UMGToolSet']);
      assert.deepEqual(collectTools((await client.describeToolset('UMGToolSet.UMGToolSet')).decoded).map((t) => t.short), ['AddWidget']);
      const inner = await client.inner('UMGToolSet.UMGToolSet', 'GetWidgets', { widgetBlueprint: { refPath: '/Game/A.A' } });
      assert.deepEqual(returnValue(inner.decoded).toolset_name, 'UMGToolSet.UMGToolSet');
      const methods = seen.map((s) => s.msg.method);
      assert.deepEqual(methods.slice(0, 2), ['initialize', 'notifications/initialized']);
      assert.match(seen[0].headers.accept, /application\/json/);
      assert.match(seen[0].headers.accept, /text\/event-stream/);
      assert.equal(seen[0].headers['mcp-session-id'], undefined);
      assert.equal(seen[1].headers['mcp-session-id'], 'sess-1');
      assert.equal(seen.at(-1).msg.params.name, 'call_tool');
      assert.deepEqual(Object.keys(seen.at(-1).msg.params.arguments), ['toolset_name', 'tool_name', 'arguments']);
      assert.equal(client.trace.length, 5, 'the notification has no response and is not traced');
    } finally { server.close(); }
  });
}

test('the client waits for a server that is not up yet, gives up on a dead one and reports a timeout without throwing', async () => {
  const dead = await waitForServer({ port: 9, limitMs: 300, alive: () => true });
  assert.equal(dead.client, undefined);
  assert.match(dead.error, /no answer within/);
  const gone = await waitForServer({ port: 9, limitMs: 5000, alive: () => false });
  assert.match(gone.error, /exited before/);
  const { server, port } = await fakeServer((msg) => (msg.method === 'initialize' ? { protocolVersion: 'x' } : 'hang'), {});
  try {
    const client = new McpClient({ port });
    await client.connect();
    const out = await client.callTool('call_tool', {}, { timeoutMs: 10 });
    assert.equal(out.ok, false);
    assert.equal(out.timedOut, true);
    assert.equal(out.error, 'timed out');
  } finally { server.close(); }
});

// ---------------------------------------------------------------- the session against a fake editor
/** A fake editor behind the MCP server: the toolsets of a build with the UMG, object, asset, blueprint, data table and settings tools, over an in-memory model. */
function fakeEditor({ withMvvm = true, refuseFirstForm = false } = {}) {
  const widgets = new Map();   // name -> { path, cls, parent, props }
  let blueprint;
  const sets = {
    'UMGToolSet.UMGToolSet': ['CreateWidgetBlueprint', 'AddWidget', 'MoveWidget', 'GetWidgets', 'GetWidgetDescription', 'BindToEventProperty', 'CompileWidgetBlueprint'],
    'editor_toolset.toolsets.object.ObjectTools': ['get_properties', 'set_properties', 'list_properties'],
    'editor_toolset.toolsets.asset.AssetTools': ['save_assets', 'create_folder'],
    'editor_toolset.toolsets.blueprint.BlueprintTools': ['create', 'compile_blueprint'],
    'editor_toolset.toolsets.data_table.DataTableTools': ['create', 'add_rows'],
    'ConfigSettingsToolset.ConfigSettingsToolset': ['ListContainers', 'ListCategories', 'ListSections', 'GetSectionSchema', 'GetSectionPropertyValues', 'SetSectionProperties', 'SaveSection'],
    ...(withMvvm ? { 'MVVMToolset.MVVMToolset': ['CreateViewModel'] } : {}),
  };
  const params = {
    AddWidget: ['widgetBlueprint', 'widgetClass', 'widgetDisplayName', 'parentWidget', 'childIndex'], CreateWidgetBlueprint: ['folderPath', 'assetName', 'parentClass'],
    get_properties: ['instance', 'properties'], set_properties: ['instance', 'values'], save_assets: ['assetPaths'],
  };
  const settings = { GameViewportClientClassName: '', InputData: '' };
  const slotOf = (name) => `${blueprint}:WidgetTree.${name}.Slot`;
  const find = (path) => [...widgets.values()].find((w) => path === w.path || path === slotOf(w.name));
  const toolDescriptions = (toolset) => sets[toolset].map((t) => ({ name: `${toolset}.${t}`, description: t, inputSchema: { type: 'object', properties: Object.fromEntries((params[t] || []).map((p) => [p, {}])) } }));
  let widgetAttempts = 0;
  const call = (toolset, tool, args) => {
    const short = tool.split('.').pop();
    if (refuseFirstForm && !tool.includes('.')) return { error: `tool not found: ${tool}` };
    const ref = (path) => ({ refPath: path });
    switch (`${toolset.split('.').pop()}.${short}`) {
      case 'UMGToolSet.CreateWidgetBlueprint': blueprint = `${args.folderPath}/${args.assetName}.${args.assetName}`; return { returnValue: ref(blueprint) };
      case 'UMGToolSet.AddWidget': {
        widgetAttempts++;
        const name = args.widgetDisplayName, path = `${blueprint}:WidgetTree.${name}`;
        widgets.set(name, { name, path, cls: args.widgetClass.refPath, parent: args.parentWidget && args.parentWidget.refPath, props: {
          Text: 'Text Block', BackgroundColor: { R: 1, G: 1, B: 1, A: 1 }, ColorAndOpacity: { R: 1, G: 1, B: 1, A: 1 }, Font: { Size: 24, FontObject: null },
          LayoutData: { Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } }, Offsets: { Left: 0, Top: 0, Right: 100, Bottom: 30 }, Alignment: { X: 0, Y: 0 } },
        } });
        return { returnValue: { widget: ref(path), slot: ref(slotOf(name)), widgetClassPath: args.widgetClass.refPath, widgetName: name } };
      }
      case 'UMGToolSet.GetWidgets': return { returnValue: { info: { widgetCount: widgets.size }, widgets: [...widgets.values()].map((w) => ({ widget: ref(w.path), slot: ref(slotOf(w.name)), widgetName: w.name, widgetClassPath: w.cls })) } };
      case 'UMGToolSet.GetWidgetDescription': return { returnValue: { description: [...widgets.keys()].join('\n'), widgets: [] } };
      case 'UMGToolSet.CompileWidgetBlueprint': return { returnValue: widgets.size > 0 };
      case 'AssetTools.save_assets': return { returnValue: true };
      case 'AssetTools.create_folder': return { returnValue: true };
      case 'ObjectTools.get_properties': {
        const w = find(args.instance.refPath);
        return { returnValue: JSON.stringify(Object.fromEntries(args.properties.map((p) => [p, w && w.slot ? w.props[p] : (w ? w.props[p] : null)]))) };
      }
      case 'ObjectTools.set_properties': {
        const values = JSON.parse(args.values), w = find(args.instance.refPath);
        if (!w) return { returnValue: false };
        const merge = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') merge(dst[k], v); else dst[k] = v; } };
        merge(w.props, values);
        return { returnValue: true };
      }
      case 'BlueprintTools.create': return { returnValue: ref(`${args.folderPath}/${args.assetName}.${args.assetName}`) };
      case 'BlueprintTools.compile_blueprint': return { returnValue: null };
      case 'DataTableTools.create': return { returnValue: ref(`${args.folderPath}/${args.assetName}.${args.assetName}`) };
      case 'DataTableTools.add_rows': return { returnValue: null };
      case 'ConfigSettingsToolset.ListContainers': return { returnValue: ['Editor', 'Project'] };
      case 'ConfigSettingsToolset.ListCategories': return { returnValue: args.containerName === 'Project' ? ['Engine'] : [] };
      case 'ConfigSettingsToolset.ListSections': return { returnValue: ['General Settings', 'Common Input Settings'] };
      case 'ConfigSettingsToolset.GetSectionSchema': return { returnValue: JSON.stringify({ properties: args.sectionName === 'General Settings' ? { GameViewportClientClassName: {} } : { InputData: {} } }) };
      case 'ConfigSettingsToolset.GetSectionPropertyValues': return { returnValue: JSON.stringify(Object.fromEntries(args.propertyNames.map((p) => [p, settings[p]]))) };
      case 'ConfigSettingsToolset.SetSectionProperties': Object.assign(settings, JSON.parse(args.propertiesJson)); return { returnValue: true };
      case 'ConfigSettingsToolset.SaveSection': return { returnValue: true };
      default: return { error: `unknown tool ${toolset}.${tool}` };
    }
  };
  const handler = (msg) => {
    if (msg.method === 'initialize') return { protocolVersion: '2025-03-26', serverInfo: { name: 'fake editor' }, capabilities: {} };
    if (msg.method === 'tools/list') return { tools: ['list_toolsets', 'describe_toolset', 'call_tool'].map((name) => ({ name })) };
    const { name, arguments: a } = msg.params;
    if (name === 'list_toolsets') return { content: [{ type: 'text', text: Object.keys(sets).map((n) => `- ${n}: the ${n} tools,\n  described over two lines`).join('\n') }] };
    if (name === 'describe_toolset') return sets[a.toolset_name] ? textResult({ name: a.toolset_name, tools: toolDescriptions(a.toolset_name) }) : { isError: true, content: [{ type: 'text', text: 'no such toolset' }] };
    const out = call(a.toolset_name, a.tool_name, a.arguments);
    return out.error ? { isError: true, content: [{ type: 'text', text: out.error }] } : textResult(out);
  };
  return { handler, widgets, settings, attempts: () => widgetAttempts };
}

test('the base session builds the widget through the tools it finds and the checks pass on what it read back', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: true });
    report.steps.unshift({ step: 'connect', ready_seconds: 1, session_id: true, protocol_version: 'x' });
    const checks = evaluateProbes({ groups: ['toolsets', 'widget'], reports: { base: { session: report } } });
    assert.deepEqual(failing(checks), ['the widget-animation toolset is listed with its tools'], JSON.stringify(report.steps.filter((s) => s.error || (s.errors && s.errors.length))));
    assert.equal(editor.widgets.get('ProbeText').props.Text, PROBE_TEXT);
    assert.equal(editor.widgets.get('ProbeText').props.Font.Size, 48);
    assert.equal(editor.widgets.get('ProbeText').props.Font.FontObject, null, 'only the changed field of a struct is sent');
    assert.deepEqual(editor.widgets.get('ProbeButton').props.BackgroundColor, { R: 1, G: 0, B: 0, A: 1 });
    assert.deepEqual(editor.widgets.get('ProbeImage').props.LayoutData.Anchors.Maximum, { X: 0.6, Y: 0.9 });
    assert.equal(editor.widgets.get('ProbeImage').props.LayoutData.Offsets.Right, 0);
    assert.equal(editor.attempts(), 5, 'each widget is added once');
  } finally { server.close(); }
});

test('a tool name the server does not find in the short form is sent again in the qualified form, and a write is never sent twice otherwise', async () => {
  const editor = fakeEditor({ refuseFirstForm: true });
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: true });
    assert.equal(report.steps.find((s) => s.step === 'create').name_form, 'qualified');
    assert.equal(editor.attempts(), 5);
    assert.equal(report.steps.find((s) => s.step === 'compile').returned, true);
  } finally { server.close(); }
});

test('without MVVM in the build the session records the toolset as absent and the rest still runs', async () => {
  const editor = fakeEditor({ withMvvm: false });
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: false });
    const resolve = report.steps.find((s) => s.step === 'resolve');
    assert.ok(resolve.absent.includes('mvvm') && resolve.absent.includes('widget_animation'));
    assert.equal(report.steps.some((s) => s.step === 'create'), false, 'a toolsets-only run builds nothing');
    const checks = evaluateProbes({ groups: ['toolsets'], reports: { base: { session: report } } });
    assert.ok(failing(checks).includes('the MVVM toolset is listed with its tools'));
    assert.equal(checks.find((c) => c.name.startsWith('the UMG toolset')).pass, true);
  } finally { server.close(); }
});

test('the Common UI session sets the settings it can find, builds both widgets and saves them', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await commonUiSession({ client, say: () => {} });
    const get = (n) => report.steps.find((s) => s.step === n);
    assert.equal(get('table').created, true);
    assert.equal(get('config_viewport').saved, true, JSON.stringify(get('config_viewport')));
    assert.equal(get('config_input').saved, true, JSON.stringify(get('config_input')));
    assert.equal(editor.settings.GameViewportClientClassName, '/Script/CommonUI.CommonGameViewportClient');
    assert.match(editor.settings.InputData, /BP_ProbeInputData\.BP_ProbeInputData_C$/);
    assert.equal(get('button_blueprint').compiled, true);
    assert.equal(get('activatable').has_common_button, true, JSON.stringify(get('activatable')));
    assert.equal(get('save').returned, true);
  } finally { server.close(); }
});

// ---------------------------------------------------------------- hygiene
test('the runner and the session never resend a write', () => {
  const session = readFileSync(join(here, 'umg-session.mjs'), 'utf8'), mcp = readFileSync(join(here, 'umg-mcp.mjs'), 'utf8');
  assert.equal(/for \(let attempt/.test(session) || /for \(let attempt/.test(mcp), false);
  assert.match(session, /refused/, 'only a refused tool name is sent again');
});

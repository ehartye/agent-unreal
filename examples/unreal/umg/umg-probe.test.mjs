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
  ANIMATION_ASSET, MVVM_ASSET, MVVM_NAMES, summarizeAnimationTree, routeObserved, USAGE, viewportClientsFromLog, runningViewportClass, findSlateRef,
} from './umg-probe-checks.mjs';
import { McpClient, waitForServer } from './umg-mcp.mjs';
import { baseSession, commonUiSession, readbackSession, slateSession, fillArgs, partialFrom } from './umg-session.mjs';
import { pyCall, holdLoop, answerRequest } from './umg-hold.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync as readFile, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
      { step: 'animation_toolsets', count: 8, toolsets: Array.from({ length: 8 }, (_, i) => ({ name: `animation_toolset.part${i}.Toolset`, tool_count: 3, tools: ['A', 'B', 'C'], raw_length: 900 })) },
      { step: 'animation_blueprint', created: true, compiled: true, saved: true },
      { step: 'animation_attempt', calls: [{ tool: 'animation_toolset.sequencer.SequencerToolset.AddTrack', ok: true }, { tool: 'animation_toolset.sequencer.SequencerToolset.AddKey', ok: true }], track_added: true, key_added: true },
      { step: 'mvvm_blueprint', created: true, compiled: true, saved: true },
      { step: 'mvvm_calls', view_model_created: true, property_added: true, added_to_widget: true, binding_created: true, calls: [{ tool: 'MVVMToolset.CreateViewModel', ok: true }] },
      { step: 'mvvm_lists', view_model_listed: true, widget_view_model_listed: true, binding_listed: true, excerpt: 'listed' },
      { step: 'mvvm_compile', returned: true, saved: true },
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
const goodReadback = () => ({
  probe: 'readback', project: 'base',
  steps: [{ step: 'animation_readback', animation_found: true, animations: ['/Game/UI/WBP_ProbeAnim.WBP_ProbeAnim:ProbeFade'], track_count: 1, key_count: 2 },
    { step: 'mvvm_readback', binding_present: true, view_model_present: true, excerpt: 'ScoreText -> ProbeText' }],
});
const goodBase = () => ({ session: goodSession(), capture: goodStage(), readback: goodReadback(), images: goodImages() });

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
const playShots = () => [{ label: 'before', route: 'showui', stem: 'umgi_before_showui' }, { label: 'after', route: 'showui', stem: 'umgi_after_showui' }];
const inputRoute = (route, kind, extra = {}) => ({ route, kind, tried: true, delivered: false, observed: false, detail: 'nothing happened', ...extra });
function goodPlay() {
  return {
    probe: 'stage', mode: 'input',
    steps: {
      settings: { engine: { values: { GameViewportClientClassName: '/Script/CommonUI.CommonGameViewportClient' } } },
      viewport_client: { routes: [{ route: 'viewport client object, get_class()', value: '/Script/CommonUI.CommonGameViewportClient' }], running_class: 'CommonGameViewportClient' },
      input: { routes: [inputRoute('control: OnButtonBaseClicked.broadcast() on the Common button', 'control', { delivered: true, observed: true }), inputRoute('player controller input_key(Enter)', 'input', { delivered: true, observed: true })] },
    },
    shots: playShots(), events: [], log_viewport: ['LogPython: [umg_stage] viewport_client class=CommonGameViewportClient path=/Script/CommonUI.CommonGameViewportClient'],
    mcp: { steps: [{ step: 'slate_describe', toolset: 'SlateInspectorToolset.SlateInspectorToolset', tool_count: 4, tools: ['GetWidgets'], raw_length: 500 }, { step: 'slate_routes', routes: [inputRoute('slate inspector GetWidgets', 'read', { tried: true })] },
      { step: 'slate_input', routes: [inputRoute('control: slate inspector Click on the editor Content Drawer button (b16)', 'control', { delivered: true, observed: true })] }] },
  };
}
const goodPlayImages = () => ({ umgi_before_showui: without(), umgi_after_showui: without() });
const goodCommon = () => ({ session: goodCommonSession(), capture: goodCommonStage(), play: goodPlay(), images: goodImages(), playImages: goodPlayImages() });
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


// ---------------------------------------------------------------- animation, mvvm, viewport, input
const only = (group, reports) => evaluateProbes({ groups: [group], reports });

test('animation: the descriptions, the track, the key and the fresh read-back each have a check', () => {
  const run = (fn) => { const base = goodBase(); fn(base.session.steps, base.readback.steps); return failing(only('animation', { base })); };
  const stepOf = (steps, name) => steps.find((x) => x.step === name);
  assert.deepEqual(run(() => {}), []);
  assert.deepEqual(run((s) => { stepOf(s, 'animation_toolsets').toolsets.length = 7; }), ['the animation toolsets are described and each description is saved']);
  assert.deepEqual(run((s) => { stepOf(s, 'animation_toolsets').toolsets[3].raw_length = 0; }), ['the animation toolsets are described and each description is saved']);
  assert.deepEqual(run((s) => { Object.assign(stepOf(s, 'animation_attempt'), { track_added: false, key_added: false }); }),
    ['a track is added to a widget animation of a saved Widget Blueprint through the described tools', 'a key on a widget property is added through the described tools']);
  assert.deepEqual(run((s) => { stepOf(s, 'animation_attempt').key_added = false; }), ['a key on a widget property is added through the described tools']);
  assert.deepEqual(run((s, r) => { stepOf(r, 'animation_readback').key_count = 0; }), ['a fresh editor reads the animation back from the saved Widget Blueprint with the track and the key']);
  assert.deepEqual(run((s, r) => { stepOf(r, 'animation_readback').animation_found = false; }), ['a fresh editor reads the animation back from the saved Widget Blueprint with the track and the key']);
  const none = goodBase();
  Object.assign(none.session.steps.find((x) => x.step === 'animation_attempt'), { track_added: false, key_added: false, calls: [{ tool: 'animation_toolset.sequencer.SequencerToolset.AddTrack', ok: false, error: 'the sequence is not a level sequence' }] });
  assert.match(only('animation', { base: none }).find((c) => c.name.startsWith('a track is added')).detail, /FAILED: the sequence is not a level sequence/, 'the failing call and its message are in the detail');
});

test('animation: tracks, keys and sections are counted in a property tree and nothing is counted in a bare reference', () => {
  const tree = [{ MovieScene: { Tracks: [{ Sections: [{ Channels: [{ Times: [0, 1, 2] }] }] }], ObjectBindings: [{ Tracks: [{ Sections: [{}, {}] }] }] } }, { refPath: '/Game/X.X' }];
  assert.deepEqual(summarizeAnimationTree(tree), { tracks: 2, keys: 3, sections: 3 });
  assert.deepEqual(summarizeAnimationTree({ Animations: [{ refPath: '/Game/UI/WBP.WBP:ProbeFade' }] }), { tracks: 0, keys: 0, sections: 0 });
  assert.deepEqual(summarizeAnimationTree(undefined), { tracks: 0, keys: 0, sections: 0 });
});

test('mvvm: each call, the three List tools, the compile and the fresh read-back have a check, and a failing call is quoted', () => {
  const run = (fn) => { const base = goodBase(); fn(base.session.steps, base.readback.steps); return failing(only('mvvm', { base })); };
  const stepOf = (steps, name) => steps.find((x) => x.step === name);
  assert.deepEqual(run(() => {}), []);
  assert.deepEqual(run((s) => { stepOf(s, 'mvvm_calls').property_added = false; }), ['a view model with a property is created through the MVVM toolset']);
  assert.deepEqual(run((s) => { stepOf(s, 'mvvm_calls').added_to_widget = false; }), ['the view model is added to the widget']);
  assert.deepEqual(run((s) => { stepOf(s, 'mvvm_calls').binding_created = false; }), ['a binding from the property to the text block is created']);
  assert.deepEqual(run((s) => { stepOf(s, 'mvvm_lists').binding_listed = false; }), ['ListViewModels, ListWidgetViewModels and ListWidgetViewBindings read the view model and the binding back']);
  assert.deepEqual(run((s) => { stepOf(s, 'mvvm_compile').returned = false; }), ['the Widget Blueprint compiles with no error after the binding']);
  assert.deepEqual(run((s, r) => { stepOf(r, 'mvvm_readback').binding_present = false; }), ['a fresh editor loads the saved Widget Blueprint with the binding present']);
  const failed = goodBase();
  Object.assign(failed.session.steps.find((x) => x.step === 'mvvm_calls'), { view_model_created: false, calls: [{ tool: 'MVVMToolset.MVVMToolset.CreateViewModel', ok: false, error: 'parentClass is required' }] });
  assert.match(only('mvvm', { base: failed }).find((c) => c.name.startsWith('a view model with a property')).detail, /CreateViewModel FAILED: parentClass is required/);
});

test('viewport: the running class is read, logged, and compared with the saved setting', () => {
  const run = (fn) => { const ui = goodCommon(); fn(ui.play); return only('viewport', { commonui: ui }); };
  assert.equal(passed(run(() => {})), true);
  const other = run((p) => { p.steps.viewport_client.running_class = 'GameViewportClient'; });
  assert.deepEqual(failing(other), ['the running class equals the saved Game Viewport Client Class']);
  assert.match(other.find((c) => !c.pass).detail, /running "GameViewportClient"/, 'the class that ran is in the detail');
  assert.deepEqual(failing(run((p) => { p.steps.viewport_client.running_class = null; })), ['the class of the running game viewport client is read in the Play-In-Editor session', 'the running class equals the saved Game Viewport Client Class']);
  assert.deepEqual(failing(run((p) => { p.log_viewport = ['GameViewportClient_0']; })), ['the session log holds the class the stage script logged']);
  assert.deepEqual(failing(run((p) => { p.steps.settings.engine.values.GameViewportClientClassName = ''; })), ['the running class equals the saved Game Viewport Client Class']);
});

test('input: a route counts only when an input (not a control) changed something observable, and every route is listed', () => {
  const run = (fn, images) => { const ui = goodCommon(); fn(ui.play); if (images) ui.playImages = images; return only('input', { commonui: ui }); };
  assert.equal(passed(run(() => {})), true);
  const control = (p) => p.steps.input.routes.find((r) => r.kind === 'control' && /broadcast/.test(r.route));
  const inputR = (p) => p.steps.input.routes.find((r) => r.kind === 'input');
  const none = run((p) => { inputR(p).observed = false; });
  assert.deepEqual(failing(none), ['a simulated key or click delivered to the active Common button changes an observable state']);
  assert.match(none.find((c) => !c.pass).detail, /no route changed the button/);
  assert.deepEqual(failing(run((p) => { control(p).observed = false; })), ['a control shows that the observable is wired']);
  assert.deepEqual(failing(run((p) => { p.mcp.steps.find((x) => x.step === 'slate_input').routes[0].observed = false; })), ['a Slate inspector click reaches an editor widget (control)']);
  const onlyControl = run((p) => { inputR(p).observed = false; inputR(p).delivered = false; });
  assert.equal(onlyControl.find((c) => c.name.startsWith('a simulated key')).pass, false, 'the control route alone is not a simulated input');
  assert.deepEqual(failing(run((p) => { p.mcp.steps[0] = { step: 'slate_describe', error: 'the Slate inspector toolset is not listed' }; })), ['the Slate inspector toolset is described before any route uses it']);
  assert.deepEqual(failing(run((p) => { p.steps.input.routes = [control(p)]; p.mcp.steps[1].routes = []; p.mcp.steps[2].routes = []; })), ['every route tried is recorded with its result', 'a Slate inspector click reaches an editor widget (control)', 'a simulated key or click delivered to the active Common button changes an observable state']);
  // a delivered key with no log line or state does not count, even when the frames differ (the editor layout can change between them: A-Q4 run 3)
  const framed = run((p) => { inputR(p).observed = false; inputR(p).delivered = true; }, { umgi_before_showui: without(), umgi_after_showui: withWidget() });
  assert.deepEqual(failing(framed), ['a simulated key or click delivered to the active Common button changes an observable state']);
  assert.match(framed.find((c) => !c.pass).detail, /frame pixels that differ before and after [1-9]\d* \(recorded, not counted/);
  assert.equal(routeObserved({ kind: 'input', delivered: true, observed: false }), false);
  assert.equal(routeObserved({ kind: 'input', delivered: true, observed: true }), true);
  assert.equal(routeObserved({ kind: 'precondition', delivered: true, observed: true }), false);
  assert.equal(routeObserved({ kind: 'control', delivered: true, observed: true }), false);
});

test('a ref is found in a Slate snapshot by the line it labels', () => {
  const snapshot = ['window "Editor" [pos=0,0 size=1280,720] [ref=w1]', '  text "COMMON UI" [pos=308,178 size=797,173] [ref=x19]', '  generic "GO" [pos=359,365 size=598,173] [ref=g5]', '    text "GO" [pos=367,367 size=566,166] [ref=x20]', '  button "Content Drawer" [pos=3,690 size=126,28] [ref=b16]'].join('\n');
  assert.equal(findSlateRef(snapshot, /generic "GO"/), 'g5');
  assert.equal(findSlateRef(snapshot, /text "GO"/), 'x20');
  assert.equal(findSlateRef(snapshot, /button "Content Drawer"/), 'b16');
  assert.equal(findSlateRef(snapshot, /nothing/), undefined);
  assert.equal(findSlateRef(undefined, /x/), undefined);
});

test('fillArgs names only the parameters a tool describes and lists the required ones it could not fill', () => {
  const tool = { name: 'X.Create', short: 'Create', params: ['folderPath', 'assetName', 'extra'], required: ['folderPath', 'extra'] };
  const { args, unfilled } = fillArgs(tool, [[/folder/i, '/Game/UI'], [/asset.?name/i, 'VM'], [/nothing/i, 1]]);
  assert.deepEqual(args, { folderPath: '/Game/UI', assetName: 'VM' });
  assert.deepEqual(unfilled, ['extra']);
  assert.deepEqual(fillArgs(undefined, []).args, {});
});

test('options: --hold is a flag and the usage line shows it', () => {
  assert.equal(parseProbeOptions(['--engine', 'E', '--hold']).hold, true);
  assert.equal(parseProbeOptions(['--engine', 'E']).hold, false);
  assert.ok(USAGE.includes('--hold'));
});

test('the viewport client objects are read from the engine object listing, and two different classes are not guessed between', () => {
  const lines = [
    '[2026.10.30-16.49.42:855][872]Obj List: class=GameViewportClient',
    '[2026.10.30-16.49.42:860][872]                       CommonGameViewportClient /Engine/Transient.UnrealEdEngine_0:CommonGameViewportClient_0      1.27       1.27       0.00',
    '[2026.10.30-16.49.42:860][872]                       CommonGameViewportClient        1       1.27       1.27       0.00',
  ];
  assert.deepEqual(viewportClientsFromLog(lines), [{ cls: 'CommonGameViewportClient', path: '/Engine/Transient.UnrealEdEngine_0:CommonGameViewportClient_0' }]);
  assert.deepEqual(runningViewportClass({ log_viewport: lines }), { cls: 'CommonGameViewportClient', how: 'listed by the engine (obj list class=GameViewportClient) in the session log' });
  assert.equal(runningViewportClass({ log_viewport: [...lines, '   GameViewportClient /Engine/Transient.UnrealEdEngine_0:GameViewportClient_0 1 1 1'] }).cls, null);
  assert.equal(runningViewportClass({ steps: { viewport_client: { running_class: 'GameViewportClient' } }, log_viewport: lines }).cls, 'GameViewportClient', 'the stage script own read comes first');
  assert.deepEqual(viewportClientsFromLog(undefined), []);
});

test('the usage line lists every group, including the four added for animation, MVVM, the viewport client and input', () => {
  for (const group of ['animation', 'mvvm', 'viewport', 'input']) { assert.ok(GROUPS.includes(group)); assert.ok(USAGE.includes(group)); }
  assert.deepEqual(parseProbeOptions(['--engine', 'E', '--only', 'input,animation']).groups, ['animation', 'input']);
});

test('phases: animation and mvvm add a fresh-editor read-back, viewport and input share the one play phase after the Common UI session', () => {
  assert.deepEqual(planPhases(['animation']).map((p) => p.name), ['session', 'readback']);
  assert.deepEqual(planPhases(['mvvm', 'animation']).map((p) => p.name), ['session', 'readback']);
  assert.deepEqual(planPhases(['viewport']).map((p) => p.name), ['commonui-session', 'play']);
  assert.deepEqual(planPhases(['input', 'viewport']).map((p) => p.name), ['commonui-session', 'play']);
  assert.deepEqual(planPhases(['commonui', 'input']).map((p) => p.name), ['commonui-session', 'commonui-capture', 'play']);
  assert.deepEqual(planPhases(['toolsets', 'animation']).map((p) => p.name), ['session', 'readback']);
  assert.equal(PHASES.play.project, 'commonui');
  assert.equal(PHASES.play.mode, 'play');
  for (const phase of Object.values(PHASES)) assert.ok(phase.key, `${phase.name} has a report key`);
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
  assert.deepEqual(planPhases(GROUPS).map((p) => p.name), ['session', 'capture', 'readback', 'commonui-session', 'commonui-capture', 'play']);
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
function fakeEditor({ withMvvm = true, refuseFirstForm = false, failMvvm = '', withSlate = true, ignoreCompile = false } = {}) {
  const widgets = new Map();   // name -> { path, cls, parent, props }
  let blueprint;
  const sets = {
    'UMGToolSet.UMGToolSet': ['CreateWidgetBlueprint', 'AddWidget', 'MoveWidget', 'GetWidgets', 'GetWidgetDescription', 'BindToEventProperty', 'CompileWidgetBlueprint'],
    'editor_toolset.toolsets.object.ObjectTools': ['get_properties', 'set_properties', 'list_properties'],
    'editor_toolset.toolsets.asset.AssetTools': ['save_assets', 'create_folder'],
    'editor_toolset.toolsets.blueprint.BlueprintTools': ['create', 'compile_blueprint'],
    'editor_toolset.toolsets.data_table.DataTableTools': ['create', 'add_rows'],
    'ConfigSettingsToolset.ConfigSettingsToolset': ['ListContainers', 'ListCategories', 'ListSections', 'GetSectionSchema', 'GetSectionPropertyValues', 'SetSectionProperties', 'SaveSection'],
    ...(withMvvm ? { 'MVVMToolset.MVVMToolset': ['CreateViewModel', 'AddViewModelProperty', 'AddViewModelToWidget', 'CreateViewBinding', 'RemoveWidgetViewBinding', 'ListViewModels', 'ListWidgetViewModels', 'ListWidgetViewBindings', 'ListConversionFunctions'] } : {}),
    ...(withSlate ? { 'SlateInspectorToolset.SlateInspectorToolset': ['GetWidgetTree', 'ClickWidget', 'Observe', 'Snapshot', 'Hover', 'Click', 'PressKey'] } : {}),
    ...Object.fromEntries(['sequencer.SequencerToolset', 'sequencer.TrackToolset', 'sequencer.KeyToolset', 'sequencer.BindingToolset', 'control_rig.ControlRigToolset', 'control_rig.RigHierarchyToolset', 'control_rig.RigVMToolset', 'control_rig.RigUnitToolset']
      .map((n) => [`animation_toolset.${n}`, n === 'sequencer.SequencerToolset' ? ['ListThings', 'add_track_to_sequence', 'add_track_to_binding'] : ['ListThings', 'AddThing']])),
  };
  const mvvm = { calls: [], viewModels: [], properties: [], onWidget: [], bindings: [], compiled: false }, slateCalls = [], animCalls = [];
  // a small Slate model: the editor has a Content Drawer button that opens a drawer, the game viewport has the Common button GO, which the click does not reach
  const slate = { drawer: false, onInput: (tool, args) => { if (tool === 'Click' && args.ref === 'b16') slate.drawer = true; if (slate.clicksReachButton && tool === 'Click' && args.ref === 'g5') slate.clicks++; }, clicks: 0, clicksReachButton: false };
  const slateTree = () => ['window "Editor" [pos=0,0 size=1280,720] [ref=w1]', '  text "COMMON UI" [pos=308,178 size=797,173] [ref=x19]', '  generic "GO" [pos=359,365 size=598,173] [ref=g5]', '    text "GO" [pos=367,367 size=566,166] [ref=x20]',
    '  button "Content Drawer" [pos=3,690 size=126,28] [ref=b16]', ...(slate.drawer ? Array.from({ length: 40 }, (_, i) => `    button "Asset ${i}" [ref=a${i}]`) : [])].join('\n');
  const params = {
    AddWidget: ['widgetBlueprint', 'widgetClass', 'widgetDisplayName', 'parentWidget', 'childIndex'], CreateWidgetBlueprint: ['folderPath', 'assetName', 'parentClass'],
    get_properties: ['instance', 'properties'], set_properties: ['instance', 'values'], save_assets: ['assetPaths'],
    CreateViewModel: ['viewModelName', 'packagePath', 'parentClass'], AddViewModelProperty: ['viewModel', 'propertyName', 'propertyType', 'defaultValue'], AddViewModelToWidget: ['widgetBlueprint', 'viewModelClass'],
    CreateViewBinding: ['widgetBlueprint', 'sourceContext', 'sourcePropertyPath', 'destinationContext', 'destinationPropertyPath', 'conversionName'], ListViewModels: ['searchPath'], ListWidgetViewModels: ['widgetBlueprint'], ListWidgetViewBindings: ['widgetBlueprint'],
    add_track_to_sequence: ['sequence', 'track_type'], add_track_to_binding: ['binding', 'track_type'],
    Observe: ['ref', 'maxDepth'], Snapshot: ['ref', 'maxDepth', 'bIncludeSourceLocations'], Hover: ['ref'], Click: ['ref', 'button', 'doubleClick', 'modifiers'], PressKey: ['key'],
  };
  const requiredOf = (t) => (t === 'CreateViewBinding' ? ['widgetBlueprint', 'sourceContext', 'sourcePropertyPath', 'destinationContext', 'destinationPropertyPath'] : /View/.test(t) ? params[t] : ['Observe', 'Snapshot', 'Hover', 'Click'].includes(t) ? ['ref'] : t === 'PressKey' ? ['key'] : undefined);
  const settings = { GameViewportClientClassName: '', InputData: '' };
  const slotOf = (name) => `${blueprint}:WidgetTree.${name}.Slot`;
  const find = (path) => [...widgets.values()].find((w) => path === w.path || path === slotOf(w.name));
  const toolDescriptions = (toolset) => sets[toolset].map((t) => ({ name: `${toolset}.${t}`, description: t, inputSchema: { type: 'object', properties: Object.fromEntries((params[t] || []).map((p) => [p, {}])), required: requiredOf(t) } }));
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
      case 'MVVMToolset.CreateViewModel': case 'MVVMToolset.AddViewModelProperty': case 'MVVMToolset.AddViewModelToWidget': case 'MVVMToolset.CreateViewBinding':
      case 'MVVMToolset.ListViewModels': case 'MVVMToolset.ListWidgetViewModels': case 'MVVMToolset.ListWidgetViewBindings': {
        mvvm.calls.push(short);
        if (failMvvm === short) return { error: 'propertyType Text is not a type of this build' };
        if (short === 'CreateViewModel') { mvvm.viewModels.push(args.viewModelName); return { returnValue: ref(`${args.packagePath}/${args.viewModelName}.${args.viewModelName}`) }; }
        if (short === 'AddViewModelProperty') { if (typeof args.defaultValue !== 'string') return { error: 'input param "defaultValue" is required' }; mvvm.properties.push(args.propertyName); return { returnValue: true }; }
        if (short === 'AddViewModelToWidget') { if (!/_C$/.test(args.viewModelClass.refPath)) return { error: `${args.viewModelClass.refPath} is not valid Class for property 'ViewModelClass'.` }; mvvm.onWidget.push(args.viewModelClass.refPath); return { returnValue: true }; }
        if (short === 'CreateViewBinding') { if (!mvvm.compiled) return { error: "Failed to create view binding. Invalid property path 'ScoreText'. Property does not exist in 'VM_ProbeScore_C'" }; if (!args.destinationContext) return { error: 'input param "destinationContext" is required' }; mvvm.bindings.push({ source: args.sourcePropertyPath, destination: args.destinationContext.refPath, property: args.destinationPropertyPath }); return { returnValue: 'E05FCC13-4D37-9D7A-E238-83859F29AD74' }; }
        if (short === 'ListViewModels') return { returnValue: JSON.stringify(mvvm.viewModels) };
        if (short === 'ListWidgetViewModels') return { returnValue: JSON.stringify(mvvm.onWidget) };
        return { returnValue: JSON.stringify(mvvm.bindings) };
      }
      case 'SequencerToolset.add_track_to_sequence': animCalls.push(short); return { error: `Parameter error: ${args.sequence.refPath} is not valid LevelSequence for property 'sequence'.` };
      case 'SequencerToolset.add_track_to_binding': animCalls.push(short); return { error: "Failed to add track of type 'MovieSceneFloatTrack' to binding." };
      case 'SlateInspectorToolset.GetWidgetTree': slateCalls.push(short); return { returnValue: 'SWindow > SOverlay > SButton' };
      case 'SlateInspectorToolset.ClickWidget': slateCalls.push(short); return { returnValue: true };
      case 'SlateInspectorToolset.Observe': slateCalls.push(short); return { returnValue: 'observer_2' };
      case 'SlateInspectorToolset.Snapshot': slateCalls.push(short); return { returnValue: slateTree() };
      case 'SlateInspectorToolset.Hover': case 'SlateInspectorToolset.Click': case 'SlateInspectorToolset.PressKey': slateCalls.push(`${short}${args.ref ? ' ' + args.ref : ''}`); slate.onInput(short, args); return { returnValue: true };
      case 'BlueprintTools.create': return { returnValue: ref(`${args.folderPath}/${args.assetName}.${args.assetName}`) };
      case 'BlueprintTools.compile_blueprint': if (!ignoreCompile) mvvm.compiled = true; return { returnValue: null };
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
  return { handler, widgets, settings, slate, mvvm, attempts: () => widgetAttempts, mvvmCalls: () => mvvm.calls, slateCalls: () => slateCalls, animCalls: () => animCalls };
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


// ---------------------------------------------------------------- the new sessions against the fake editor
test('the animation and MVVM attempts describe the eight toolsets, call each MVVM tool once in order, and the List tools read the binding back', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: false, animation: true, mvvm: true });
    const get = (n) => report.steps.find((s) => s.step === n);
    assert.equal(get('animation_toolsets').toolsets.length, 8);
    assert.ok(get('animation_toolsets').toolsets.every((t) => t.tool_count > 0 && t.raw_length > 0), 'each description is kept');
    assert.equal(get('animation_blueprint').saved, true);
    assert.equal(get('animation_attempt').track_added, false);
    assert.match(get('animation_attempt').note, /no editor Python was available/);
    assert.equal(get('animation_attempt').calls.length, 2, 'the two track tools are still called once each');
    assert.deepEqual(editor.mvvmCalls(), ['CreateViewModel', 'AddViewModelProperty', 'AddViewModelToWidget', 'CreateViewBinding', 'ListViewModels', 'ListWidgetViewModels', 'ListWidgetViewBindings'], 'each tool once, in the order the toolset allows');
    const calls = get('mvvm_calls');
    assert.deepEqual([calls.view_model_created, calls.property_added, calls.added_to_widget, calls.binding_created], [true, true, true, true], JSON.stringify(calls.calls));
    assert.deepEqual([get('mvvm_lists').view_model_listed, get('mvvm_lists').widget_view_model_listed, get('mvvm_lists').binding_listed], [true, true, true]);
    assert.equal(get('mvvm_compile').returned, true);
    assert.ok(get('mvvm_compile').saved_assets.includes(MVVM_ASSET));
    assert.ok(get('mvvm_compile').saved_assets.some((a) => a.endsWith(MVVM_NAMES.viewModel)), 'the view model asset is saved too');
    const back = await readbackSession({ client, say: () => {}, animation: true, mvvm: true });
    assert.equal(back.steps.find((s) => s.step === 'mvvm_readback').binding_present, true);
    assert.equal(back.steps.find((s) => s.step === 'animation_readback').animation_found, false, 'a blueprint with no animation reads back none');
    const checks = evaluateProbes({ groups: ['mvvm'], reports: { base: { session: report, readback: back } } });
    assert.equal(passed(checks), true, failing(checks).join(' | '));
  } finally { server.close(); }
});

test('the animation attempt makes the container with editor Python, calls the two track tools once each, and records the refusals word for word', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    let sent;
    const py = async (code) => { sent = code; return { ok: true, result: { steps: [{ step: 'new_object WidgetAnimation inside the blueprint', ok: true }, { step: "animation.set_editor_property('movie_scene')", ok: false, error: "Failed to find property 'movie_scene'" }] } }; };
    const report = await baseSession({ client, say: () => {}, build: false, animation: true, py });
    const attempt = report.steps.find((x) => x.step === 'animation_attempt');
    assert.match(sent, /^ASSET = "\/Game\/UI\/WBP_ProbeAnim"\nANIM_NAME = "ProbeFade"\nTEXT_WIDGET = "[^"]+ProbeText"\n/, 'the runner supplies the names in front of the container script');
    assert.match(sent, /new_object\(unreal.WidgetAnimation/);
    assert.match(attempt.note, /outside the toolsets: new_object WidgetAnimation inside the blueprint: ok; animation.set_editor_property\('movie_scene'\): FAILED Failed to find property 'movie_scene'/);
    assert.deepEqual(editor.animCalls(), ['add_track_to_sequence', 'add_track_to_binding'], 'each tool once');
    assert.equal(attempt.calls[0].error, "Parameter error: /Game/UI/WBP_ProbeAnim.WBP_ProbeAnim:ProbeFade is not valid LevelSequence for property 'sequence'.");
    assert.equal(attempt.calls[1].error, "Failed to add track of type 'MovieSceneFloatTrack' to binding.");
    assert.equal(attempt.track_added, false);
    assert.equal(attempt.key_added, false);
    const checks = evaluateProbes({ groups: ['animation'], reports: { base: { session: report } } });
    assert.match(checks.find((c) => c.name.startsWith('a track is added')).detail, /add_track_to_sequence FAILED: Parameter error: .* is not valid LevelSequence/);
  } finally { server.close(); }
});

test('the animation read-back also looks in the saved asset for the names a widget animation writes', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  const project = mkdtempSync(join(tmpdir(), 'umg-asset-'));
  try {
    mkdirSync(join(project, 'Content', 'UI'), { recursive: true });
    const client = new McpClient({ port });
    await client.connect();
    const none = await readbackSession({ client, say: () => {}, animation: true, projectDir: project });
    assert.equal(none.steps.find((x) => x.step === 'animation_readback').animation_found, false, 'no saved file, no animation');
    writeFileSync(join(project, 'Content', 'UI', 'WBP_ProbeAnim.uasset'), Buffer.from('xx WidgetAnimation yy ProbeFade zz MovieSceneFloatTrack', 'latin1'));
    const found = await readbackSession({ client, say: () => {}, animation: true, projectDir: project });
    const back = found.steps.find((x) => x.step === 'animation_readback');
    assert.equal(back.animation_found, true);
    assert.equal(back.track_count, 1);
    assert.equal(back.key_count, 0, 'keys are not counted from file names');
    assert.equal(back.file_markers.WidgetAnimation, 1);
  } finally { server.close(); rmSync(project, { recursive: true, force: true }); }
});

test('a refused MVVM call is recorded word for word with the tool, the chain stops there and nothing is sent twice', async () => {
  const editor = fakeEditor({ failMvvm: 'AddViewModelProperty' });
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: false, mvvm: true });
    const calls = report.steps.find((s) => s.step === 'mvvm_calls');
    assert.equal(calls.property_added, false);
    const failed = calls.calls.find((c) => !c.ok);
    assert.match(failed.tool, /AddViewModelProperty$/);
    assert.equal(failed.error, 'propertyType Text is not a type of this build');
    assert.equal(editor.mvvmCalls().filter((c) => c === 'AddViewModelProperty').length, 2, 'two pin types are tried once each and neither is sent again');
    assert.deepEqual(calls.calls.filter((c) => /AddViewModelProperty$/.test(c.tool)).map((c) => c.args.propertyType), ['text', 'string']);
    const checks = evaluateProbes({ groups: ['mvvm'], reports: { base: { session: report } } });
    assert.match(checks.find((c) => c.name.startsWith('a view model with a property')).detail, /AddViewModelProperty FAILED: propertyType Text is not a type of this build/);
  } finally { server.close(); }
});

test('a binding refused for a missing property is recorded with the tool own message and is not sent again under the other spelling of the tool name', async () => {
  const editor = fakeEditor({ ignoreCompile: true });
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await baseSession({ client, say: () => {}, build: false, mvvm: true });
    const calls = report.steps.find((x) => x.step === 'mvvm_calls');
    assert.equal(calls.binding_created, false);
    assert.equal(editor.mvvmCalls().filter((c) => c === 'CreateViewBinding').length, 1, 'a message that says "does not exist" is the answer, not a refused tool name');
    assert.equal(calls.calls.find((c) => /CreateViewBinding$/.test(c.tool)).error, "Failed to create view binding. Invalid property path 'ScoreText'. Property does not exist in 'VM_ProbeScore_C'");
    assert.equal(calls.view_model_compiled, true, 'the compile was called');
  } finally { server.close(); }
});

test('the Slate inspector session describes the toolset, calls the tools that need no argument and leaves the input-like tools uncalled', async () => {
  const editor = fakeEditor();
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await slateSession({ client, say: () => {} });
    const describe = report.steps.find((s) => s.step === 'slate_describe');
    assert.equal(describe.tool_count, 7);
    assert.ok(describe.raw_length > 0);
    const routes = report.steps.find((s) => s.step === 'slate_routes').routes;
    assert.equal(routes.find((r) => r.route.endsWith('GetWidgetTree')).tried, true);
    assert.equal(routes.find((r) => r.route.endsWith('ClickWidget')).tried, false);
    assert.equal(report.steps.some((x) => x.step === 'slate_input'), false, 'without the stage report the Common button is not driven');
    assert.equal(routes.every((r) => r.observed === false), true);
    assert.deepEqual(editor.slateCalls(), ['GetWidgetTree']);
  } finally { server.close(); }
});

test('the Slate inspector session drives the Common button, reads the click counter and the state after each call, and clicks the editor control last', async () => {
  for (const reaches of [false, true]) {
    const editor = fakeEditor();
    editor.slate.clicksReachButton = reaches;
    const { server, port } = await fakeServer(editor.handler);
    try {
      const client = new McpClient({ port });
      await client.connect();
      const wait = (clicks) => ({ steps: { input_wait: { clicks, state: { is_hovered: false, is_pressed: false } } } });
      const report = await slateSession({ client, say: () => {}, settleMs: 5, readStage: () => wait(editor.slate.clicks) });
      const input = report.steps.find((s) => s.step === 'slate_input');
      assert.equal(input.button_ref, 'g5');
      assert.equal(input.drawer_ref, 'b16');
      const by = (re) => input.routes.find((r) => re.test(r.route));
      assert.equal(by(/Hover/).kind, 'precondition');
      assert.equal(by(/Click on the Common button/).delivered, true);
      assert.equal(by(/Click on the Common button/).observed, reaches, 'observed follows the counter the stage script publishes');
      assert.equal(by(/PressKey/).observed, false);
      assert.equal(by(/Content Drawer/).kind, 'control');
      assert.equal(by(/Content Drawer/).observed, true, 'the drawer opens and the snapshot grows');
      assert.equal(input.routes.at(-1).route.includes('Content Drawer'), true, 'the control is clicked last, after the routes on the button');
      assert.deepEqual(editor.slateCalls().filter((c) => /^(Observe|Hover|Click|PressKey)/.test(c)), ['Observe', 'Hover g5', 'Click g5', 'PressKey', 'Click b16']);
    } finally { server.close(); }
  }
});

test('without the Slate inspector toolset the session records its absence', async () => {
  const editor = fakeEditor({ withSlate: false });
  const { server, port } = await fakeServer(editor.handler);
  try {
    const client = new McpClient({ port });
    await client.connect();
    const report = await slateSession({ client, say: () => {} });
    assert.match(report.steps.find((s) => s.step === 'slate_describe').error, /not listed/);
  } finally { server.close(); }
});

test('the stage script keeps the input routes recorded and never writes a user path', () => {
  const stage = readFileSync(join(here, 'umg_stage.py'), 'utf8');
  for (const word of ['viewport_client', 'input_ready', 'UMG_CONTINUE', 'OnButtonBaseClicked.broadcast', 'input_key', 'CLICKED']) assert.ok(stage.includes(word), word);
  assert.equal(stage.includes('Users'), false);
});

// ---------------------------------------------------------------- calling into an open editor
test('pyCall writes the request once, waits for the result and reports a timeout without sending again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'umg-rpc-'));
  try {
    const answering = (async () => {   // the stage script: take request.py, write result.json
      for (let i = 0; i < 100; i++) {
        if (existsSync(join(dir, 'request.py'))) { const code = readFile(join(dir, 'request.py'), 'utf8'); rmSync(join(dir, 'request.py')); writeFileSync(join(dir, 'result.json'), JSON.stringify({ ok: true, result: code.toUpperCase() })); return; }
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const out = await pyCall(dir, 'result = 1', { timeoutMs: 3000, pollMs: 20 });
    await answering;
    assert.deepEqual(out, { ok: true, result: 'RESULT = 1' });
    const late = await pyCall(dir, 'nobody answers', { timeoutMs: 80, pollMs: 20 });
    assert.equal(late.timedOut, true);
    assert.match(late.error, /read the state back before sending anything again/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the hold loop answers each request file once, in name order, and stops at end.flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'umg-hold-'));
  const seen = [];
  const client = {
    inner: async (toolset, tool, args) => { seen.push(`${toolset}.${tool}`); return { ok: true, decoded: { text: JSON.stringify({ returnValue: args }) } }; },
    describeToolset: async (name) => ({ ok: true, decoded: { text: `described ${name}` } }),
    listToolsets: async () => ({ ok: true, decoded: { text: '- A.B: x' } }),
  };
  try {
    writeFileSync(join(dir, 'req-02.json'), JSON.stringify({ describe: 'X.Y' }));
    writeFileSync(join(dir, 'req-01.json'), JSON.stringify({ call: { toolset: 'T.T', tool: 'Do', arguments: { a: 1 } } }));
    writeFileSync(join(dir, 'req-03.json'), JSON.stringify({ py: 'print(1)' }));
    writeFileSync(join(dir, 'req-04.json'), JSON.stringify({ nothing: true }));
    const loop = holdLoop({ dir, ctx: { client, py: async (code) => ({ ok: true, result: code }) }, pollMs: 20, limitMs: 5000 });
    for (let i = 0; i < 100 && !existsSync(join(dir, 'res-04.json')); i++) await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(dir, 'end.flag'), '');
    assert.equal(await loop, 4);
    const res = (n) => JSON.parse(readFile(join(dir, `res-${n}.json`), 'utf8'));
    assert.equal(res('01').ok, true);
    assert.match(res('01').text, /"a":1/);
    assert.equal(res('02').text, 'described X.Y');
    assert.equal(res('03').result, 'print(1)');
    assert.equal(res('04').ok, false);
    assert.deepEqual(seen, ['T.T.Do'], 'each call is sent once');
    assert.equal(existsSync(join(dir, 'req-01.json')), false, 'a request file is removed when taken');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('answerRequest reports a timed-out call as a timeout and a stage read as the stage report', async () => {
  const client = { inner: async () => ({ ok: false, timedOut: true, error: 'timed out', decoded: undefined }) };
  const out = await answerRequest({ call: { toolset: 'T', tool: 'W', arguments: {} } }, { client });
  assert.deepEqual([out.ok, out.timedOut, out.error], [false, true, 'timed out']);
  assert.deepEqual((await answerRequest({ stage: true }, { stage: () => ({ steps: { a: 1 } }) })).stage, { steps: { a: 1 } });
});

// ---------------------------------------------------------------- hygiene
test('the runner and the session never resend a write', () => {
  const session = readFileSync(join(here, 'umg-session.mjs'), 'utf8'), mcp = readFileSync(join(here, 'umg-mcp.mjs'), 'utf8');
  assert.equal(/for \(let attempt/.test(session) || /for \(let attempt/.test(mcp), false);
  assert.match(session, /refused/, 'only a refused tool name is sent again');
});

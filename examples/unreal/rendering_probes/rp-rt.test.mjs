// node --test examples/unreal/rendering_probes/rp-rt.test.mjs  (no Unreal, no dependencies)
// The runs below are written by hand to the shape rp_rt_validate.mjs collects: the log lines are the strings the 5.8.2 renderer source logs (RenderUtils.cpp), and the report is
// the shape rp_rt_probe.py writes. Neither has been produced by an engine run yet: the first run confirms the report shape, the ProfileGPU wording and the exit code of a Fatal.
// The Light Renderer run (evaluateLights) was confirmed by an engine run on 2026-10-29: its CullLights line and report shape below are the ones the engine produced.
// Each test changes one fact and expects the matching check to fail, and an empty input fails every check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FATAL_TEXT, PHASES, PROFILE_END, PROFILE_START, countsAgree, engineIni, evaluateLights, evaluateRt, evaluateToggle, iniSection, lightsDrawn, megaLightsProfileLines, profileLightCounts,
  profileSection, rendererDiff, summarize,
} from './rp-rt-checks.mjs';

const ENABLED = 'LogRendererCore: Ray tracing is enabled (dynamic). Reason: r.RayTracing=1 and r.RayTracing.EnableOnDemand=1.';
const OFF = 'LogRendererCore: Ray tracing is disabled. Reason: disabled through project setting (r.RayTracing=0).';
const profile = (...between) => [`LogPython: ${PROFILE_START}`, ...between, `LogPython: ${PROFILE_END}`].join('\n');
const HARDWARE_CVARS = {
  'r.RayTracing': 1, 'r.SkinCache.CompileShaders': 1, 'r.GenerateMeshDistanceFields': 0, 'r.MegaLights.EnableForProject': 1, 'r.MegaLights.Allowed': 1,
  'r.MegaLights.HardwareRayTracing': 1, 'r.MegaLights.HardwareRayTracing.Inline': 1, 'r.MegaLights.SoftwareRayTracing.Allow': 0, 'r.RayTracing.EnableOnDemand': 1, 'r.ForwardShading': 0,
};
const canned = () => ({
  fatal: { exit: 3, timedOut: false, log: `${ENABLED}\nLogRendererCore: Fatal error: ${FATAL_TEXT}\n`, report: undefined },
  hardware: {
    exit: 0, timedOut: false, report: { engine: '5.8.2', cvars: { ...HARDWARE_CVARS }, seconds: 141.2, errors: [] },
    log: `${ENABLED}\nLogPython: [rp_rt] scene built\n${profile('LogRHI: Display:   0.31ms   MegaLights', 'LogRHI: Display:   1.20ms   BasePass')}\n`,
  },
  software: {
    exit: 0, timedOut: false,
    report: { engine: '5.8.2', cvars: { ...HARDWARE_CVARS, 'r.RayTracing': 0, 'r.GenerateMeshDistanceFields': 1, 'r.MegaLights.SoftwareRayTracing.Allow': 1 }, seconds: 140.9, errors: [] },
    log: `${OFF}\n${profile('LogRHI: Display:   0.52ms   MegaLights')}\n`,
  },
});
const failing = (runs) => evaluateRt(runs).filter((c) => !c.pass).map((c) => c.name);
const mutate = (fn) => { const r = canned(); fn(r); return failing(r); };
const N = {
  fatalLine: 'r.RayTracing on with the skin cache shaders off logs the Fatal line',
  fatalEnds: 'the Fatal ends the process before the probe script runs',
  hwStarts: 'with r.RayTracing and the skin cache shaders on, ray tracing starts enabled',
  hwCvars: 'the hardware phase reads its settings back',
  hwProfile: 'MegaLights shows in the GPU profile on the hardware route',
  swOff: 'without r.RayTracing the log says ray tracing is off by the project setting',
  swCvars: 'the software phase reads its settings back',
  swProfile: 'MegaLights shows in the GPU profile on the software route',
};

test('the canned runs pass every check', () => {
  assert.deepEqual(failing(canned()), []);
  const checks = evaluateRt(canned());
  assert.equal(checks.length, 8);
  assert.deepEqual(summarize(checks), { passed: 8, total: 8 });
});

test('the Fatal checks fail when the line is absent, the process survives or the probe ran', () => {
  assert.ok(mutate((r) => { r.fatal.log = ENABLED; }).includes(N.fatalLine));
  assert.deepEqual(mutate((r) => { r.fatal.exit = 0; }), [N.fatalEnds]);
  assert.deepEqual(mutate((r) => { r.fatal.timedOut = true; r.fatal.exit = null; }), [N.fatalEnds]);
  assert.deepEqual(mutate((r) => { r.fatal.report = { cvars: {} }; }), [N.fatalEnds]);
});

test('a machine whose RHI cannot ray trace is named in the detail of the failed check', () => {
  const r = canned();
  r.fatal.log = 'LogRendererCore: Ray tracing is disabled. Reason: not supported by current RHI.';
  const detail = evaluateRt(r).find((c) => c.name === N.fatalLine).detail;
  assert.match(detail, /does not support ray tracing/);
});

test('the hardware phase needs the enabled line, no Fatal, a report and the right settings', () => {
  assert.deepEqual(mutate((r) => { r.hardware.log = r.hardware.log.replace(ENABLED, OFF); }), [N.hwStarts]);
  assert.deepEqual(mutate((r) => { r.hardware.log += `${FATAL_TEXT}\n`; }), [N.hwStarts]);
  assert.deepEqual(mutate((r) => { r.hardware.report = undefined; }), [N.hwStarts, N.hwCvars]);
  assert.deepEqual(mutate((r) => { r.hardware.report.cvars['r.SkinCache.CompileShaders'] = 0; }), [N.hwCvars]);
  assert.deepEqual(mutate((r) => { r.hardware.report.cvars['r.MegaLights.HardwareRayTracing'] = 0; }), [N.hwCvars]);
});

test('the enabled line is also accepted with on-demand ray tracing off', () => {
  const r = canned();
  r.hardware.log = r.hardware.log.replace(ENABLED, 'LogRendererCore: Ray tracing is enabled. Reason: r.RayTracing=1 and r.RayTracing.EnableOnDemand=0.');
  assert.deepEqual(failing(r), []);
});

test('the software phase needs the off-by-setting line and the software settings', () => {
  assert.deepEqual(mutate((r) => { r.software.log = r.software.log.replace(OFF, ENABLED); }), [N.swOff]);
  assert.deepEqual(mutate((r) => { r.software.report.cvars['r.MegaLights.SoftwareRayTracing.Allow'] = 0; }), [N.swCvars]);
  assert.deepEqual(mutate((r) => { r.software.report.cvars['r.GenerateMeshDistanceFields'] = 0; }), [N.swCvars]);
  assert.deepEqual(mutate((r) => { r.software.report.cvars['r.RayTracing'] = 1; }), [N.swCvars]);
});

test('the profile checks look only between the markers and ignore the probe own lines', () => {
  assert.deepEqual(mutate((r) => { r.hardware.log = `${ENABLED}\nLogRHI: MegaLights outside the markers\n${profile('LogRHI: Display: 1.0ms BasePass')}`; }), [N.hwProfile]);
  assert.deepEqual(mutate((r) => { r.software.log = `${OFF}\n${profile()}`; }), [N.swProfile]);
  assert.deepEqual(mutate((r) => { r.software.log = `${OFF}\nLogPython: ${PROFILE_START} MegaLights\nLogPython: ${PROFILE_END}`; }), [N.swProfile]);
  assert.deepEqual(mutate((r) => { r.software.log = OFF; }), [N.swProfile]);
  assert.equal(profileSection('no markers'), '');
  assert.deepEqual(megaLightsProfileLines(canned().hardware.log), ['LogRHI: Display:   0.31ms   MegaLights']);
  // a profile whose end marker never came (the editor was cut off) is read to the end of the log
  assert.deepEqual(megaLightsProfileLines(`LogPython: ${PROFILE_START}\nLogRHI: MegaLights 0.2ms`), ['LogRHI: MegaLights 0.2ms']);
});

test('an empty input fails every check instead of throwing', () => {
  for (const input of [{}, undefined]) {
    const checks = evaluateRt(input);
    assert.equal(checks.length, 8);
    assert.ok(checks.every((c) => c.pass === false));
  }
});

test('the ini each phase writes has the graphics lines and only the keys the phase needs', () => {
  const fatal = engineIni(PHASES.fatal), hardware = engineIni(PHASES.hardware), software = engineIni(PHASES.software);
  for (const text of [fatal, hardware, software]) {
    assert.match(text, /DefaultGraphicsRHI=DefaultGraphicsRHI_DX12/);
    assert.match(text, /\+D3D12TargetedShaderFormats=PCD3D_SM6/);
  }
  assert.deepEqual(iniSection(fatal, '/Script/Engine.RendererSettings'), { 'r.RayTracing': ['True'] });
  assert.deepEqual(iniSection(hardware, '/Script/Engine.RendererSettings'), { 'r.RayTracing': ['True'], 'r.SkinCache.CompileShaders': ['True'], 'r.MegaLights.EnableForProject': ['True'] });
  assert.deepEqual(iniSection(software, '/Script/Engine.RendererSettings'), { 'r.SkinCache.CompileShaders': ['True'], 'r.MegaLights.EnableForProject': ['True'], 'r.GenerateMeshDistanceFields': ['True'] });
  assert.deepEqual(iniSection(software, 'SystemSettings'), { 'r.MegaLights.SoftwareRayTracing.Allow': ['1'] });
  assert.deepEqual(iniSection(fatal, 'SystemSettings'), {});
  assert.deepEqual(iniSection(hardware, '/Script/WindowsTargetPlatform.WindowsTargetSettings').D3D12TargetedShaderFormats, ['ClearArray', 'PCD3D_SM6']);
});

// ---- the editor toggle: the owner ticks Support Hardware Ray Tracing and answers Yes; the ini text before and after is compared
const BEFORE = engineIni({});
const AFTER_YES = `${BEFORE.trimEnd()}\nr.RayTracing=True\nr.SkinCache.CompileShaders=1\n`;

test('a toggle that writes r.RayTracing and the skin cache key passes, whichever name the ini uses', () => {
  const checks = evaluateToggle({ before: BEFORE, after: AFTER_YES });
  assert.deepEqual(checks.map((c) => c.pass), [true, true]);
  assert.match(checks[1].detail, /r\.SkinCache\.CompileShaders=1/);
  const byProperty = evaluateToggle({ before: BEFORE, after: `${BEFORE.trimEnd()}\nr.RayTracing=True\nSkinningShaderSupport=InlineAndSkinCacheShaders\n` });
  assert.deepEqual(byProperty.map((c) => c.pass), [true, true]);
});

test('a toggle that leaves the skin cache alone, or answered No, fails the matching check', () => {
  const noSkin = evaluateToggle({ before: BEFORE, after: `${BEFORE.trimEnd()}\nr.RayTracing=True\n` });
  assert.deepEqual(noSkin.map((c) => c.pass), [true, false]);
  assert.match(noSkin[1].detail, /neither key changed/);
  const refused = evaluateToggle({ before: BEFORE, after: `${BEFORE.trimEnd()}\nr.RayTracing=False\n` });
  assert.deepEqual(refused.map((c) => c.pass), [false, false]);
  const inline = evaluateToggle({ before: BEFORE, after: `${BEFORE.trimEnd()}\nr.RayTracing=True\nSkinningShaderSupport=InlineShadersOnly\n` });
  assert.deepEqual(inline.map((c) => c.pass), [true, false]);
  assert.deepEqual(evaluateToggle({}).map((c) => c.pass), [false, false]);
});

test('the diff lists only RendererSettings keys that changed', () => {
  assert.deepEqual(rendererDiff(BEFORE, AFTER_YES), {
    'r.RayTracing': { before: undefined, after: 'True' },
    'r.SkinCache.CompileShaders': { before: undefined, after: '1' },
  });
  assert.deepEqual(rendererDiff(BEFORE, BEFORE), {});
  assert.deepEqual(rendererDiff(`[Other]\nr.RayTracing=True\n${BEFORE}`, BEFORE), {});
});

// ---- the Niagara Light Renderer count: a commandlet builds the system, a rendering editor draws it and profiles the GPU
const CULL = (n) => `LogRHI: Display:   0.05ms   CullLights 52x30x32 NumLights ${n} NumCaptures 0`;
const cannedLights = () => ({
  build: { exit: 0, timedOut: false, log: '', report: { system: '/Game/Lights/NS_RpLights', saved: true, switches: { bAllowMegaLights: true, bMegaLightsCastShadows: true }, renderers: ['NiagaraSpriteRendererProperties', 'NiagaraLightRendererProperties'], errors: [] } },
  render: {
    exit: 0, timedOut: false,
    report: { cvars: { ...HARDWARE_CVARS, 'r.MegaLights.SimpleLightMode': 1 }, particles: { Lights: 145 }, errors: [], seconds: 150 },
    log: `${ENABLED}
${profile(CULL(145), 'LogRHI: Display:   0.40ms   MegaLights')}
`,
  },
});
const failingLights = (fn) => { const r = cannedLights(); fn(r); return evaluateLights(r).filter((c) => !c.pass).map((c) => c.name); };
const L = {
  build: 'the build step makes a Light renderer with both MegaLights switches on',
  starts: 'the render step starts with ray tracing enabled and writes its report',
  cvars: 'the render step reads the MegaLights settings back',
  count: 'the GPU profile gives the number of lights drawn',
  match: 'the lights drawn match the live particles',
  mega: 'MegaLights shows in the GPU profile with the Light renderer in the scene',
};

test('the canned Light Renderer run passes every check', () => {
  assert.deepEqual(failingLights(() => {}), []);
  assert.deepEqual(summarize(evaluateLights(cannedLights())), { passed: 6, total: 6 });
});

test('the lights count is read from the CullLights lines between the markers only', () => {
  assert.deepEqual(profileLightCounts(cannedLights().render.log), [{ grid: [52, 30, 32], lights: 145, captures: 0 }]);
  assert.equal(lightsDrawn(cannedLights().render.log), 145);
  assert.equal(lightsDrawn(`${CULL(9)}
${profile(CULL(3), CULL(7))}
${CULL(11)}`), 7);   // the larger of two views; lines outside the markers do not count
  assert.equal(lightsDrawn(profile('LogRHI: Display: 1.0ms BasePass')), undefined);
  assert.equal(lightsDrawn(''), undefined);
  assert.deepEqual(failingLights((r) => { r.render.log = `${ENABLED}
${CULL(145)}
${profile('LogRHI: MegaLights')}`; }), [L.count, L.match]);
  assert.deepEqual(failingLights((r) => { r.render.log = r.render.log.replace(CULL(145), CULL(0)); }), [L.count, L.match]);
});

test('the lights and the particles must agree to within a frame of spawns and deaths', () => {
  assert.ok(countsAgree(145, 145));
  assert.ok(countsAgree(147, 145));
  assert.ok(countsAgree(60, 62));
  assert.ok(!countsAgree(145, 100));
  assert.ok(!countsAgree(145, undefined));
  assert.ok(!countsAgree(undefined, 145));
  assert.deepEqual(failingLights((r) => { r.render.report.particles = { Lights: 20 }; }), [L.match]);
  assert.deepEqual(failingLights((r) => { r.render.report.particles = null; }), [L.match]);
  assert.deepEqual(failingLights((r) => { r.render.report.particles = { Lights: 100, Other: 45 }; }), []);   // emitters are summed
});

test('the build checks fail when a switch is off, the system is not saved or the step errored', () => {
  assert.deepEqual(failingLights((r) => { r.build.report.switches.bMegaLightsCastShadows = false; }), [L.build]);
  assert.deepEqual(failingLights((r) => { r.build.report.switches = {}; }), [L.build]);
  assert.deepEqual(failingLights((r) => { r.build.report.saved = false; }), [L.build]);
  assert.deepEqual(failingLights((r) => { r.build.report.errors = ['Traceback']; }), [L.build]);
  assert.deepEqual(failingLights((r) => { r.build.exit = 1; }), [L.build]);
});

test('the render checks fail on a Fatal, a missing report, a changed setting or a missing MegaLights pass', () => {
  assert.deepEqual(failingLights((r) => { r.render.log += `${FATAL_TEXT}
`; }), [L.starts]);
  assert.deepEqual(failingLights((r) => { r.render.log = r.render.log.replace(ENABLED, OFF); }), [L.starts]);
  assert.ok(failingLights((r) => { r.render.report = undefined; }).includes(L.starts));
  assert.deepEqual(failingLights((r) => { r.render.report.cvars['r.MegaLights.SimpleLightMode'] = 0; }), [L.cvars]);
  assert.deepEqual(failingLights((r) => { r.render.report.cvars['r.MegaLights.HardwareRayTracing'] = 0; }), [L.cvars]);
  assert.deepEqual(failingLights((r) => { r.render.log = r.render.log.replace('MegaLights', 'Lighting'); }), [L.mega]);
});

test('an empty Light Renderer input fails every check instead of throwing', () => {
  for (const input of [{}, undefined]) {
    const checks = evaluateLights(input);
    assert.equal(checks.length, 6);
    assert.ok(checks.every((c) => c.pass === false));
  }
});

test('the lights launch writes the hardware ini plus the recompile-on-load variable, and no other phase does', () => {
  const lights = engineIni(PHASES.lights);
  assert.deepEqual(iniSection(lights, '/Script/Engine.RendererSettings'), iniSection(engineIni(PHASES.hardware), '/Script/Engine.RendererSettings'));
  assert.deepEqual(iniSection(lights, 'ConsoleVariables'), { 'fx.ForceCompileOnLoad': ['1'] });
  for (const name of ['fatal', 'hardware', 'software']) assert.deepEqual(iniSection(engineIni(PHASES[name]), 'ConsoleVariables'), {});
});

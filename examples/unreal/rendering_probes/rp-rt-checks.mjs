// Pure checks for rp_rt_validate.mjs, the opt-in MegaLights tracing-route probes: turn the logs and JSON reports of three editor launches, and the before and after text of a
// project's DefaultEngine.ini, into pass or fail results. No Unreal, no files, no dependencies; rp-rt.test.mjs feeds it canned runs.
// Prepared 2026-10-26, not yet run on an engine. The expected log lines and cvar values come from reading the 5.8.2 renderer source (RenderCore/Private/RenderUtils.cpp,
// Renderer/Private/MegaLights/MegaLights.cpp and MegaLightsRayTracing.cpp, Engine/Private/RendererSettings.cpp), not from a run, so a failed check on the first run may
// be the probe's mistake or a wrong reading of the source; the detail names what was seen.
//   A run is { exit, timedOut, log, report } for one editor launch; report is the parsed rp_rt_probe.py JSON or undefined.

/** The Fatal text of RenderUtils.cpp, written when r.RayTracing is on and r.SkinCache.CompileShaders is 0. */
export const FATAL_TEXT = 'Ray tracing requires skin cache to be enabled. Set r.SkinCache.CompileShaders>=1.';
// r.RayTracing.EnableOnDemand defaults to 1, so the mode is Dynamic and the log says "enabled (dynamic)"; with it at 0 the log says "enabled" (RenderUtils.cpp GetRayTracingModeName).
export const RT_ENABLED = /Ray tracing is enabled( \(dynamic\))?\. Reason: r\.RayTracing=1 and r\.RayTracing\.EnableOnDemand=\d\./;
export const RT_UNSUPPORTED = /Ray tracing is disabled\. Reason: not supported by current RHI\./;
export const RT_OFF_BY_SETTING = /Ray tracing is disabled\. Reason: disabled through project setting \(r\.RayTracing=0\)\./;
export const PROFILE_START = '[rp_rt] ProfileGPU requested';
export const PROFILE_END = '[rp_rt] ProfileGPU wait done';

/** Settings the three launches differ by. */
export const PHASES = {
  fatal: { rayTracing: true, skinCache: false, megaLights: false },
  hardware: { rayTracing: true, skinCache: true, megaLights: true },
  software: { rayTracing: false, skinCache: true, megaLights: true, distanceFields: true, softwareRayTracing: true },
};

/**
 * The DefaultEngine.ini text for one phase. The graphics lines are what the engine's own new-project code writes (GameProjectUtils.cpp): DX12, SM6 only. The RendererSettings keys
 * are the console variable names the editor's Project Settings write for ray tracing and the skin cache (GameProjectUtils.cpp AddRaytracingConfigValues).
 */
export function engineIni({ rayTracing = false, skinCache = false, megaLights = false, distanceFields = false, softwareRayTracing = false } = {}) {
  const lines = [
    '[/Script/WindowsTargetPlatform.WindowsTargetSettings]',
    'DefaultGraphicsRHI=DefaultGraphicsRHI_DX12',
    '!D3D12TargetedShaderFormats=ClearArray',
    '+D3D12TargetedShaderFormats=PCD3D_SM6',
    '',
    '[/Script/Engine.RendererSettings]',
  ];
  if (rayTracing) lines.push('r.RayTracing=True');
  if (skinCache) lines.push('r.SkinCache.CompileShaders=True');
  if (megaLights) lines.push('r.MegaLights.EnableForProject=True');
  if (distanceFields) lines.push('r.GenerateMeshDistanceFields=True');
  if (softwareRayTracing) lines.push('', '[SystemSettings]', 'r.MegaLights.SoftwareRayTracing.Allow=1');
  return `${lines.join('\n')}\n`;
}

/** The keys of one ini section as { key: [values] }; the +, -, ! and . array prefixes are dropped, comments and other sections skipped. */
export function iniSection(text, section) {
  const out = {};
  let inside = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) { inside = header[1] === section; continue; }
    if (!inside) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^[+\-!.]/, '');
    (out[key] ??= []).push(line.slice(eq + 1).trim());
  }
  return out;
}

const RENDERER = '/Script/Engine.RendererSettings';
const truthy = (v) => /^(true|1)$/i.test(String(v));

/** Keys of the RendererSettings section that differ between two ini texts, as { key: { before, after } } with undefined for absent. */
export function rendererDiff(before, after) {
  const a = iniSection(before, RENDERER), b = iniSection(after, RENDERER), out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key]?.join(','), y = b[key]?.join(',');
    if (x !== y) out[key] = { before: x, after: y };
  }
  return out;
}

/**
 * The checks of the editor toggle: the owner clicks Project Settings > Rendering > Hardware Ray Tracing > Support Hardware Ray Tracing, answers Yes to the skin cache prompt,
 * and the two ini texts are compared. Source (RendererSettings.cpp PostEditChangeProperty) predicts that a Yes also raises the skin cache shader support and writes it.
 */
export function evaluateToggle({ before, after } = {}) {
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const diff = rendererDiff(before, after);
  const changed = Object.entries(diff).map(([k, v]) => `${k}: ${v.before ?? '(absent)'} -> ${v.after ?? '(absent)'}`).join('; ') || 'no RendererSettings key changed';
  const rt = diff['r.RayTracing'];
  check('the toggle writes r.RayTracing', 'Support Hardware Ray Tracing writes r.RayTracing=True under [/Script/Engine.RendererSettings] of Config/DefaultEngine.ini',
    Boolean(rt) && truthy(rt.after), changed);
  const skinKey = ['r.SkinCache.CompileShaders', 'SkinningShaderSupport'].find((k) => diff[k]);
  const skin = skinKey && diff[skinKey].after;
  check('the toggle also writes the skin cache shader support',
    'Answering Yes to the skin cache prompt writes r.SkinCache.CompileShaders (or the property name SkinningShaderSupport) as a value that is not InlineShadersOnly',
    Boolean(skinKey) && skin !== undefined && !/^(0|false|InlineShadersOnly)$/i.test(skin), skinKey ? `${skinKey}=${skin}` : `neither key changed (${changed})`);
  return out;
}

const lines = (text) => String(text ?? '').split(/\r?\n/);

/** The part of the log between the ProfileGPU request and the end of the wait, or '' when the markers are missing. */
export function profileSection(log) {
  const all = lines(log);
  const start = all.findIndex((l) => l.includes(PROFILE_START));
  if (start < 0) return '';
  const end = all.findIndex((l, i) => i > start && l.includes(PROFILE_END));
  return all.slice(start + 1, end < 0 ? all.length : end).join('\n');
}

/** Lines of the ProfileGPU section that name MegaLights (the probe's own marker lines excluded). */
export function megaLightsProfileLines(log) {
  return lines(profileSection(log)).filter((l) => /MegaLights/.test(l) && !l.includes('[rp_rt]'));
}

const same = (a, b) => a === b;

/**
 * @param {{ fatal?: object, hardware?: object, software?: object }} runs
 * @returns {{ name: string, claim: string, pass: boolean, detail: string }[]}
 */
export function evaluateRt(runs) {
  const { fatal = {}, hardware = {}, software = {} } = runs ?? {};
  const out = [];
  const check = (name, claim, pass, detail = '') => out.push({ name, claim, pass: Boolean(pass), detail: String(detail) });
  const logOf = (r) => String(r.log ?? '');
  const cv = (r) => r.report?.cvars ?? {};
  const unsupported = (r) => RT_UNSUPPORTED.test(logOf(r));
  const why = (r) => (unsupported(r) ? 'the RHI on this machine does not support ray tracing, so this phase cannot test the claim; ' : '');

  check('r.RayTracing on with the skin cache shaders off logs the Fatal line',
    `The engine logs "${FATAL_TEXT}"`, logOf(fatal).includes(FATAL_TEXT),
    `${why(fatal)}exit ${fatal.exit}${fatal.timedOut ? ' (timed out)' : ''}; Fatal line ${logOf(fatal).includes(FATAL_TEXT) ? 'present' : 'absent'}`);
  check('the Fatal ends the process before the probe script runs',
    'The process ends by itself with a non-zero exit code and no report is written', fatal.timedOut !== true && Number.isInteger(fatal.exit) && fatal.exit !== 0 && !fatal.report,
    `exit ${fatal.exit}; report ${fatal.report ? 'written' : 'absent'}`);

  check('with r.RayTracing and the skin cache shaders on, ray tracing starts enabled',
    'The log says "Ray tracing is enabled" with r.RayTracing=1, has no Fatal line, and the probe wrote its report',
    RT_ENABLED.test(logOf(hardware)) && !logOf(hardware).includes(FATAL_TEXT) && Boolean(hardware.report),
    `${why(hardware)}enabled line ${RT_ENABLED.test(logOf(hardware))}; Fatal ${logOf(hardware).includes(FATAL_TEXT)}; report ${hardware.report ? 'written' : 'absent'}`);
  const h = cv(hardware);
  check('the hardware phase reads its settings back',
    'r.RayTracing 1, r.SkinCache.CompileShaders at least 1, r.MegaLights.EnableForProject 1, r.MegaLights.Allowed 1 and r.MegaLights.HardwareRayTracing 1',
    same(h['r.RayTracing'], 1) && h['r.SkinCache.CompileShaders'] >= 1 && same(h['r.MegaLights.EnableForProject'], 1) && same(h['r.MegaLights.Allowed'], 1) && same(h['r.MegaLights.HardwareRayTracing'], 1),
    JSON.stringify(h));
  const hardwareLines = megaLightsProfileLines(logOf(hardware));
  check('MegaLights shows in the GPU profile on the hardware route',
    'A ProfileGPU taken after the warm-up lists a MegaLights pass (the read-back is a candidate; its absence says only that this read-back did not work)',
    hardwareLines.length > 0, hardwareLines.length ? `${hardwareLines.length} line(s), first: ${hardwareLines[0].trim().slice(0, 140)}` : 'no MegaLights line between the markers');

  check('without r.RayTracing the log says ray tracing is off by the project setting',
    'The log says "Ray tracing is disabled. Reason: disabled through project setting (r.RayTracing=0)", has no Fatal line, and the probe wrote its report',
    RT_OFF_BY_SETTING.test(logOf(software)) && !logOf(software).includes(FATAL_TEXT) && Boolean(software.report),
    `off-by-setting line ${RT_OFF_BY_SETTING.test(logOf(software))}; Fatal ${logOf(software).includes(FATAL_TEXT)}; report ${software.report ? 'written' : 'absent'}`);
  const s = cv(software);
  check('the software phase reads its settings back',
    'r.RayTracing 0, r.MegaLights.SoftwareRayTracing.Allow 1, r.GenerateMeshDistanceFields 1, r.MegaLights.EnableForProject 1',
    same(s['r.RayTracing'], 0) && same(s['r.MegaLights.SoftwareRayTracing.Allow'], 1) && same(s['r.GenerateMeshDistanceFields'], 1) && same(s['r.MegaLights.EnableForProject'], 1),
    JSON.stringify(s));
  const softwareLines = megaLightsProfileLines(logOf(software));
  check('MegaLights shows in the GPU profile on the software route',
    'A ProfileGPU taken after the warm-up lists a MegaLights pass with hardware ray tracing off (the same candidate read-back)',
    softwareLines.length > 0, softwareLines.length ? `${softwareLines.length} line(s), first: ${softwareLines[0].trim().slice(0, 140)}` : 'no MegaLights line between the markers');
  return out;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}

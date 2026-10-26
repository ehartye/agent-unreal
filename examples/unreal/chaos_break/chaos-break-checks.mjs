// Judges what chaos_break.mjs collects. Pure functions, no Unreal and no dependencies.
// The report shapes are those ChaosBreakBuildCommandlet.cpp and ChaosBreakRunSubsystem.cpp write. No engine run has produced one yet,
// so the node test builds them by hand; the first run confirms the shape (see README.md).
//   buildReport = JSON of the commandlet run (variants built from a static mesh).
//   runs        = { verbose, silent, exec } each { exit, report, log } for a game process running the break scenarios.

export const NO_GEOMETRY_LINE = /GeometryCollection Transform \d+ has no geometry/;
export const NO_PARTICLES_LINE = /Geometry collection .+ tried to create \d+ particles with no geometry/;
export const MATERIAL_LINE = /Material (\S+) missing usage flag GeometryCollections! Default Material will be used in game\./;

/** Healthy assets on the cube mesh were 320 to 374 KB where the noise spacing was coarse; 39 MB where it was 1 cm. */
export const DEFAULT_MAX_HEALTHY_BYTES = 2_000_000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parse report text; a byte order mark is tolerated. Returns undefined for missing or unreadable text. */
export function parseReport(text) {
  if (!text) return undefined;
  try { return JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return undefined; }
}

/** Log lines that name the scenario's component: the engine prints the component's full name, which holds the actor label. */
export function linesFor(log, label) {
  const own = new RegExp(`\\.${escapeRe(label)}\\.`);
  return String(log ?? '').split(/\r?\n/).filter((l) => own.test(l));
}

/**
 * Judge one scenario of a game run, the way a project check would. A scenario passes only when pieces separated and the log holds no
 * "no geometry" line that names it (and, when asked, no material usage warning that names it).
 * Returns { ok, reasons[] }.
 */
export function judgeBreakRun(scenario, log, { checkMaterial = false } = {}) {
  const reasons = [];
  if (!scenario) return { ok: false, reasons: ['scenario missing from the report'] };
  if (!scenario.spawned) reasons.push('scenario did not spawn');
  if (!(scenario.breaksFinal > 0)) reasons.push('zero break events');
  const own = linesFor(log, scenario.label);
  if (own.some((l) => NO_PARTICLES_LINE.test(l))) reasons.push('log: tried to create particles with no geometry');
  if (checkMaterial && String(log ?? '').split(/\r?\n/).some((l) => MATERIAL_LINE.test(l))) reasons.push('log: material is missing the Geometry Collections usage flag');
  return { ok: reasons.length === 0, reasons };
}

const find = (report, label) => (report?.scenarios ?? []).find((s) => s.label === label);
const variant = (report, name) => (report?.variants ?? []).find((v) => v.name === name);
const MB = (n) => (n / 1e6).toFixed(2);

/** input: { build: {exit, log}, buildReport, runs: { verbose, silent, exec }, options: { maxHealthyBytes, checkMaterial } } */
export function evaluate({ build, buildReport, runs = {}, options = {} }) {
  const maxHealthy = options.maxHealthyBytes ?? DEFAULT_MAX_HEALTHY_BYTES;
  const checks = [];
  const add = (name, claim, pass, detail, info = false) => checks.push({ name, claim, pass: !!pass, detail, info });

  add('project compiles', 'the runtime module and the editor build module compile against the Fracture, PlanarCut and GeometryCollectionEngine modules',
    build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);

  const b = buildReport;
  const wanted = (b?.variants ?? []);
  add('assets are built in a commandlet', 'the commandlet appends a mesh, fractures it, saves every requested asset and reports no error',
    !!b && wanted.length > 0 && (b.errors ?? []).length === 0 && wanted.every((v) => v.ok && v.appended && v.fileBytes > 0),
    b ? `variants ${wanted.map((v) => `${v.name}${v.ok ? '' : ` (${v.error})`}`).join(', ')}; errors ${JSON.stringify(b.errors ?? [])}` : 'no build report');

  const healthyAsset = variant(b, 'healthy');
  add('healthy asset has hulls and a small file', `GetValidConvexHullData leaves convex hulls on the pieces and the saved asset stays under ${MB(maxHealthy)} MB`,
    !!healthyAsset && healthyAsset.hullTransforms > 0 && healthyAsset.fileBytes > 0 && healthyAsset.fileBytes < maxHealthy,
    healthyAsset ? `${healthyAsset.hullTransforms} transforms with hulls of ${healthyAsset.transforms}, ${MB(healthyAsset.fileBytes)} MB` : 'no healthy variant');
  const nohull = variant(b, 'nohull');
  add('control asset has no hulls', 'the variant that skips the hull step really has no convex hull data (the negative control is what it claims to be)',
    !!nohull && nohull.hullTransforms === 0 && nohull.hullObjects === 0, nohull ? `${nohull.hullTransforms} transforms with hulls, ${nohull.hullObjects} hull objects` : 'no nohull variant');

  const verbose = runs.verbose;
  const vr = verbose?.report;
  const scenarios = vr?.scenarios ?? [];
  add('game process wrote a report', 'the scenario subsystem spawned every scenario in a running game and wrote its report',
    !!vr && scenarios.length > 0 && (vr.errors ?? []).length === 0 && scenarios.every((s) => s.assetLoaded && s.spawned),
    vr ? `${scenarios.length} scenarios; errors ${JSON.stringify(vr.errors ?? [])}` : 'no game report');

  const strain = judgeBreakRun(find(vr, 'healthy_strain'), verbose?.log, { checkMaterial: options.checkMaterial });
  const healthyRun = find(vr, 'healthy_strain');
  add('a healthy collection breaks', 'strain and crumble on a collection with hulls separate pieces: the break-event count is above zero and the log has no no-geometry line',
    strain.ok, healthyRun ? `${healthyRun.breaksAfterStrain} break events after the strain, ${healthyRun.breaksFinal} after the crumble (${healthyRun.distinctFinal} distinct pieces); ${strain.reasons.join('; ') || 'judged ok'}` : 'scenario missing');

  const idle = find(vr, 'healthy_idle');
  add('the control does not break', 'the same asset with no strain applied produces no break event during the run',
    !!idle && idle.spawned && idle.breaksFinal === 0, idle ? `${idle.breaksFinal} break events` : 'scenario missing');

  const noHullRun = find(vr, 'nohull_strain');
  const noHullVerdict = judgeBreakRun(noHullRun, verbose?.log);
  add('the no-hull control fails the check', 'a collection without hulls is rejected: zero break events and the no-geometry line naming it in the verbose log',
    !noHullVerdict.ok && noHullVerdict.reasons.includes('zero break events') && noHullVerdict.reasons.includes('log: tried to create particles with no geometry'),
    noHullRun ? `${noHullRun.breaksFinal} break events; verdict ${noHullVerdict.ok ? 'ok' : noHullVerdict.reasons.join('; ')}` : 'scenario missing');

  const noProxy = find(vr, 'noproxy_strain');
  add('a component without a physics proxy is silent', 'after DestroyPhysicsState the strain and crumble calls do nothing: no proxy, zero break events',
    !!noProxy && noProxy.hasProxyAtStrain === false && noProxy.breaksFinal === 0, noProxy ? `hasProxy ${noProxy.hasProxyAtStrain}, ${noProxy.breaksFinal} break events` : 'scenario missing');

  const quiet = runs.silent;
  const quietNoHull = find(quiet?.report, 'nohull_strain');
  add('normal verbosity prints nothing', 'without LogChaos Verbose the same broken collection logs no no-geometry line and still produces zero break events',
    !!quietNoHull && quietNoHull.breaksFinal === 0 && !NO_GEOMETRY_LINE.test(quiet?.log ?? '') && !NO_PARTICLES_LINE.test(quiet?.log ?? ''),
    quietNoHull ? `${quietNoHull.breaksFinal} break events; no-geometry lines ${NO_GEOMETRY_LINE.test(quiet?.log ?? '')}` : 'no silent run');

  add('-LogCmds turns the lines on at launch', 'launching with -LogCmds="LogChaos Verbose" prints both no-geometry lines for the broken collection',
    NO_GEOMETRY_LINE.test(verbose?.log ?? '') && NO_PARTICLES_LINE.test(verbose?.log ?? ''),
    `transform line ${NO_GEOMETRY_LINE.test(verbose?.log ?? '')}, particles line ${NO_PARTICLES_LINE.test(verbose?.log ?? '')}`);

  // Observations: recorded, never failing.
  const note = (name, claim, detail) => add(name, claim, true, detail, true);
  const late = find(vr, 'healthy_late');
  if (late) note('observation: late SetRestCollection', 'SetRestCollection after FinishSpawning also breaks (the deferred order may be unnecessary)', `${late.breaksFinal} break events, ${late.distinctFinal} distinct`);
  for (const name of ['update_hulls', 'simdata_first', 'fine_spacing']) {
    const v = variant(b, name);
    const s = find(vr, `${name}_strain`);
    if (v) note(`observation: ${name}`, 'built by the variant of the same name', `${v.hullTransforms} transforms with hulls of ${v.transforms}, ${MB(v.fileBytes)} MB, simulation data dirty ${v.simulationDataDirty}${s ? `; ${s.breaksFinal} break events` : ''}`);
  }
  const exec = runs.exec;
  if (exec) note('observation: -ExecCmds form', 'a "log LogChaos Verbose" console command from -ExecCmds may or may not run before the collection is created',
    `no-geometry particles line ${NO_PARTICLES_LINE.test(exec.log ?? '')}; ${find(exec.report, 'nohull_strain')?.breaksFinal ?? 'no report'} break events for the broken collection`);
  const materialLines = String(verbose?.log ?? '').split(/\r?\n/).filter((l) => MATERIAL_LINE.test(l));
  note('observation: material usage warning', 'a game with a renderer logs the warning for a material without the Geometry Collections flag (a null-RHI run may not create the scene proxy)',
    materialLines.length ? `${materialLines.length} line(s), first: ${materialLines[0].trim().slice(0, 160)}` : 'none in the verbose run');
  return checks;
}

export function summarize(checks) {
  const counted = checks.filter((c) => !c.info);
  return { passed: counted.filter((c) => c.pass).length, total: counted.length };
}

// Judges the two runs that showcase_validate.mjs makes: the headless build (showcase_build.py, which writes a JSON report) and the
// self-test (showcase_explore.py with NIAGARA_SHOWCASE_SELFTEST=1, which logs its verdict). Pure functions, no Unreal and no
// dependencies; showcase-validate.test.mjs feeds them logs shaped like the ones the scripts write.
//
// showcase_explore.py logs one line per self-test check, "[showcase_explore] selftest ok:   <text>" or "[showcase_explore] selftest FAIL: <text>",
// then one verdict line, "[showcase_explore] selftest PASS" or "[showcase_explore] selftest FAIL <problems>". Twelve checks: four motion
// checks (forward, strafe, turn with the pitch limit, boost) and one per station (eight stations, nearest and running). Each is judged
// on its own here, so a failure names the claim rather than only the verdict.
//
//   build = { exit, timedOut, report, log }      report is the parsed niagara-showcase-build.json (or undefined)
//   play  = { exit, timedOut, log, seconds }     log is the -abslog text of the self-test run

export const STATION_IDS = ['fire2d', 'fire3d', 'explosion', 'hose', 'sand', 'trails', 'burst', 'vortex'];
export const VORTEX_MODULES = ['Update/Forces/VortexForce', 'Update/Forces/CurlNoiseForce', 'Update/Forces/PointAttractionForce'];
export const MOTION_CHECKS = [
  { key: 'forward', name: 'motion: full stick forward', pattern: /^full stick forward moves/, claim: 'full stick forward moves the camera 700 cm per second along the heading' },
  { key: 'strafe', name: 'motion: strafe', pattern: /^strafe right moves/, claim: 'strafe right moves the camera 700 cm per second to the right' },
  { key: 'turn', name: 'motion: turn and pitch limit', pattern: /^right stick turns/, claim: 'the right stick turns 110 degrees per second and the pitch stops at -85' },
  { key: 'boost', name: 'motion: boost', pattern: /^boost multiplies/, claim: 'boost multiplies the speed by 3' },
];
export const EXPECTED_CHECKS = MOTION_CHECKS.length + STATION_IDS.length;

const OK_LINE = /\[showcase_explore\] selftest ok:\s+(.*)$/;
const FAIL_LINE = /\[showcase_explore\] selftest FAIL:\s+(.*)$/;
const PASS_VERDICT = /\[showcase_explore\] selftest PASS\s*$/;
const FAIL_VERDICT = /\[showcase_explore\] selftest FAIL (?!:)(.*)$/;   // "FAIL " then the problems; the per-check line is "FAIL:"
const STATION_LINE = /^station (\d+) \((\w+)\) is the nearest and running; (\d+) running/;
const READY_LINE = /\[showcase_explore\] ready: (\d+) stations, selftest=True/;
const FATAL = [
  /Fatal error/i, /appError called/, /Assertion failed/, /Unhandled Exception/, /EXCEPTION_ACCESS_VIOLATION/, /LogWindows: Error: .*(crash|exception)/i,
  /Critical error/i,
];
const SCRIPT_ERROR = [/LogPython: Error: .*\[showcase_explore\]/, /LogPython: Error: .*\[showcase_build\]/, /Traceback \(most recent call last\)/];
// Epic's own experimental plugins (NiagaraToolsets reads `unreal.AgentSkill`, ToolsetRegistry reads `unreal.PythonTestRunner`, neither of which this build has) log a traceback from their init_unreal.py at start-up in a game run. It is not
// the showcase script's: such a block is set aside and recorded as an observation instead of failing the script-exception check.
const ENGINE_STARTUP_TRACEBACK = /Engine[\/]Plugins[\/].*init_unreal\.py|NiagaraToolsets[\/]Content[\/]Python|has no attribute '(?:AgentSkill|PythonTestRunner)'/;
export function setAsideEngineTracebacks(text) {
  const lines = String(text ?? '').split(/\r?\n/), kept = [], aside = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/Traceback \(most recent call last\)/.test(lines[i])) {
      let end = i + 1;
      while (end < lines.length && /LogPython: Error:/.test(lines[end]) && !/Traceback \(most recent call last\)/.test(lines[end])) end += 1;
      const block = lines.slice(i, end);
      if (block.some((l) => ENGINE_STARTUP_TRACEBACK.test(l))) { aside.push(block.join('\n')); i = end - 1; continue; }
    }
    kept.push(lines[i]);
  }
  return { text: kept.join('\n'), aside };
}
const NIAGARA_PROBLEM = /LogNiagara(?:\w*): (?:Error|Warning)/;

/** Reads the self-test lines out of a log. Lines are split on any line ending; a missing or empty log reads as no lines. */
export function parseSelftest(log = '') {
  const lines = String(log).split(/\r?\n/);
  const ok = [], failed = [];
  let pass = 0, ready;
  const verdictFails = [];
  for (const line of lines) {
    let m;
    if ((m = OK_LINE.exec(line))) ok.push(m[1].trim());
    else if ((m = FAIL_LINE.exec(line))) failed.push(m[1].trim());
    else if (PASS_VERDICT.test(line)) pass++;
    else if ((m = FAIL_VERDICT.exec(line))) verdictFails.push(m[1].trim());
    else if ((m = READY_LINE.exec(line))) ready = Number(m[1]);
  }
  const stations = ok.map((t) => STATION_LINE.exec(t)).filter(Boolean).map((m) => ({ index: Number(m[1]), id: m[2], running: Number(m[3]) }));
  return { ok, failed, pass, verdictFails, ready, stations };
}

const matching = (list, pattern) => list.filter((t) => pattern.test(t));
const stationNumber = (t) => { const m = /^station (\d+) /.exec(t); return m ? Number(m[1]) : undefined; };

export function evaluate({ build, play } = {}) {
  const checks = [];
  const add = (name, claim, pass, detail, observe = false) => checks.push({ name, claim, pass: !!pass, detail: String(detail), ...(observe ? { observe: true } : {}) });
  const report = build?.report;
  const steps = report?.steps ?? [];
  const stepsNamed = (n) => steps.filter((s) => s.step === n);
  const buildLog = build?.log ?? '';
  const playLog = play?.log ?? '';
  const t = parseSelftest(playLog);

  // ---- the headless build ---------------------------------------------------------------------------------
  const stationSteps = stepsNamed('station');
  const buildErrors = steps.filter((s) => s.step === 'error' || s.step === 'vortex_error').map((s) => `${s.step}: ${String(s.traceback ?? '').slice(-160)}`);
  const savedMap = stepsNamed('save_map').some((s) => s.ok === true);
  const buildOk = build?.exit === 0 && !build?.timedOut && !!report && buildErrors.length === 0;
  add('build: the level is built and saved', 'showcase_build.py builds the arena with eight stations whose engine systems all load, and saves /Game/Maps/NiagaraShowcase, with no error step',
    buildOk && stationSteps.length === STATION_IDS.length && stationSteps.every((s, i) => s.id === STATION_IDS[i] && s.loaded === true) && savedMap,
    build?.timedOut ? 'the build timed out'
      : `exit ${build?.exit}; report ${report ? 'read' : 'missing'}; stations ${stationSteps.map((s) => `${s.id}=${s.loaded}`).join(', ') || 'none'}; map saved ${savedMap}${buildErrors.length ? `; ${buildErrors.join(' | ')}` : ''}`);
  const vortex = stepsNamed('vortex')[0];
  const added = vortex?.added ?? [];
  add('build: the authored system gets its three modules', 'NS_ShowcaseVortex is created from RadialBurst through the Niagara toolsets and the vortex, curl-noise and point-attraction modules are added (or the asset already existed and was reused)',
    !!vortex && (vortex.note ? /reused/.test(vortex.note) : vortex.saved === true && VORTEX_MODULES.every((m) => added.includes(m))),
    vortex ? JSON.stringify({ template: vortex.template, saved: vortex.saved, note: vortex.note, added }) : 'no vortex step in the report');

  // ---- the self-test run ----------------------------------------------------------------------------------
  const lastStation = t.stations.reduce((n, s) => Math.max(n, s.index), 0);
  add('self-test: the run finished and found the stations', 'the game process reaches the ready line with eight stations, runs every check and quits before the time limit',
    !play?.timedOut && t.ready === STATION_IDS.length && (t.pass + t.verdictFails.length) >= 1,
    play?.timedOut ? `timed out after ${play.seconds ?? '?'} s; ready line ${t.ready ?? 'missing'}; reached station ${lastStation} of ${STATION_IDS.length}; ${t.ok.length} checks logged`
      : `exit ${play?.exit}${play?.seconds === undefined ? '' : `, ${play.seconds} s`}; ready line ${t.ready ?? 'missing'}; ${t.ok.length} checks logged`);
  add('self-test: PASS line', 'the log carries "[showcase_explore] selftest PASS" once and no "selftest FAIL <problems>" verdict',
    t.pass === 1 && t.verdictFails.length === 0 && !play?.timedOut,
    t.verdictFails.length ? `FAIL verdict: ${t.verdictFails[0]}` : t.pass === 0 ? 'no PASS line' : t.pass > 1 ? `${t.pass} PASS lines` : 'PASS line found');

  for (const m of MOTION_CHECKS) {
    const okLines = matching(t.ok, m.pattern), failLines = matching(t.failed, m.pattern);
    add(m.name, m.claim, okLines.length >= 1 && failLines.length === 0, failLines[0] ?? okLines[0] ?? 'the check was never logged');
  }
  STATION_IDS.forEach((id, i) => {
    const n = i + 1;
    const okLines = t.ok.filter((x) => stationNumber(x) === n), failLines = t.failed.filter((x) => stationNumber(x) === n);
    const s = t.stations.find((x) => x.index === n);
    add(`station ${n} ${id}`, `station ${n} (${id}) is the nearest to the camera and running, with between one and three stations running`,
      okLines.length >= 1 && failLines.length === 0 && s?.id === id && s.running >= 1 && s.running <= 3, failLines[0] ?? okLines[0] ?? 'the station was never reached');
  });
  const unknownOk = t.ok.filter((x) => !MOTION_CHECKS.some((m) => m.pattern.test(x)) && !STATION_LINE.test(x));
  const unique = new Set([...MOTION_CHECKS.filter((m) => matching(t.ok, m.pattern).length).map((m) => m.key), ...t.stations.map((s) => `s${s.index}`)]);
  add('self-test: twelve checks reported', `the log reports exactly ${EXPECTED_CHECKS} checks (four motion, eight stations), all ok and none failed`,
    unique.size === EXPECTED_CHECKS && t.failed.length === 0 && unknownOk.length === 0,
    `${unique.size} distinct ok, ${t.failed.length} failed, ${unknownOk.length} unrecognised${unknownOk.length ? `: ${unknownOk[0]}` : ''}`);

  // ---- the logs ---------------------------------------------------------------------------------------------
  const fatal = [['build', buildLog], ['self-test', playLog]].flatMap(([label, text]) => text.split(/\r?\n/).filter((l) => FATAL.some((p) => p.test(l))).map((l) => `${label}: ${l.trim().slice(0, 140)}`));
  add('no fatal error in the logs', 'neither run logs a fatal error, failed assertion or crash', !!buildLog && !!playLog && fatal.length === 0,
    !buildLog || !playLog ? `log missing (${!buildLog ? 'build' : 'self-test'})` : fatal.length ? fatal.slice(0, 3).join(' | ') : 'build and self-test logs scanned');
  const buildSplit = setAsideEngineTracebacks(buildLog), playSplit = setAsideEngineTracebacks(playLog);
  const scriptErrors = [['build', buildSplit.text], ['self-test', playSplit.text]].flatMap(([label, text]) => text.split(/\r?\n/).filter((l) => SCRIPT_ERROR.some((p) => p.test(l))).map((l) => `${label}: ${l.trim().slice(0, 140)}`));
  const engineTracebacks = buildSplit.aside.length + playSplit.aside.length;
  add('observe: the engine plugin start-up traceback', "recorded, not asserted: tracebacks logged by Epic's engine plugins at start-up (unreal.AgentSkill and unreal.PythonTestRunner missing), set aside from the script-exception check", true,
    engineTracebacks ? `${engineTracebacks} traceback block(s): build ${buildSplit.aside.length}, self-test ${playSplit.aside.length}` : 'none', true);
  add('no script exception', 'neither script logs an error line or a Python traceback', scriptErrors.length === 0, scriptErrors.length ? scriptErrors.slice(0, 3).join(' | ') : 'no script error lines');
  const niagara = playLog.split(/\r?\n/).filter((l) => NIAGARA_PROBLEM.test(l));
  add('observe: Niagara warnings and errors in the self-test log', 'recorded, not asserted: how many Niagara warning or error lines the run logged and the first one', true,
    niagara.length ? `${niagara.length} lines; first: ${niagara[0].trim().slice(0, 140)}` : 'none', true);
  return checks;
}

export function summarize(checks) {
  const asserted = checks.filter((c) => !c.observe);
  const observed = checks.filter((c) => c.observe);
  return { passed: asserted.filter((c) => c.pass).length, total: asserted.length, observed: observed.length, observedRecorded: observed.filter((c) => c.pass).length };
}

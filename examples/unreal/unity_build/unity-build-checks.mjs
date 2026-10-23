// Judges the phases that unity_build.mjs records. Pure functions, no Unreal and no dependencies; the node test feeds them logs shaped
// like the ones Unreal Build Tool wrote on Unreal 5.8.2.
//   A phase is { exit, timedOut, log, unity: { '<unity file name>': '<its text>' }, dllChanged, followOn: { ran, reason? } }.

const FILES = ['ProbeAlpha.cpp', 'ProbeBeta.cpp', 'UnityProbeModule.cpp'];

/** Compiler diagnostics in an Unreal Build Tool log: { file, line, kind, code, text } for each MSVC "error Cnnnn" or "warning Cnnnn". */
export function compilerDiagnostics(log) {
  const out = [];
  for (const m of String(log ?? '').matchAll(/([^\\/\s(]+\.(?:cpp|h))\((\d+)(?:,\d+)?\): (error|warning) (C\d+): ([^\r\n]*)/g)) {
    out.push({ file: m[1], line: Number(m[2]), kind: m[3], code: m[4], text: m[5] });
  }
  return out;
}

/** The source files a unity file includes, in order, by file name ("#include "<path>/ProbeAlpha.cpp"" gives "ProbeAlpha.cpp"). */
export function unityIncludes(text) {
  return [...String(text ?? '').matchAll(/^#include "([^"]+)"/gm)].map((m) => m[1].split(/[\\/]/).pop());
}

/** Names the log lists as compiled on their own: "[4/9] Compile [x64] ProbeAlpha.cpp" gives "ProbeAlpha.cpp". */
export function compiledUnits(log) {
  return [...String(log ?? '').matchAll(/^\[\d+\/\d+\] Compile \[x64\] (\S+)/gm)].map((m) => m[1]);
}

/** The files the log says adaptive unity left out of the unity file ("[Adaptive Build] Excluded from <module> unity file: A.cpp, B.cpp"). */
export function adaptiveExcluded(log) {
  const m = /\[Adaptive Build\] Excluded from \S+ unity file: ([^\r\n]*)/.exec(String(log ?? ''));
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** Which source files share one unity file with which others: an array of name arrays, one per unity file that holds a probe source. */
export function chunks(unity) {
  return Object.values(unity ?? {}).map(unityIncludes).map((names) => names.filter((n) => FILES.includes(n))).filter((names) => names.length > 0);
}

const succeeded = (p) => !!p && p.exit === 0 && !p.timedOut;
const failedWith = (p, codes) => {
  const found = new Set(compilerDiagnostics(p?.log).filter((d) => d.kind === 'error').map((d) => d.code));
  return !!p && p.exit !== 0 && codes.every((c) => found.has(c));
};
const sharedChunk = (p) => chunks(p?.unity).some((names) => names.includes('ProbeAlpha.cpp') && names.includes('ProbeBeta.cpp'));
const codeList = (p) => [...new Set(compilerDiagnostics(p?.log).filter((d) => d.kind === 'error').map((d) => d.code))].join(', ') || 'none';
const CLASH_CODES = ['C2374', 'C2086', 'C4459', 'C2872'];

/** The checks. `phases` is an object keyed by phase name; a missing phase fails the checks that need it. */
export function evaluate(phases) {
  const p = phases ?? {};
  const checks = [];
  const add = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });

  add('small module builds one file at a time',
    'A game module with fewer than 32 source files is not built as unity by default, so the clashing sources compile.',
    succeeded(p.small) && !sharedChunk(p.small) && ['ProbeAlpha.cpp', 'ProbeBeta.cpp'].every((f) => compiledUnits(p.small?.log).includes(f)),
    `exit ${p.small?.exit}; compiled alone: ${compiledUnits(p.small?.log).join(', ') || 'none'}`);

  add('writable files stay out of the unity file',
    'With unity on and adaptive unity on, an installed engine and no git repository treat every writable source file as the working set, so the clashing sources still compile.',
    succeeded(p.adaptive) && FILES.every((f) => adaptiveExcluded(p.adaptive?.log).includes(f)) && !sharedChunk(p.adaptive),
    `exit ${p.adaptive?.exit}; excluded: ${adaptiveExcluded(p.adaptive?.log).join(', ') || 'none'}`);

  add('merged chunk reproduces the four errors',
    'With unity on and the working set empty, the sources share one unity file and the build fails with C2374, C2086, C4459 and C2872 in ProbeBeta.cpp.',
    failedWith(p.clash, CLASH_CODES) && sharedChunk(p.clash) && compilerDiagnostics(p.clash?.log).filter((d) => CLASH_CODES.includes(d.code)).every((d) => d.file === 'ProbeBeta.cpp'),
    `exit ${p.clash?.exit}; error codes: ${codeList(p.clash)}; chunks: ${JSON.stringify(chunks(p.clash?.unity))}`);

  add('failed build leaves the old binary and the guarded step is skipped',
    'After the failed build the previous module binary is untouched, and the follow-on step runs only after a successful build.',
    !!p.clash && p.clash.exit !== 0 && p.clash.dllChanged === false && p.clash.followOn?.ran === false && /build failed/.test(p.clash.followOn?.reason ?? '') &&
      ['small', 'adaptive', 'off', 'fixed', 'chunks'].every((k) => !p[k] || (succeeded(p[k]) === (p[k].followOn?.ran === true))),
    `binary changed: ${p.clash?.dllChanged}; follow-on ran: ${p.clash?.followOn?.ran} (${p.clash?.followOn?.reason ?? 'no reason'})`);

  add('unity off builds the same sources',
    'With bUseUnity = false in the module rules the clashing files build one at a time and the build passes.',
    succeeded(p.off) && chunks(p.off?.unity).length === 0,
    `exit ${p.off?.exit}; probe sources in a unity file: ${JSON.stringify(chunks(p.off?.unity))}`);

  add('prefixed and qualified names pass in the merged chunk',
    'The fixed sources (file-prefixed constants, no using-directives, qualified enums) pass with all files in one unity file.',
    succeeded(p.fixed) && sharedChunk(p.fixed) && compilerDiagnostics(p.fixed?.log).filter((d) => d.kind === 'error').length === 0,
    `exit ${p.fixed?.exit}; chunks: ${JSON.stringify(chunks(p.fixed?.unity))}`);

  add('smaller chunks regroup the files',
    'With NumIncludedBytesPerUnityCPPOverride below every file size each file gets its own unity file, and the clashing sources pass.',
    succeeded(p.chunks) && !sharedChunk(p.chunks) && chunks(p.chunks?.unity).length >= 3,
    `exit ${p.chunks?.exit}; chunks: ${JSON.stringify(chunks(p.chunks?.unity))}`);

  add('clean git tree builds the merged chunk',
    'With the sources committed (a clean git working set) the sources share a unity file and the build fails with the same four codes.',
    failedWith(p.gitClean, CLASH_CODES) && sharedChunk(p.gitClean),
    `exit ${p.gitClean?.exit}; error codes: ${codeList(p.gitClean)}`);

  add('a modified file leaves the chunk and the build passes',
    'After ProbeBeta.cpp is edited (git status lists it) it is excluded from the unity file, the makefile is rebuilt, and the same sources pass.',
    succeeded(p.gitDirty) && adaptiveExcluded(p.gitDirty?.log).join() === 'ProbeBeta.cpp' && /working set of source files changed/.test(p.gitDirty?.log ?? '') && !sharedChunk(p.gitDirty),
    `exit ${p.gitDirty?.exit}; excluded: ${adaptiveExcluded(p.gitDirty?.log).join(', ') || 'none'}`);

  add('committing alone does not regroup',
    'After the edit is committed, a build with no file written since reports the target up to date; the pass above still stands and proves nothing about the committed grouping.',
    succeeded(p.gitCommitted) && /Target is up to date/.test(p.gitCommitted?.log ?? ''),
    `exit ${p.gitCommitted?.exit}; up to date: ${/Target is up to date/.test(p.gitCommitted?.log ?? '')}`);

  add('a rewritten committed file regroups and fails again',
    'Once the committed file is written again (a checkout, a rebase), its timestamp is newer than the makefile, the makefile is rebuilt with the file back in the unity file, and the clash returns.',
    failedWith(p.gitRewritten, CLASH_CODES) && sharedChunk(p.gitRewritten),
    `exit ${p.gitRewritten?.exit}; error codes: ${codeList(p.gitRewritten)}`);

  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}

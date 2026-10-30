// Judges what ds_probe.mjs collects. Pure functions: no Unreal, no dependencies.
//
//   target    the Server-target build:  { exit, timedOut, log }                    (group `target`, question 1)
//   packaged  the packaged-game run:    { build, package, serverExit, serverLog, clientLog, port, variant, ... } (group `packaged`, question 2)
//
// Nothing is judged by eye. The server is judged by its log (the engine's own "listening on port" line), the client by its
// log ("Welcomed by server") and the replicated value by the number the probe's Actor writes on the client.

export const PROBE_VALUE = 4242;
export const DEFAULT_PORT = 7777;
export const DEFAULT_MAP = '/Engine/Maps/Entry';
export const GAME_MODE = '/Script/DsProbe.DsProbeGameMode';

/** The Server target file: a copy of the Game target with `Type = TargetType.Server`, which is what Epic's page asks for. */
export function serverTargetSource({ name, modules }) {
  const extra = modules.map((m) => `"${m}"`).join(', ');
  return `using UnrealBuildTool;
using System.Collections.Generic;

public class ${name}ServerTarget : TargetRules
{
	public ${name}ServerTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Server;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.AddRange(new string[] { ${extra} });
	}
}
`;
}

const lines = (text) => String(text ?? '').split(/\r?\n/);
const stripStamp = (line) => line.replace(/^\[[^\]]*\]\[[^\]]*\]/, '').trim();

/**
 * The words Unreal Build Tool said about the build, from its log: every line that reports an error, plus the closing result lines.
 * Returns { errors, results, text } where `text` is those lines joined, word for word (log time stamps removed).
 */
export function captureBuildMessage(log) {
  const errors = [];
  const results = [];
  let previous = '';
  for (const raw of lines(log)) {
    const line = stripStamp(raw);
    if (!line) continue;
    if (/(^|[\s:(])(ERROR|error)\b/.test(line) || /\bBuildException\b/.test(line) || /\bnot (currently )?supported\b/i.test(line)) errors.push(line);
    else if (/^(Result:|BUILD (SUCCESSFUL|FAILED)|Total execution time|AutomationTool exiting with ExitCode)/.test(line)) {
      // The build tool prints a build exception bare, on the line before "Result: Failed (...)".
      if (/^Result: Failed/.test(line) && previous && !errors.includes(previous)) errors.push(previous);
      results.push(line);
    }
    previous = line;
  }
  return { errors, results, text: [...errors, ...results].join('\n') };
}

/**
 * Classifies a Server-target build. The refusal Unreal Build Tool gives an installed engine is "<Type> targets are not currently supported
 * from this engine distribution." (Configuration/UEBuildTarget.cs).
 *   builds        exit 0, no timeout: the source-build rule did not hold for this install
 *   refused       non-zero exit and the build tool refused the Server target type for this engine distribution
 *   other-failure non-zero exit for another reason (a compile or link error in the probe, a missing tool); the question stays open
 *   timed-out     killed at the timeout
 */
export function classifyServerBuild({ exit, timedOut, log }) {
  const message = captureBuildMessage(log);
  if (timedOut) return { verdict: 'timed-out', exit, message };
  if (exit === 0) return { verdict: 'builds', exit, message };
  const refusal = message.errors.find((l) => /Server targets? (are|is) not (currently )?supported from this engine distribution/i.test(l));
  if (refusal) return { verdict: 'refused', exit, message, refusal };
  return { verdict: 'other-failure', exit, message };
}

/** The packaged game's arguments as a server. `variant` 'server' is the brief's `-server`; 'listen' makes a listen server with `?listen` instead. */
export function serverArguments({ port = DEFAULT_PORT, log, variant = 'server', map = DEFAULT_MAP }) {
  const url = `${map}?game=${GAME_MODE}${variant === 'listen' ? '?listen' : ''}`;
  return [url, ...(variant === 'server' ? ['-server'] : []), '-log', '-nullrhi', `-port=${port}`, `-abslog=${log}`, '-unattended', '-nosplash', '-nosound', '-notraceserver', '-NoGamepad'];
}

/** The packaged game's arguments as the client: the address is the first argument. */
export function clientArguments({ port = DEFAULT_PORT, log }) {
  return [`127.0.0.1:${port}`, '-log', '-nullrhi', `-abslog=${log}`, '-unattended', '-nosplash', '-nosound', '-notraceserver', '-NoGamepad'];
}

/** What the server's log says: listening (the engine's line), the port, the net mode and the value the Actor set. */
export function parseServerLog(log) {
  const text = String(log ?? '');
  const listen = /IpNetDriver listening on port (\d+)/.exec(text);
  const mode = /DsProbe: game mode started, net mode (\w+), IsRunningDedicatedServer (\d)/.exec(text);
  const set = /DsProbe: server set Value=(-?\d+)/.exec(text);
  return {
    listening: !!listen,
    port: listen ? Number(listen[1]) : undefined,
    netMode: mode?.[1],
    runningDedicatedServer: mode ? mode[2] === '1' : undefined,
    setValue: set ? Number(set[1]) : undefined,
    joins: lines(text).filter((l) => /LogNet: Join succeeded/.test(l)).map(stripStamp),
    listenLine: listen ? stripStamp(lines(text).find((l) => /IpNetDriver listening on port/.test(l))) : undefined,
  };
}

/** What the client's log says: welcomed by the server, and every replicated value the Actor reported. */
export function parseClientLog(log) {
  const text = String(log ?? '');
  const welcome = lines(text).find((l) => /LogNet: Welcomed by server/.test(l));
  const received = [...text.matchAll(/DsProbe: client received Value=(-?\d+)/g)].map((m) => Number(m[1]));
  const began = [...text.matchAll(/DsProbe: client actor began with Value=(-?\d+)/g)].map((m) => Number(m[1]));
  const failure = lines(text).filter((l) => /(Connection failed|Pending connection failure|Connection timed out|ConnectionLost|NetworkFailure|Failed to resolve)/i.test(l)).map(stripStamp);
  return { welcomed: !!welcome, welcomeLine: welcome ? stripStamp(welcome) : undefined, received, began, failure };
}

/** Evidence the server accepted the client, from the server's side. */
export const serverSawJoin = (serverLog) => /LogNet: Join succeeded/.test(String(serverLog ?? ''));

/** The checks of both groups. `observe` checks are recorded and never counted as pass or fail. */
export function evaluate({ target, packaged, groups = ['target', 'packaged'] }) {
  const out = [];
  const add = (group, name, claim, pass, detail, observe = false) => out.push({ group, name, claim, pass: !!pass, detail, observe });

  if (groups.includes('target')) {
    const c = target ? classifyServerBuild(target) : undefined;
    add('target', 'Q1 Server target build gave a definite answer', 'Build.bat <Project>Server Win64 Development either built or was refused by the build tool for this engine distribution',
      c && (c.verdict === 'builds' || c.verdict === 'refused'),
      c ? `${c.verdict}, exit ${c.exit}${c.refusal ? `; refusal: ${c.refusal}` : ''}${c.verdict === 'other-failure' ? `; errors: ${c.message.errors.slice(0, 3).join(' | ')}` : ''}` : 'the Server target build did not run');
    if (c) add('target', 'Q1 message recorded', 'the build tool printed at least one error or result line to quote word for word', c.message.text.length > 0, c.message.text.split('\n').slice(0, 6).join(' | ') || 'no error or result line in the log');
  }

  if (groups.includes('packaged')) {
    const p = packaged;
    const server = parseServerLog(p?.serverLog);
    const client = parseClientLog(p?.clientLog);
    add('packaged', 'Q2 packaged Game built and staged', 'the editor build and RunUAT BuildCookRun exited 0 and the packaged executable exists',
      p && p.build?.exit === 0 && p.package?.exit === 0 && !!p.exe, p ? `editor build exit ${p.build?.exit}, package exit ${p.package?.exit}, executable ${p.exe ?? 'not found'}` : 'the packaged group did not run');
    add('packaged', 'Q2 server reports listening', `the server log holds the engine's "IpNetDriver listening on port ${p?.port ?? DEFAULT_PORT}" line`,
      server.listening && server.port === (p?.port ?? DEFAULT_PORT), server.listening ? `${server.listenLine}` : `no listening line (variant ${p?.variant ?? '?'}, server exit ${p?.serverExit ?? 'none'})`);
    add('packaged', 'Q2 client reports a connection', 'the client log holds "Welcomed by server" and the server log holds "Join succeeded"',
      client.welcomed && serverSawJoin(p?.serverLog), client.welcomed ? `${client.welcomeLine}; server join lines: ${server.joins.length}` : `no welcome line${client.failure.length ? `; ${client.failure[0]}` : ''}`);
    add('packaged', 'Q2 replicated value reaches the client log', `the server set Value=${PROBE_VALUE} and the client log shows Value=${PROBE_VALUE}`,
      server.setValue === PROBE_VALUE && client.received.includes(PROBE_VALUE), `server set ${server.setValue ?? 'nothing'}; client received [${client.received.join(', ')}], began with [${client.began.join(', ')}]`);
    add('packaged', 'Q2 server net mode', 'the server process reports its net mode (a dedicated server reports DedicatedServer)', server.netMode === 'DedicatedServer',
      server.netMode ? `net mode ${server.netMode}, IsRunningDedicatedServer ${server.runningDedicatedServer ? 1 : 0}` : 'no net mode line in the server log', true);
  }
  return out;
}

export function summarize(checks) {
  const asserted = checks.filter((c) => !c.observe);
  return { passed: asserted.filter((c) => c.pass).length, total: asserted.length, observed: checks.length - asserted.length };
}

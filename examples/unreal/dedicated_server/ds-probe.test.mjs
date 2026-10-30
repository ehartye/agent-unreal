// node --test examples/unreal/dedicated_server/ds-probe.test.mjs  (no Unreal, no dependencies)
// The server and client lines below are copied from the logs of the listen run (the engine's "listening on port", "Join succeeded" and "Welcomed by
// server" lines and the probe module's own lines); the Server-target refusal is the build tool's log from question 1.
// Each test changes one fact and expects the matching check to change. The editor-group and `-server -game` cases use the same line shapes with
// the facts the checks judge (listening line, net mode line, welcome line, replicated value) changed one at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serverTargetSource, captureBuildMessage, classifyServerBuild, serverArguments, clientArguments, editorExecutable, editorServerArguments, hardLimitSeconds, describeEnd,
  parseServerLog, parseClientLog, evaluate, summarize, PROBE_VALUE, DEFAULT_PORT, VARIANTS,
} from './ds-probe-checks.mjs';

// The build tool's log of the refused Server-target build on an installed engine (the lines that matter).
const REFUSED_LOG = [
  'Using bundled DotNet SDK version: 10.0 win-x64',
  'Running UnrealBuildTool: dotnet "..\\..\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.dll" DsProbeServer Win64 Development -WaitMutex -NoHotReloadFromIDE -2022',
  'Creating makefile for DsProbeServer (no existing makefile)',
  'UbaServer - Listening on 0.0.0.0:1345',
  'Server targets are not currently supported from this engine distribution.',
  '',
  'Result: Failed (OtherCompilationError)',
  'Total execution time: 2.36 seconds',
].join('\r\n');


test('the Server target file is a copy of the Game target with Type = Server', () => {
  const source = serverTargetSource({ name: 'DsProbe', modules: ['DsProbe'] });
  assert.match(source, /public class DsProbeServerTarget : TargetRules/);
  assert.match(source, /Type = TargetType\.Server;/);
  assert.match(source, /ExtraModuleNames\.AddRange\(new string\[\] \{ "DsProbe" \}\);/);
  assert.doesNotMatch(source, /TargetType\.Game/);
});

test('the build message is captured word for word: error lines and result lines, time stamps removed', () => {
  const stamped = REFUSED_LOG.split('\r\n').map((l) => `[2026.10.30-10.00.00:000][  0]${l}`).join('\r\n');
  for (const log of [REFUSED_LOG, stamped]) {
    const message = captureBuildMessage(log);
    assert.deepEqual(message.errors, ['Server targets are not currently supported from this engine distribution.']);
    assert.deepEqual(message.results, ['Result: Failed (OtherCompilationError)', 'Total execution time: 2.36 seconds']);
    assert.equal(message.text, 'Server targets are not currently supported from this engine distribution.\nResult: Failed (OtherCompilationError)\nTotal execution time: 2.36 seconds');
  }
  assert.deepEqual(captureBuildMessage('').errors, []);
  assert.deepEqual(captureBuildMessage(undefined).results, []);
});

test('a compile error is captured as an error line', () => {
  const message = captureBuildMessage('C:\\p\\Source\\DsProbe\\A.cpp(10): error C2065: \'x\': undeclared identifier');
  assert.equal(message.errors.length, 1);
});

test('Server-target classification: refused, builds, another failure, timed out', () => {
  const refused = classifyServerBuild({ exit: 6, timedOut: false, log: REFUSED_LOG });
  assert.equal(refused.verdict, 'refused');
  assert.match(refused.refusal, /not currently supported from this engine distribution/);
  assert.equal(classifyServerBuild({ exit: 0, timedOut: false, log: 'Total execution time: 40 seconds' }).verdict, 'builds');
  assert.equal(classifyServerBuild({ exit: 6, timedOut: false, log: "A.cpp(1): error C2065: 'x': undeclared identifier" }).verdict, 'other-failure');
  assert.equal(classifyServerBuild({ exit: null, timedOut: true, log: REFUSED_LOG }).verdict, 'timed-out');
  assert.equal(classifyServerBuild({ exit: 0, timedOut: true, log: '' }).verdict, 'timed-out');
});

test('server and client arguments: -server -log -nullrhi -port, and the address first for the client', () => {
  const server = serverArguments({ port: 7777, log: 'C:/t/server.log' });
  assert.ok(server[0].startsWith('/Engine/Maps/Entry?game=/Script/DsProbe.DsProbeGameMode'));
  for (const a of ['-server', '-log', '-nullrhi', '-port=7777', '-abslog=C:/t/server.log']) assert.ok(server.includes(a), a);
  assert.ok(!server[0].includes('?listen'));
  const listen = serverArguments({ port: 7778, log: 'x.log', variant: 'listen' });
  assert.ok(listen[0].endsWith('?listen'));
  assert.ok(!listen.includes('-server'));
  assert.equal(clientArguments({ port: 7777, log: 'c.log' })[0], '127.0.0.1:7777');
  assert.ok(clientArguments({ log: 'c.log' }).includes('-nullrhi'));
});

const SERVER_LOG = [
  '[2026.10.30-05.31.05:433][  0]LogNet: Name:GameNetDriver Def:GameNetDriver IpNetDriver_2147482414 IpNetDriver listening on port 7777',
  '[2026.10.30-10.00.01:200][  0]LogDsProbe: DsProbe: game mode started, net mode DedicatedServer, IsRunningDedicatedServer 1',
  '[2026.10.30-10.00.01:210][  0]LogDsProbe: DsProbe: server set Value=4242',
  '[2026.10.30-05.31.07:464][407]LogNet: Join request: /Engine/Maps/Entry?Name=PLAYER-1?SplitscreenCount=1',
  '[2026.10.30-05.31.07:465][407]LogNet: Join succeeded: PLAYER-1',
].join('\n');
const CLIENT_LOG = [
  '[2026.10.30-10.00.04:900][  0]LogNet: Welcomed by server (Level: /Engine/Maps/Entry, Game: /Script/DsProbe.DsProbeGameMode)',
  '[2026.10.30-10.00.05:300][ 12]LogDsProbe: DsProbe: client received Value=4242',
  '[2026.10.30-10.00.05:301][ 12]LogDsProbe: DsProbe: client actor began with Value=4242',
].join('\n');

test('the server log: listening line, port, net mode, the value set', () => {
  const s = parseServerLog(SERVER_LOG);
  assert.equal(s.listening, true);
  assert.equal(s.port, 7777);
  assert.equal(s.netMode, 'DedicatedServer');
  assert.equal(s.runningDedicatedServer, true);
  assert.equal(s.setValue, PROBE_VALUE);
  assert.equal(s.joins.length, 1);
  assert.match(s.listenLine, /^LogNet: Name:GameNetDriver Def:GameNetDriver IpNetDriver_2147482414 IpNetDriver listening on port 7777$/);
  const none = parseServerLog('LogNet: nothing here');
  assert.equal(none.listening, false);
  assert.equal(none.netMode, undefined);
  assert.equal(parseServerLog(undefined).listening, false);
});

test('the client log: welcomed, values received, a failure line', () => {
  const c = parseClientLog(CLIENT_LOG);
  assert.equal(c.welcomed, true);
  assert.deepEqual(c.received, [4242]);
  assert.deepEqual(c.began, [4242]);
  const failed = parseClientLog('LogNet: Warning: Connection failed; Connection timed out\nLogNet: NetworkFailure: ConnectionLost');
  assert.equal(failed.welcomed, false);
  assert.equal(failed.failure.length, 2);
});

const packaged = (over = {}) => ({ build: { exit: 0 }, package: { exit: 0 }, exe: 'C:/a/DsProbe.exe', port: 7777, variant: 'server', serverLog: SERVER_LOG, clientLog: CLIENT_LOG, ...over });
const byName = (checks, part) => checks.find((c) => c.name.includes(part));

test('packaged group: every check passes on a complete run', () => {
  const checks = evaluate({ packaged: packaged(), groups: ['packaged'] });
  assert.deepEqual(summarize(checks), { passed: 4, total: 4, observed: 1 });
  assert.equal(byName(checks, 'net mode').pass, true);
});

test('packaged group: each missing fact fails exactly its check', () => {
  const fail = (over, part) => {
    const checks = evaluate({ packaged: packaged(over), groups: ['packaged'] });
    assert.equal(byName(checks, part).pass, false, part);
    return checks;
  };
  fail({ serverLog: SERVER_LOG.replace('listening on port', 'listening at') }, 'server reports listening');
  fail({ port: 7778 }, 'server reports listening');
  fail({ clientLog: CLIENT_LOG.replace('Welcomed by server', 'Welcome') }, 'client reports a connection');
  fail({ serverLog: SERVER_LOG.replace('Join succeeded', 'Join ok') }, 'client reports a connection');
  fail({ clientLog: CLIENT_LOG.replace(/Value=4242/g, 'Value=0') }, 'replicated value');
  fail({ serverLog: SERVER_LOG.replace('server set Value=4242', 'server set Value=7') }, 'replicated value');
  fail({ package: { exit: 1 } }, 'built and staged');
  fail({ exe: undefined }, 'built and staged');
});

test('a server that is not a dedicated server is recorded, not failed: the net mode check is an observation', () => {
  const standalone = SERVER_LOG.replace('net mode DedicatedServer, IsRunningDedicatedServer 1', 'net mode ListenServer, IsRunningDedicatedServer 0');
  const checks = evaluate({ packaged: packaged({ serverLog: standalone, variant: 'listen' }), groups: ['packaged'] });
  const mode = byName(checks, 'net mode');
  assert.equal(mode.observe, true);
  assert.equal(mode.pass, false);
  assert.match(mode.detail, /ListenServer/);
  assert.deepEqual(summarize(checks), { passed: 4, total: 4, observed: 1 });
});

test('target group: a refusal and a build are both definite answers; another failure is not', () => {
  const answer = (target) => evaluate({ target, groups: ['target'] })[0];
  assert.equal(answer({ exit: 6, timedOut: false, log: REFUSED_LOG }).pass, true);
  assert.equal(answer({ exit: 0, timedOut: false, log: 'Total execution time: 40 seconds' }).pass, true);
  assert.equal(answer({ exit: 6, timedOut: false, log: "A.cpp(1): error C2065: 'x': undeclared identifier" }).pass, false);
  assert.equal(answer(undefined).pass, false);
  const checks = evaluate({ target: { exit: 6, timedOut: false, log: REFUSED_LOG }, groups: ['target'] });
  assert.match(byName(checks, 'message recorded').detail, /not currently supported from this engine distribution/);
});

test('the default port is the engine default', () => {
  assert.equal(DEFAULT_PORT, 7777);
});

test('the packaged -server -game variant adds -game after -server and keeps the rest of the command line', () => {
  const plain = serverArguments({ port: 7777, log: 'x.log', variant: 'server' });
  const both = serverArguments({ port: 7777, log: 'x.log', variant: 'server-game' });
  assert.deepEqual(both.filter((a) => !plain.includes(a)), ['-game']);
  assert.equal(both.indexOf('-game'), both.indexOf('-server') + 1);
  assert.ok(!both[0].includes('?listen'));
  assert.ok(VARIANTS.includes('server-game'));
});

test('the editor-binary server: the project file first, the same map URL, -server -game -log -nullrhi -port, its own log', () => {
  const args = editorServerArguments({ uproject: 'C:/t/DsProbe.uproject', port: 7777, log: 'C:/t/server.log' });
  assert.equal(args[0], 'C:/t/DsProbe.uproject');
  assert.equal(args[1], serverArguments({ log: 'x' })[0]);
  for (const a of ['-server', '-game', '-log', '-nullrhi', '-port=7777', '-abslog=C:/t/server.log', '-unattended', '-nosplash', '-nosound', '-notraceserver', '-NoGamepad']) assert.ok(args.includes(a), a);
  assert.ok(!args.includes('-RenderOffScreen'));
  assert.equal(editorExecutable('C:/Program Files/Epic Games/UE_5.8/'), 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe');
  assert.equal(editorExecutable('C:\\UE\\'), 'C:\\UE/Engine/Binaries/Win64/UnrealEditor.exe');
});

test('every process has a hard limit longer than the wait it serves, and an end is described for the report', () => {
  const limit = hardLimitSeconds(90);
  assert.ok(limit.server > 2 * 90 && limit.client > 90);
  assert.equal(describeEnd({ done: false }), 'still running when the probe stopped it');
  assert.equal(describeEnd({ done: true, exit: 3 }), 'exited with code 3');
  assert.equal(describeEnd({ done: true }), 'exited (no exit code)');
  assert.match(describeEnd({ done: true, error: 'spawn ENOENT' }), /did not start \(spawn ENOENT\)/);
  assert.match(describeEnd({ done: true, exit: 1, limited: true }), /hard time limit/);
});

const editorRun = (over = {}) => ({ build: { exit: 0 }, package: { exit: 0 }, exe: 'C:/a/DsProbe.exe', port: 7777, serverEnded: 'still running when the probe stopped it', clientEnded: 'exited with code 0', serverLog: SERVER_LOG, clientLog: CLIENT_LOG, ...over });

test('editor group: every asserted check passes on a complete run, and the net mode is recorded as well', () => {
  const checks = evaluate({ editor: editorRun(), groups: ['editor'] });
  assert.deepEqual(summarize(checks), { passed: 5, total: 5, observed: 1 });
  const seen = byName(checks, 'net mode (observed)');
  assert.equal(seen.observe, true);
  assert.match(seen.detail, /net mode DedicatedServer, IsRunningDedicatedServer 1; listening yes; server still running/);
});

test('editor group: each missing fact fails exactly its check', () => {
  const fail = (over, part) => {
    const checks = evaluate({ editor: editorRun(over), groups: ['editor'] });
    assert.equal(byName(checks, part).pass, false, part);
    assert.equal(checks.filter((c) => !c.observe && !c.pass).length >= 1, true);
    return checks;
  };
  fail({ serverLog: SERVER_LOG.replace('listening on port', 'listening at') }, 'server reports listening');
  fail({ serverLog: SERVER_LOG.replace('net mode DedicatedServer, IsRunningDedicatedServer 1', 'net mode Standalone, IsRunningDedicatedServer 0') }, 'is a dedicated server');
  fail({ serverLog: SERVER_LOG.replace('net mode DedicatedServer, IsRunningDedicatedServer 1', 'net mode DedicatedServer, IsRunningDedicatedServer 0') }, 'is a dedicated server');
  fail({ clientLog: CLIENT_LOG.replace('Welcomed by server', 'Welcome') }, 'client reports a connection');
  fail({ clientLog: CLIENT_LOG.replace(/Value=4242/g, 'Value=0') }, 'replicated value');
  fail({ exe: undefined }, 'packaged client staged');
  fail({ build: { exit: 1 } }, 'packaged client staged');
});

test('editor group: a server that never listened is recorded with the net mode it logged and how it ended', () => {
  const standalone = SERVER_LOG.replace('IpNetDriver listening on port 7777', 'nothing').replace('net mode DedicatedServer, IsRunningDedicatedServer 1', 'net mode Standalone, IsRunningDedicatedServer 0');
  const checks = evaluate({ editor: editorRun({ serverLog: standalone, clientLog: '', serverEnded: 'exited with code 1' }), groups: ['editor'] });
  assert.match(byName(checks, 'reports listening').detail, /no listening line \(server exited with code 1\)/);
  const seen = byName(checks, 'net mode (observed)');
  assert.match(seen.detail, /net mode Standalone, IsRunningDedicatedServer 0; listening no; server exited with code 1/);
  assert.equal(summarize(checks).passed, 1);
  assert.match(evaluate({ editor: undefined, groups: ['editor'] })[0].detail, /did not run/);
});

test('packaged -server -game run is labelled Q3, records the net mode and fails the listening check when it does not listen', () => {
  const standalone = SERVER_LOG.replace('IpNetDriver listening on port 7777', 'nothing').replace('net mode DedicatedServer, IsRunningDedicatedServer 1', 'net mode Standalone, IsRunningDedicatedServer 0');
  const checks = evaluate({ packaged: packaged({ variant: 'server-game', serverLog: standalone, clientLog: '', serverEnded: 'still running when the probe stopped it' }), groups: ['packaged'] });
  assert.ok(checks.every((c) => c.name.startsWith('Q3 ')));
  assert.match(byName(checks, 'net mode').detail, /net mode Standalone, IsRunningDedicatedServer 0/);
  assert.match(byName(checks, 'reports listening').detail, /variant server-game; server still running/);
  assert.equal(byName(checks, 'reports listening').pass, false);
});

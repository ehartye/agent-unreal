import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Detection is advisory coordination, not executable authentication. An arbitrary
// renamed game cannot be identified reliably from a process snapshot.
export function engineProcessReason(process) {
  if (!process || typeof process.name !== 'string' || !process.name || (process.commandLine != null && typeof process.commandLine !== 'string')) throw Error('Malformed process observation');
  const { name, commandLine } = process;
  // Epic distributes these exact EOS overlay images separately from the game.
  // Do not exempt a prefix or all Epic tools: a near-name game still contends.
  if (/^EOSOverlayRenderer-Win(?:32|64)-Shipping\.exe$/i.test(name)) return null;
  if (/^Unreal(?:Editor|Editor-Cmd|Game).*\.exe$/i.test(name)) return 'editor-or-game';
  if (/^UnrealBuildTool\.exe$/i.test(name)) return 'build-tool';
  if (/^dotnet\.exe$/i.test(name) && /(?:UnrealBuildTool|AutomationTool)\.dll/i.test(commandLine ?? '')) return 'engine-dotnet-tool';
  if (/-Win64-(?:Development|Shipping|Test)\.exe$/i.test(name)) return 'packaged-game';
  return null;
}

export function engineContenders(processes) {
  if (!Array.isArray(processes)) throw Error('Process observations must be an array');
  return processes.flatMap(process => {
    const reason = engineProcessReason(process);
    if (!reason) return [];
    if (!Number.isSafeInteger(process.pid) || process.pid < 1 || (process.created != null && !/^\d{15,20}$/.test(process.created))) throw Error('Malformed contender identity');
    return [{ pid: process.pid, created: process.created ?? null, name: process.name, reason }];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(engineContenders(JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''))))); }
  catch (error) { console.error(`Contention classification refused: ${error.message}`); process.exitCode = 74; }
}

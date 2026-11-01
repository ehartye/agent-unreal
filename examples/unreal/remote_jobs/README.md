# Remote fixtures

Read the [Remote guide](../../../skills/unreal-verify/references/unreal-remote-jobs.md)
for ownership, bounds, retry reconciliation and verified versus qualified Fetch.
All commands run from the plugin root. The native examples need an explicitly
configured Windows engine host and existing SSH authentication.

## Prepare a disposable source fixture

The setup below writes and commits source only; it launches no engine. Choose a
fresh local project directory and edit the engine/compiler/SDK values to match
the remote host. The engine string in setup is also used in the ignored remote
configuration. Run this PowerShell block from the plugin root.

```powershell
@'
import { setup } from './examples/unreal/agent_verify/setup.mjs';
import { fixture } from './examples/unreal/remote_jobs/fixture.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const project = 'D:/Temp/RemoteSample', engine = 'D:/Engines/UE_5.8';
const compiler = '<installed-compiler-family>', sdk = '<installed-sdk>';
setup({ project, engine, compiler, sdk });
const definition = fixture({ compiler, sdk });
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
save(join(project, 'remote-manifest.json'), definition.manifest);
for (const [name, document] of Object.entries(definition.inputs)) save(join(project, name), document);
for (const args of [['add', '--', 'remote-manifest.json', 'wait.json'], ['-c', 'user.name=Remote fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Declare remote suites']])
  execFileSync('git', ['-C', project, ...args], { stdio: 'inherit', windowsHide: true });
const config = JSON.parse(readFileSync('examples/unreal/remote_jobs/config.example.json', 'utf8'));
config.source_root = project; config.remote.launcher.engine = engine;
config.remote.root = 'C:/RJ/sample';
mkdirSync(join(project, 'Saved/RemoteJobs'), { recursive: true });
save(join(project, 'Saved/RemoteJobs/remote.local.json'), config);
'@ | node --input-type=module
```

Edit only the ignored `Saved/RemoteJobs/remote.local.json` before Start: set the
SSH target, remote Node/engine paths, a fresh short owned root and explicit bounds.
The fixture uses `ObservationSample.uproject` and its Editor/Game targets. Its
`small` suite builds and checks one Automation rule; `cancel` builds then runs a
bounded 60-second wait. All manifest inputs are committed. This source fixture
has no LFS; use the separate integration check below to exercise hydration.

The [four-action examples](../../../skills/unreal-verify/references/unreal-remote-jobs.md#four-typed-actions)
use this fixture's exact HEAD, manifest and suites. Inspect rather than blindly
retry a failed or uncertain Start. Fetch needs a nonexistent ignored output folder.

## Separate native acceptance

After confirming ownership, source/toolchain identities, short-path budget and
host exclusivity, the explicit driver exercises completion, normal launching SSH
closure, cancellation after the wait permit, and both Fetch verdicts:

```powershell
node examples/unreal/remote_jobs/acceptance.mjs --config D:/Temp/RemoteSample/Saved/RemoteJobs/remote.local.json --evidence D:/Evidence/remote-001
```

The evidence directory must be absent. `acceptance.json` and its inventory retain
commands, states, request bindings and verdicts; failures remain in place. This
driver uses per-call/wait bounds, not a single overall main/safety supervisor.
Use an external owned supervisor when an acceptance contract requires one total
deadline including preparation, transfer and qualified Fetch. The caller must
also reconcile owned remote work after client failure; killing local SSH is not
remote drain proof.

For a separately authorized cancellation-only check, `--phase cancellation`
emits `unreal-remote/cancellation-acceptance` and does not claim a new full R4 run.
Neither example is an instruction to repeat an already accepted native run.

## Real Git LFS materialization

The dependency-free merge lane is `node --test scripts/unreal-remote.test.mjs`.
Its LFS boundary fixtures use real temporary Git repositories and a deterministic
Node clean filter, without requiring Git LFS or an engine.

Run the separate actual Git LFS integration check from the plugin root:

```text
node examples/unreal/remote_jobs/lfs_materialization.mjs --output <fresh-temp-directory>
```

Use a nonexistent output directory and an existing Git/Git LFS installation. This
driver needs no network or engine. It creates disposable repositories, configures
filters only in those fixtures, and invokes full materialization with linked
worktrees, skip-smudge checkout, three literal paths and one shared LFS object.
It retains the fixtures, raw command/process output, Git/LFS versions, accepted
source identity, observed status, commit/index/HEAD trees and hydrated hashes.

`summary.json` lists every required case and its evidence. Exit zero requires clean
exact identity and all declared negative refusals: corrupt transferred bytes,
ineffective clean filters and content changed during filtering. A crash, timeout,
missing prerequisite or different refusal fails; nothing is a passing skip. An
isolated old candidate omitting only normalization records whether the historical
dirty-state refusal reproduces on this host; reproduction is not universal.

Materialization normalizes only accepted LFS paths in its new owned worktree,
using literal NUL-delimited pathspecs. It requires the full index tree to match
before and after, rechecks regular hydrated files and their hashes, and retains
the existing dirty-state, commit, snapshot and input guards. Failed fixtures and
historical job worktrees are preserved. Git LFS stays outside the merge CI lane.

## Acceptance record

This is a sanitized summary of independently reviewed evidence from 2026-11-01,
not a relocated qualified receipt or a runnable evidence archive. Hashes identify
the retained originals; source/product/evidence paths remain in the private
acceptance record. Current release metadata does not relabel historical producers.

| Record | Observed result | Original producer and evidence identifier |
|---|---|---|
| R4 completion | Worker remained live after normal launching SSH closure; build 1 plus Automation 1; succeeded with all three drains empty; valid, qualified Fetch. | Runtime SHA-256 `21dc1b02c0bd7e5ce44be674b6f12b86f23905c9aa5d333901ef7a8a24942601`; request SHA-256 `56457cdc1f9c1886a21ee7620159cacbfd2dce5f6e8ea01fa7b56c67a8aa6f26`. |
| R4 targeted cancellation | Status observed the wait permit before Cancel; setup/build/wait drained; valid unqualified Fetch. Wait exit 74, forced cleanup true. | Runtime SHA-256 `88d65bc1ae237095918f3d6bd6802514a1a5b2ac5576ae01c1769ddac5b306e5`; cancellation report SHA-256 `89182d9dc7fc71533ef87550414debc4062341fad665c1f69bb4c4a869f62553`. |
| Repaired LFS comparison | One Start; actual build 1 plus exact refusal 2; qualified original-path Fetch within 192.129 seconds; setup/build/refusal drains empty. | Runtime SHA-256 `894e9c57393490f792e2c1ef4786b0fde93760cc602380971d06c03bc248d3cf`; aggregate SHA-256 `73fd308ae0ee17fe3375447adcbb449603477de4d61d7b3dee973015538e9ada`. |

The two R4 records share sample commit `1fa549cd06b1ad9a4e6f0276d3df4431f2ba5c13`
and contain no LFS. Completion Automation used forced cleanup despite exit zero;
setup/build did not. Initial failed jobs and the unknown lease were preserved;
the successful cancellation is a separate producer-attributed proof. Normal SSH
closure was observed; forced network loss was not exercised.

The repaired comparison shares fixed commit/tree and 444 LFS pointer paths across
443 objects with the retained legacy run. Legacy build 1/refusal 6 counts six
predicates; plugin build 1/refusal 2 counts two ordered issues, with zero actions
validated separately. Each path binds its own committed inputs and schema. Legacy
refusal wrapper exit 1 differs from its shared lifecycle exit 0; plugin expected
exit is 0. Refusal forced cleanup is true on both paths; build is false, as is
plugin setup. The plugin receipt has `execution.stage: live_validation`, all other
counters zero, empty execution collections, null measured timings/budget and
released inputs. `requested:{}` and `environment:null` make no runtime-condition
claim. Its bundled AgentVerify source was 0.37.1; later metadata is not a native
rerun. Existing consumer machinery remains in place.

The separate actual-LFS fixture passed all four declared cases; the old candidate
without normalization reproduced the dirty-snapshot refusal on the tested host.
That observation does not establish a universal Git stat-cache cause. These runs
do not establish forced-network-loss recovery, hostile-host attestation, arbitrary
remote shell execution, cross-platform workers or automatic consumer migration.

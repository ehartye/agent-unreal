# Exact-revision remote suite jobs

## Prepare the source and host

- [general] Remote v1 runs the existing verification suites on a Windows engine host. Use the [configuration example](../../../examples/unreal/remote_jobs/config.example.json), [schema](../../../examples/unreal/remote_jobs/config.schema.json) and [fixture walkthrough](../../../examples/unreal/remote_jobs/README.md). The client needs Node, Git and SSH/SCP; the host needs Node, Git, PowerShell 7 and the engine/compiler/SDK required by its launcher configuration. Use existing SSH authentication; keep credentials out of configuration and receipts.
- [general] Start requires the exact full commit checked out cleanly at `source_root`, with a committed manifest and every referenced input. Submodules and tracked symlinks are unsupported. LFS sources require Git LFS on both ends, hydrated source/cache objects and exactly one existing local `lfs.repositoryformatversion=0`. Inspection refuses missing setup rather than rewriting source configuration. Preserve source, runtime and configuration identities for the job's lifetime.
- [general] Put the local configuration, state and Fetch destinations in Git-ignored locations under the source checkout; `Saved/RemoteJobs/` works for the fixture. Configuration paths resolve from the caller's working directory, so use absolute `source_root` and configuration paths. `state_directory` is source-relative. The remote launcher project is source-relative; remote engine and Node paths are absolute Windows paths. Choose a short owned remote root and budget for `repository-worktrees/<job>/` plus generated build paths; a short project path alone is insufficient.
- [general] The remote root/repository have owner markers. Each job gets a new worktree and request-bound worker lease; the existing shared launcher excludes engine workloads machine-wide. Check external engine/build/controller contention too. Unexpected ownership or an unknown lease is a stop, not permission to adopt, delete, reset or kill unrelated processes.

## Four typed actions

Use the committed `remote-manifest.json` from the fixture walkthrough. Replace the
example checkout/configuration paths and use a new job ID. These are individual
actions, not a script that unconditionally cancels every job:

```powershell
$project = 'D:/Temp/RemoteSample'
$config = "$project/Saved/RemoteJobs/remote.local.json"
$revision = (git -C $project rev-parse HEAD).Trim()
node scripts/unreal-remote.mjs start --config $config --job sample-001 --commit $revision --manifest remote-manifest.json --suite small
node scripts/unreal-remote.mjs status --config $config --job sample-001
# When cancellation is intended, request it and inspect Status until drain is proved:
node scripts/unreal-remote.mjs cancel --config $config --job sample-001
# After a known terminal result, select a nonexistent ignored destination:
node scripts/unreal-remote.mjs fetch --config $config --job sample-001 --output "$project/Saved/RemoteJobs/sample-001-fetch"
```

- [general] A fresh Start prepares and transfers the complete bundle and required LFS objects; it offers no resumable upload, preseed bypass or cache-negotiation shortcut. Reconciliation can reuse the accepted local payload, and an existing same-identity remote job is inspected without another launch or upload. The newly owned worktree hydrates verified objects, checks the complete index tree and regular-file bytes, then renormalizes only accepted LFS paths with literal NUL-delimited pathspecs. It rechecks the complete tree and hydrated hashes before the unchanged dirty/commit/snapshot/HEAD-tree/input checks. Empty LFS inventories skip normalization. Historical or consumer worktrees are never normalized as a repair.
- [general] Treat a transport timeout or `uncertain:true` as uncertain dispatch. Preserve the accepted local request/configuration and inspect Status for the same job before deciding anything else. A repeated Start with the exact accepted identity inspects the existing job rather than launching twice; a different identity is refused. Do not change bounds/runtime/source under an old job ID or infer an automatic retry allowance. A missing job observation does not prove that a remote process drained.
- [general] Status reports the last observed remote state and time without changing that job's state. Progress is `launch_pending`, `ready`, `running`, `cancelling`, then `succeeded`, `failed`, `cancelled` or `unknown`. Known terminal states require drain proof. Cancel is idempotent and scoped to the owned process tree; `cancelling` is not completion. `unknown` means ownership or completion cannot be established and never qualifies.
- [general] Keep bound process-identity diagnostics with the job. The expected/observed PID plus creation identity, reason and request/worker/permit bindings distinguish a mismatch from an absent process. A valid diagnostic transfer is not a successful workload or proof of a historical cause. Never clear an unknown lease based only on elapsed time or a missing PID.

## Bounds and returned evidence

- [general] `transport_seconds` bounds each SSH/SCP command; `startup_seconds` bounds the identity/permit handshake; `workload_seconds` bounds worker materialization plus suite execution. Manifest step limits still apply. The public CLI has no overall multi-command deadline. A caller must separately supervise preparation, packaging, upload, polling and qualified Fetch, and retain a separate safety-only cancellation/drain budget. Local client termination does not stop a detached remote worker. Choose bounds before Start and keep them immutable.
- [tested] The [acceptance record](../../../examples/unreal/remote_jobs/README.md#acceptance-record) includes one supervised comparison completed in 192.129 seconds with transport 900, startup 30, worker 1,200, build 600 and refusal 180 seconds, inside a 3,600-second main envelope. Its separate 900-second safety envelope was unused. Those measured bounds are evidence for that workload, not a throughput promise or a built-in CLI supervisor.
- [general] Fetch rejects changed bindings, unsupported descriptors, unexpected/missing/duplicate/traversing members, changed sizes/hashes and an existing output directory. It stages and verifies the transfer, then binds suite verification performed at the original remote source/product/evidence paths. Preserve those paths. Running the downloaded aggregate through the local suite verifier is unsupported and cannot substitute for `verification_location: original-remote-paths`.
- [general] Read both `transfer_valid` and `qualified`; CLI exit zero alone is insufficient. Failed/cancelled evidence can transfer validly while remaining unqualified. Unknown-state diagnostics require `fetch ... --diagnostic` and remain unqualified. A valid archive proves its declared bytes, not a successful suite or hostile-host attestation.

## Acceptance and adoption limits

- [tested] The [producer-attributed acceptance record](../../../examples/unreal/remote_jobs/README.md#acceptance-record) composes retained completion after normal launching-SSH closure with a separately reviewed cancellation after the wait permit. Both have request-bound empty drains. The repaired LFS producer separately completed a fixed-revision build and exact zero-action refusal with qualified original-path Fetch. These are distinct runs and producer identities, not one newly repeated acceptance run.
- [general] Forced network loss, cross-platform engine workers, fleet scheduling, arbitrary remote shell steps and automatic migration are unestablished or unsupported. Normal SSH closure is the demonstrated disconnect boundary. No portable performance, resolution or hardware claim follows from a refusal with `requested:{}` and `environment:null`.
- [general] Follow [staged adoption](unreal-verify-adoption.md): retain existing consumer machinery, compare actual required checks at one fixed revision, and explain each path's schema, input hashes, check units, producer, exit convention and cleanup. A legacy 1+6 versus plugin 1+2 comparison can support equivalent intended refusals only when the six predicates and two issues are explicitly mapped; matching totals is not the criterion.
- [general] Run `node --test scripts/unreal-remote.test.mjs` and `node scripts/check.mjs` for the dependency-free lane. The separate [actual Git LFS check](../../../examples/unreal/remote_jobs/README.md#real-git-lfs-materialization) runs full materialization without an engine or network. Missing Git LFS is a failed prerequisite, never a passing skip. Native acceptance and actual Git LFS stay outside merge CI.

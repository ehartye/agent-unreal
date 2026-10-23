# Measure on a quiet machine: editor contention helper

Backs [profiling facts](../../../skills/unreal-native/references/unreal-native-profiling-facts.md). Windows, Node 22 or newer, no dependencies, no Unreal needed for the helper itself.

Other Unreal editors, commandlets or games on the same machine take CPU, GPU and memory from a measurement. A frame-time receipt recorded beside them looks like a regression in the game. The helper records who else is running in every receipt, waits a bounded time for them to leave, and refuses to record unless contention is allowed explicitly.

## Files

- `editor_contention.mjs` exports pure functions and a command line. It lists processes through a hidden `powershell.exe` CIM call, parses the JSON, classifies `UnrealEditor*.exe` (editor), `UnrealEditor-Cmd.exe` (commandlet) and any packaged game executable passed with `--game-name`, drops the caller's own process tree, optional extra pids and any process whose command line contains a given text (for example your scratch project folder), reads free memory with `os.freemem`, and builds the block below.
- `contention.test.mjs` tests the parser, the classification, own-process exclusion, thresholds, the bounded wait with a fake clock, refusal, the allow flag, the receipt stamp and receipt judging. It runs in `node scripts/check.mjs` and takes milliseconds.
- `contention_demo.mjs` and `contention_idle.py` are the manual demonstration (below). They are not part of the merge check.

## The block

```json
{ "otherUnrealProcesses": 0, "freeMemoryMB": 9625, "contended": false, "reasons": [],
  "others": [], "thresholds": { "maxOtherProcesses": 0, "minFreeMemoryMB": 4096 },
  "sampledAt": "...", "waitedMs": 0 }
```

`contended` is true when the other-process count is above `maxOtherProcesses` or free memory is below `minFreeMemoryMB`; `reasons` says which. After a bounded wait that ended contended and was allowed, the block also has `allowed: true` and stays `contended: true`, so the receipt is never silently clean.

## Use

```text
node editor_contention.mjs wait --timeout-ms 300000 --poll-ms 5000 --stamp receipt.json --exclude-cmdline "<scratch project folder>" --game-name MyGame-Win64-Shipping
node editor_contention.mjs wait --allow-contention --stamp receipt.json      # record anyway, flagged
node editor_contention.mjs sample --stamp receipt.json --key contentionAfter  # one reading after the run
node editor_contention.mjs verify receipt.json                               # exit 3 for a contended or unstamped receipt
```

Exit 0: quiet (or contention allowed). Exit 3: contended and refused, with the reasons on stderr. Exit 2: usage error.

From Node: `await waitForQuiet({ timeoutMs, pollMs, allowContention, excludeCommandLine, gameNames })` returns the block or throws `ContentionError` (its `contention` field holds the block); `stampReceipt(file, block, key)` merges it into a receipt; `judgeReceipt(receipt, { allowContention })` is what a budget comparison calls before it trusts a receipt. Stamp a reading before the run under `contention` and another after it under `contentionAfter`: another editor can start mid-run, and `judgeReceipt` checks both.

## Defaults and why

- `timeoutMs` 300000 and `pollMs` 5000: a few minutes covers a build or a cook that another session is finishing; a longer wait hides a machine that is never quiet. The wait is a loop on the condition that stops at the first quiet reading or at the deadline, not a fixed sleep.
- `maxOtherProcesses` 0: the demonstration below moved a CPU-only frame time by only a few percent per added headless editor, and widened the tail more than the median, so the helper does not try to judge how much a neighbour matters. A rendering editor or game shares the GPU and is expected to matter more (not measured here). Raise the limit only when the other process is known to be idle.
- `minFreeMemoryMB` 4096: a headless `-nullrhi` editor in a near-empty project held about 3 GB of working set when measured on 5.8.2; the floor is one more editor plus about 1 GB of headroom, so starting the measured process does not push the machine into paging.
- Not measured: GPU load from non-Unreal programs, CPU load from builds and shader compilation. Process names are the only signal, so add other executables with `--game-name` if they matter.

## Demonstration

```text
node examples/unreal/contention/contention_demo.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --frames 150 --rounds 4 [--threads 20] [--busy] --out demo.json
```

A fixed workload with no Unreal and no GPU (a seeded array transformed for a fixed number of passes, timed one frame at a time on one thread and as a fork-join over several worker threads) is timed alone, beside one and beside two throwaway `UnrealEditor-Cmd.exe -nullrhi` editors, each in its own project folder in the OS temp folder. Each phase takes a contention reading before and after. A reading that excludes the temp folder counts only editors that are not the demonstration's own; a phase is `clean` when there were none, so a slowdown in it comes from the scratch editors. With `--busy` each scratch editor spins its game thread (`contention_idle.py`) instead of idling. The demonstration stops only processes whose command line names its temp folder.

On a shared machine other sessions start and stop editors during the run, so a phase can be flagged without any scratch editor. That is the point of the helper: such a phase is flagged and not used. The workload is CPU-only, so it shows memory pressure and CPU sharing, not GPU sharing. The numbers of a run belong in the run's report, not in the repository.

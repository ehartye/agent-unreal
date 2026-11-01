# Asset files locked by constructor-time loads

Run the launcher commands below from the plugin root. They wrap each complete probe in the [shared owned process tree](../engine_lock/README.md); retained scientific results describe their original runs.

Backs [Separate native gameplay from content-only asset construction](../../../skills/unreal-native/references/unreal-native-content-pipeline.md). Unreal Engine 5.8, Windows, Visual Studio 2022 Build Tools, plain Python 3 on `PATH`.

A content stage that deletes or rewrites a folder of assets fails when another process holds the files. This example measures which loading styles hold them while an editor is open.

## The three actors (`module/LockProbe/`)

| Class | How it loads its static mesh and material |
|---|---|
| `ALockCtorActor` | `ConstructorHelpers::FObjectFinder` in the constructor, so the class default object references the assets |
| `ALockPostActor` | `LoadObject` in `PostInitializeComponents` |
| `ALockSoftActor` | `TSoftObjectPtr` members set in the constructor and resolved with `LoadSynchronous` in `PostInitializeComponents` |

## Files

- `lock_setup.py` creates six assets in `/Game/Lock`: `M_Ctor`, `M_Post`, `M_Soft` (empty materials) and `SM_Ctor`, `SM_Post`, `SM_Soft` (copies of the engine cube). It runs in a project without a code module, so no class refers to them yet.
- `constructor_locks.mjs` is the runner. It writes a throwaway project in the OS temp folder, runs the setup, backs the six files up, adds the module, builds the Editor target (`../native-build.mjs`), then starts the editor four times with `lock_hold.py`. While each editor runs it calls `lock_try.py`, restoring the six files from the backup before every run.
- `lock_hold.py` keeps the editor open and writes a report: `loaded` (classes loaded, nothing spawned), `spawned` (one actor of each class spawned in the editor world), `played` (those actors inside a running Play-In-Editor session), `ended` (the session ended and garbage collected).
- `lock_try.py` is plain Python run with `-I`. For each file, in order: open for write without truncating, rename and rename back, overwrite with its own bytes, delete. It prints `{ file, op, ok, error_type, error_text }` per try.
- `constructor-locks-checks.mjs` judges the runs; `constructor-locks.test.mjs` tests that logic with no Unreal (it runs in `node scripts/check.mjs`).

## Run

```text
pwsh -NoProfile -File examples/unreal/engine_lock/with-engine-lock.ps1 node examples/unreal/constructor_locks/constructor_locks.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--compiler 14.44.35228] [--sdk 10.0.26100.0]
```

The build takes about 40 to 60 s and each editor run 20 to 110 s (a Play-In-Editor run is the longest). The editors start hidden with `-nullrhi`.

## What it checks (11 checks, all passed)

- With no editor open, all 24 tries (6 files, 4 operations) succeed.
- With the editor open and only the classes loaded, all 8 tries on the two `ConstructorHelpers` assets are refused and all 16 on the other four succeed. Python's text for a delete or rename is `PermissionError: [WinError 32] The process cannot access the file because it is being used by another process`; for an open-for-write or an overwrite it is `[Errno 13] Permission denied`.
- Spawning the three actors in the editor world changes nothing: `PostInitializeComponents` did not run there (no log line, no mesh set on the `Post` and `Soft` actors).
- In a Play-In-Editor session the log shows both `PostInitializeComponents` loads succeeding, and all 24 tries are refused.
- After the session ended and garbage was collected, all 24 tries are still refused. The files were free again once the editor process had exited, because the runner rewrote the folder before the next run.

## Not verified

Which handle holds the files (a plain file handle or a mapping), other asset types such as textures, and other operating systems.

# Architecture audit

An audit answers one question: where does the project's structure differ from Epic's documented guidance, how much does each difference matter, and how sure are you. Everything here is `[general]` method built on the `[documented]` references linked from each step.

## 1. Fix the scope first

- `[general]` Write the area ("module boundaries", "where match state lives", "what loads at startup"), the decision it feeds and the stopping point. If the owner asked for a whole project, still start with module edges and state ownership: they decide most other findings.
- `[general]` Ask for the engine version, the target platforms and which modules ship. A missing answer is recorded as unknown; do not assume it.

## 2. Inventory without running anything

- `[general]` Read only: `.uproject`, `.uplugin`, every `Build.cs` and `Target.cs`, the `Public` headers, `Config/*.ini`, and any architecture notes. Record what the notes claim; check each claim against the code.
- `[general]` Build three artifacts: a **module table** (module, type, phase, public and private dependencies), an **ownership table** (field or system, current owner, lifetime, replicated or not) and a **load-root list** (always-loaded classes and the assets they hard-reference). The references give the method: [modules](unreal-architecture-modules.md), [ownership](unreal-architecture-ownership.md), [content](unreal-architecture-content.md), [layout](unreal-architecture-layout.md) and [lifecycle](unreal-architecture-lifecycle.md).
- `[general]` Use Unreal's own tools when an editor or build is available, and say when you could not: the Reference Viewer, Size Map and Audit Assets for content ([content](unreal-architecture-content.md)); `bValidateCircularDependencies` and `bEnforceIWYU` for the module graph ([modules](unreal-architecture-modules.md)).
- `[general]` Headers-only or partial source is common. Say which function bodies you could not read before judging behaviour.

## 3. Compare with the guidance

- `[general]` For each difference write one finding: **what** (one sentence), **where** (file and line, or asset path), **rule** (the Epic page and a `[documented]` label, or `[general]` for a judgement), **consequence**, **confidence** (observed, inferred or unverified) and **fix size** (one file, one module, cross-module).
- `[general]` A claim in an architecture note that the code contradicts is its own finding: documentation drift. Fix the note or the code, not both blindly.
- `[general]` Do not cite Epic for something its page does not say. The pages state no rule for splitting gameplay rules from presentation, for module count, or for the dependency direction between a Game Feature and the base game; those are preferences.

## 4. Rank by consequence, not by count

| Rank | Consequence | Typical findings |
|---|---|---|
| 1 | The build or a packaged game fails, or a documented rule is broken | Runtime module depends on an Editor module; circular dependencies; a cycle hidden by `CircularlyReferencedDependentModules` |
| 2 | State is in the wrong lifetime or scope | Match state on the game instance; per-player state on a controller that clients read |
| 3 | Load, memory or startup cost | Hard references to large assets on always-loaded classes |
| 4 | Compile time and coupling | Public dependencies no public header uses; monolithic includes; IWYU off |
| 5 | Readability and convention | Naming, formatting, comments |

- `[general]` Rank 1 findings come first even when they are few; rank 5 findings are listed once as a pattern and do not enter the plan unless a tool fixes them in bulk.

## 5. Report

- `[general]` Open with the decision the audit feeds and a verdict in two sentences. Then: the module table with bad edges marked, the ownership table with mismatches marked, ranked findings, **observed versus inferred versus unverified**, and open questions for the owner.
- `[general]` State what you did not check (no build, no editor, no Blueprint graphs) so a missing finding is not read as a clean bill.
- `[general]` Stop when the named decision is supported. Each extra area needs a question it could change.

Next: [remediation plan](unreal-architecture-remediation.md).

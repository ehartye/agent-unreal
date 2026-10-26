# Remediation plan

A plan turns ranked findings into ordered, bounded steps the owner can approve one at a time. Everything here is `[general]` method; the rules each step moves toward are `[documented]` in the linked references.

## Shape of a plan

- `[general]` Group findings that share a cause into one step. One step changes one boundary, so a failure points at one change.
- `[general]` Each step has: **finding ids** it closes, **change** (what moves where), **blast radius** (modules, classes, Blueprints, assets and saved data touched), **check** (the observation that proves it done), **rollback** (how to undo it) and **depends on**.
- `[general]` The check is something you can see: the build passes with `bValidateCircularDependencies` on, the Reference Viewer shows no hard edge from a class to an asset, a test of the moved rule passes, a Game Feature disabled and the game still loads. "Reviewed" is not a check.
- `[general]` Say what the plan does not fix and which findings are only preferences.

## Order

1. `[general]` Make it verifiable first: confirm the failing build or packaged boot, or record that it was not confirmed. A plan resting on an unconfirmed rank 1 finding says so.
2. `[general]` Dependency direction before anything that moves classes: remove inverted and circular edges, then make dependencies private, because later moves are easier inside clean boundaries.
3. `[general]` State ownership next, in this order for each field: add the new owner, point callers at it, remove the old field. Saved data and Blueprints that read the old field are part of the blast radius.
4. `[general]` Content references after that: convert one always-loaded class to soft references, load asynchronously, measure with Size Map, then repeat for the next largest.
5. `[general]` Extract optional features into Game Feature plugins last, one pilot at a time, because they depend on clean boundaries.
6. `[general]` Convention clean-up only where a tool does it in bulk, and not mixed into a behavioural change.

## Compare credible options

When a finding has more than one reasonable fix, present each with its implications:

| Dimension | Ask |
|---|---|
| Time | How long now, and what lag does it add later? |
| Risk | What can break, how likely, how badly? |
| Complexity | How much harder is the system to build or reason about? |
| Best practice | How close is it to what Epic documents? |
| Maintainability | What does it cost to live with? |

- `[general]` Recommend one option. Give estimates only when they rest on something observed, such as the count of call sites; otherwise give relative size (one file, one module, cross-module).
- `[general]` Keep a smaller option that fixes the rank 1 cause even when a larger redesign is better long term; the owner chooses.
- `[general]` For development tooling in a shipped module, the usual pair is a Developer-type module (a clean boundary, one new module and its include fixes) against in-place `UE_BUILD_SHIPPING` guards (hours, but guards can be skipped by the next probe added). The check is that the Shipping target builds and the switch does nothing there, while capture and replay scripts still work in Development.

## Hand-offs

- `[general]` Engine-system detail goes to the domain skills: [unreal-gameplay](../../unreal-gameplay/SKILL.md) for abilities, input, AI and networking, [unreal-animation](../../unreal-animation/SKILL.md) and [unreal-rendering](../../unreal-rendering/SKILL.md) for their systems.
- `[general]` Building, running and packaging belong to [unreal-native](../../unreal-native/SKILL.md). Tests that pin a moved rule and any performance claim belong to [unreal-quality](../../unreal-quality/SKILL.md).
- `[general]` Do not implement the plan inside the audit. Present it, get the owner's choice, then execute step by step with the check for each.

## Plan template

```
Step N: <change in one line>          closes: F2, F5       depends on: Step N-1
  moves:     <what goes where>
  blast:     <modules, classes, assets, saved data>
  check:     <observable proof>
  rollback:  <how to undo>
Not fixed: <findings left as preferences or deferred, with reason>
Open questions: <owner decisions needed>
```

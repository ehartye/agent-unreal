# UEFN native operations

Read this to choose a native UEFN operation and the evidence that proves it, or to wire Verse references and run runtime QA. Observed in one consuming UEFN project on UEFN 42.30; not reproduced in this repo. Every claim is labelled `[general]` for that reason. Inspect the installed schemas after upgrades; these observations are not an API contract for every project. Use the [authoring reference](uefn-authoring.md) for connection setup.

## Choose the operation and its proof

| Operation | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| Orient native switches | One audited rotation pass | Positional axes or upside-down child mesh | Low | Explicit axes and visible component basis | Versioned evidence; preserve other transforms |
| Save named external actor packages | One preflight and batch call | Wrong package ownership | Small native script | Project owns its actors | Exact targets and save receipt |
| Delete owned disposable proof assets | Reconcile first, then one bounded attempt | Wrong ownership or retained references | Explicit identities and native readback | Experiments own their fixtures | Preserve failures; stop rather than force/replay |
| Reuse existing Verse adapters | Preflight, write, read back | Wrong reference type or stale field | Small MCP script | Preserve device identities | Stable editable fields |
| Shrink a Button's visible component | One component edit | Confusing appearance with reach | Low | Preserve the logical device | Read back both scales and radius |
| Offscreen SceneCapture2D | Short bounded callback job | Leaked actor or misleading exposure | Moderate | Temporary editor inspection | Cleanup receipt; keep runtime checks |

Source, saved packages, editor images, validation and runtime behavior establish
different things. State the layer checked. Method-invoking QA does not establish
physical interaction, third-person camera behavior, late joining or performance.

## Read the operation's own reference

| Operation | Reference |
|---|---|
| Orient native switches, shrink a Button's visible component | [Native Button switches](uefn-native-switches.md) |
| Save named external actor packages, or a new ActorFolder | [Scoped saves](uefn-native-saves.md) |
| Delete owned disposable proof assets | [Proof asset cleanup](uefn-native-cleanup.md) |
| Offscreen SceneCapture2D, actual client capture | [Editor and client capture](uefn-native-capture.md) |
| Native material pins, sky collision, LevelBounds | [Exterior materials](uefn-native-exterior.md) |

## Distinguish built-in adapters from custom Verse instances

**[general]** Built-in device editables such as `button_device` and
`cinematic_sequence_device` returned typed adapter objects through
`DeviceTools.GetDeviceProperties`. Preflight each adapter with ObjectTools:
its `savedActor` schema must identify `/Script/Engine.Actor`. Set `savedActor`
to the desired actor reference using `ObjectTools.set_properties`, then read it
back exactly. Replacing the entire editable with a Blueprint actor reference
was rejected. Do not discard a working adapter to work around this.

An obsolete built-in binding can be cleared by setting `savedActor` to JSON
`null`, with readback. Preserve field names during a controller migration so
existing saved devices retain their compatible schema. Clearing obsolete or
default slots this way preserved the active references.

Custom Verse-controller editables need their contained Verse instance, not the
actor and not a built-in `savedActor` adapter. In the observed island, removing
the final property component from an existing controller adapter path located
that containing instance. `DeviceTools.SetDeviceProperty` accepted and read back
the resulting reference, and the actual references subsequently passed server QA.
Validate the containing object and expected class in a new project. Do not
hardcode a generated instance suffix or apply this path rule to arbitrary objects.

Ordinary Verse editable values use DeviceTools. Native Button blueprints used
ObjectTools; DeviceTools rejected them as invalid ScriptDevices. Discover the
schema rather than treating every Fortnite device as the same object type.

## Runtime QA without leaking diagnostics into visits

**[general]** Automatic startup advanced the kinetic and animated timelines. A
second private probe invoked production controller methods and passed its
expected server results: cycle wrapping, held-frame pause/resume, reset and
quiet behavior. It did not press physical devices or verify rendered poses,
completed-clip reset, multiplayer or performance.

Use one authoritative controller and timeline. Pause legacy Animated Mesh
players and companions before starting the shared cinematic timeline. Match
loop, everyone/always-relevant and completion settings to the intended prop.
For timed frame animation, reset its next-frame clock on held-frame resume;
do not catch up all elapsed pause time or restart the animation at frame zero.
Shared quiet handlers must preserve a static station's chosen state and avoid
advertising motion controls that station does not have.

A private QA device defaults disabled. Before a normal push, verify **every
installed** QA device disabled and explicitly saved, no pending migration/save
receipt, and no temporary capture actor. Checking only the original probe missed
a newer probe during review. Record fresh log offsets so old results cannot pass
a new run. Keep one pending push receipt and reconcile uncertain operations;
a completed content push and Connected/Running state are separate from a
passing physical interaction or capacity test.

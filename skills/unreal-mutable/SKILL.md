---
name: unreal-mutable
description: "Choose and drive Mutable in Unreal Engine 5.8, Epic's runtime character customization: Customizable Objects, Instances and parameters, the actor component, compiling from a script, and what Python can and cannot author. Not for building a MetaHuman (use unreal-metahuman), animating a character (unreal-animation), importing a model (use unreal-import) or making the parts (mesh-build and mesh-tool-selection in agent-meshes)."
when_to_use: "Use when asked to swap a character's parts at runtime, such as hats, outfits, hair or body shapes; to build, compile or inspect a Customizable Object or an Instance; to set a Mutable parameter or show each variant; whether a Mutable compile can run headless or from a script; why a compile hangs, runs long or needs a lot of memory; or about a Mutable bug such as a child object compiled from a disabled Game Feature."
---

# Customizing a character at runtime with Mutable

Unreal 5.8 on Windows. Mutable composes one character from swappable parts at runtime. This skill says what an agent can do with it from a script, what the compile costs and where to stop waiting. Other Unreal skills: `unreal-animation`, `unreal-import`, `unreal-editor-scripting`, `unreal-rendering`, `unreal-native`, `unreal-architecture`.

Evidence in short: a spike on 2026-10-29 found that Python alone creates, compiles and inspects a Customizable Object but cannot author its graph (9 of 16 probe checks). A second spike on 2026-10-30 built a small editor C++ module that adds nodes and links pins; two runs passed 26 of 26 checks (probe: [mutable README](../../examples/unreal/mutable/README.md)). Brackets mark each line `[tested]`, `[documented]` or `[general]`.

| You are about to | Read |
|---|---|
| Learn what Mutable is, how a Customizable Object, an Instance and the actor component fit together, or whether it suits the job | [Overview](references/unreal-mutable-overview.md) |
| Create and compile a Customizable Object from a script, bound the compile with a timeout, or read it back as compiled | [Build and compile](references/unreal-mutable-build-compile.md) |
| Put parts in the graph: add a node, link a pin, offer meshes as options (Python alone cannot; the bridge module does, and the editor does by hand) | [Authoring the graph](references/unreal-mutable-graph.md) |
| Create an Instance, set a parameter option, attach it to an actor, or capture one frame per variant | [Parameters and variants](references/unreal-mutable-variants.md) |
| Compile or build in a `-nullrhi` commandlet, or decide between headless and the editor | [Headless and editor](references/unreal-mutable-headless.md) |
| Meet a Mutable bug, a hang or a very large compile, or ask what is not established | [Known bugs and open questions](references/unreal-mutable-bugs.md) |

## What works from a script

- [tested] 2026-10-29: `unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object` made an object, and `CompileParams` with a callback compiled it in about half a second in the editor. It read back compiled with no errors.
- [tested] 2026-10-29: Python found the object's graph and created a mesh node with its mesh set, but found no way to add a node to the graph or link a pin, so the object had 0 parameters and 0 components. Nothing was left to set or draw, so build, variants and headless were not decided by that spike (see the bridge lines below).
- [tested] 2026-10-29: a `-nullrhi` commandlet compiled that empty object in about 0.1 second with a blocking call. That spike only compiled the empty object headless.

## The decision for an agent

- [tested] 2026-10-30, runs 1 and 2 of the bridge probe: a module `MutableBridge` (editor C++, `UFUNCTION(BlueprintCallable)` statics) built in 37 s with no compiler or linker message and gave Python `add_node` and `link_pins`. The recipe is [Mutable graph bridge](../unreal-editor-scripting/references/unreal-mutable-bridge.md); the graph notes are in [Authoring the graph](references/unreal-mutable-graph.md).
- [tested] 2026-10-30, run 2: a graph built that way (20 nodes, 27 links; three agent-meshes parts) compiled in 0.52 s to one parameter `Hat` with options `Cap|Tall`. An Instance set to each option drew the whole figure with a red cap and with a grey top hat, and the two frames differed in 3,341 pixels. In run 1 the graph linked only the first mesh section of each part, so its frames showed one section of each part.
- [tested] 2026-10-30, runs 1 and 2: the same compile of the saved graph completed in a `-nullrhi` commandlet with a blocking call in 0.12 s, and the process exited 0 in about 7 s.
- [general] Wrap every compile in a wall-clock timeout and treat a timeout as a result, not something to wait on. Reports of a compile that hangs (Extension Data constants) or needs very large memory (many morph targets and child objects) are anecdotal and unrun here.

## Rules of thumb

- [documented] Epic's 5.8 release notes: Mutable is production-ready in 5.8, though Epic labels parts of it "Very experimental", such as custom External Operations. A dataless Customizable Object evaluates its parameters at runtime and not at compile time.
- [documented] Epic recommends `CustomizableObjectInstanceUsage` over the `CustomizableSkeletalComponent` wrapper in the 5.8 upgrade notes.
- [general] The parts come from `unreal-import` (skeletal meshes; a shared skeleton is the safe choice, not a tested requirement) and the character from agent-meshes; a MetaHuman as a Mutable object belongs to unreal-metahuman and is not covered here.
- [general] Run a rendering editor for any frame; a frame cannot come from a commandlet.

## Not established

- [tested] 2026-10-30, runs 1 and 2: the compile ran on three small meshes in a fraction of a second. The cost of a large object is not known.
- [general] Not run: several components or LODs, materials and textures, the Instance update callback from Python (the probe waited a fixed 10 s per variant), the `CustomizableObjectInstanceUsage` class, and the forum reports above. The smallest next experiment is the same recipe on a large real asset under the same timeout.

Enable the Mutable plugins like any other: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).

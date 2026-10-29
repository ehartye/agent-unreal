---
name: unreal-mutable
description: "Choose and drive Mutable in Unreal Engine 5.8, Epic's runtime character customization: Customizable Objects, Instances and parameters, the actor component, compiling from a script, and what Python can and cannot author. Not for building a MetaHuman (use unreal-metahuman), animating a character (unreal-animation), importing a model (use unreal-import) or making the parts (mesh-build and mesh-tool-selection in agent-meshes)."
when_to_use: "Use when asked to swap a character's parts at runtime, such as hats, outfits, hair or body shapes; to build, compile or inspect a Customizable Object or an Instance; to set a Mutable parameter or show each variant; whether a Mutable compile can run headless or from a script; why a compile hangs, runs long or needs a lot of memory; or about a Mutable bug such as a child object compiled from a disabled Game Feature."
---

# Customizing a character at runtime with Mutable

Unreal 5.8 on Windows. Mutable composes one character from swappable parts at runtime. This skill says what an agent can do with it from a script, what the compile costs and where to stop waiting. Other Unreal skills: `unreal-animation`, `unreal-import`, `unreal-editor-scripting`, `unreal-rendering`, `unreal-native`, `unreal-architecture`.

Evidence in short: one spike ran the build, variant and headless routes on 2026-10-29 (probe: [mutable README](../../examples/unreal/mutable/README.md); 9 of 16 checks passed). A script creates, compiles and inspects a Customizable Object, and cannot author its graph. Brackets mark each line `[tested]`, `[documented]` or `[general]`.

| You are about to | Read |
|---|---|
| Learn what Mutable is, how a Customizable Object, an Instance and the actor component fit together, or whether it suits the job | [Overview](references/unreal-mutable-overview.md) |
| Create and compile a Customizable Object from a script, bound the compile with a timeout, or read it back as compiled | [Build and compile](references/unreal-mutable-build-compile.md) |
| Put parts in the graph: add a node, link a pin, offer meshes as options (Python cannot; the editor, a C++ bridge or a hand-authored object can) | [Authoring the graph](references/unreal-mutable-graph.md) |
| Create an Instance, set a parameter option, attach it to an actor, or capture one frame per variant | [Parameters and variants](references/unreal-mutable-variants.md) |
| Compile or build in a `-nullrhi` commandlet, or decide between headless and the editor | [Headless and editor](references/unreal-mutable-headless.md) |
| Meet a Mutable bug, a hang or a very large compile, or ask what is not established | [Known bugs and open questions](references/unreal-mutable-bugs.md) |

## What works from a script

- [tested] 2026-10-29: `unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object` made an object, and `CompileParams` with a callback compiled it in about half a second in the editor. It read back compiled with no errors.
- [tested] 2026-10-29: Python found the object's graph and created a mesh node with its mesh set, but found no way to add a node to the graph or link a pin, so the object had 0 parameters and 0 components. Nothing was left to set or draw: build/compile is invalidated as run, and variants are invalidated (nothing to set).
- [tested] 2026-10-29: a `-nullrhi` commandlet compiled that empty object in about 0.1 second with a blocking call. Headless is partial: an empty object compiles headless, and a real graph was not tested.

## The decision for an agent

- [general] Author the graph in the editor or through an editor C++ bridge that exposes add-node, link-pins and reconstruct-pins to Python, as the plugin does for [Animation Blueprint states](../unreal-animation/references/unreal-animgraph-from-cpp.md) and for [Landscape](../unreal-editor-scripting/references/unreal-python-cpp-bridge.md). That bridge was not built, so the route is not tested. See [Authoring the graph](references/unreal-mutable-graph.md).
- [general] Once a graph exists, use Python to create, compile, inspect, set parameters and attach the Instance. The Instance calls were found on the class but not run against a real option.
- [general] Wrap every compile in a wall-clock timeout and treat a timeout as a result, not something to wait on. Reports of a compile that hangs (Extension Data constants) or needs very large memory (many morph targets and child objects) are anecdotal and unrun here.

## Rules of thumb

- [documented] Epic's 5.8 release notes: Mutable is production-ready in 5.8, though Epic labels parts of it "Very experimental", such as custom External Operations. A dataless Customizable Object evaluates its parameters at runtime and not at compile time.
- [documented] Epic recommends `CustomizableObjectInstanceUsage` over the `CustomizableSkeletalComponent` wrapper in the 5.8 upgrade notes.
- [general] The parts come from `unreal-import` (skeletal meshes; a shared skeleton is the safe choice, not a tested requirement) and the character from agent-meshes; a MetaHuman as a Mutable object belongs to unreal-metahuman and is not covered here.
- [general] Run a rendering editor for any frame; a frame cannot come from a commandlet.

## Not established

- [tested] 2026-10-29: a script found no route to a graph with swappable options (invalidated as run): two runs, and a third repeated the result.
- [general] The next experiment is the C++ bridge or one hand-authored object. Not run: whether any variant frame differs from another, and the headless cost of a real graph (partial).

Enable the Mutable plugins like any other: the steps are under Enable a feature in [unreal-editor-scripting](../unreal-editor-scripting/SKILL.md).

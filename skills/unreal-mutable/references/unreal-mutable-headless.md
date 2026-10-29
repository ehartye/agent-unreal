# Mutable headless or in the editor

Target: Unreal Engine 5.8 on Windows. Two ways to run the same script: a rendering editor (offscreen, with a viewport that draws nothing the capture cannot see) and a commandlet (`UnrealEditor-Cmd -run=pythonscript -nullrhi`, no window and no renderer). The [mutable probe](../../../examples/unreal/mutable/README.md) ran both on 2026-10-29, and only on the empty object.

## What ran headless

- [tested] 2026-10-29: in a `-nullrhi` commandlet, loading the saved object and compiling it with a blocking call finished in about 0.1 second, read back compiled with no errors, and the process exited 0 in about 7 seconds in all. The Mutable editor module loaded far enough in the commandlet to run the compile.
- [tested] 2026-10-29: the object loaded not compiled in the commandlet, as in the editor, so the commandlet compiled it before use.
- [tested] 2026-10-29: the commandlet used the blocking compile call. In the rendering editor the asynchronous call with a callback took about half a second for the same object.
- [general] A commandlet has no Slate tick for an asynchronous callback, which is why the blocking call is used there.
- [general] A compile is CPU work, so a missing renderer is not the blocker. That is the hypothesis the run supported for the empty object only.

## What needs the editor

- [general] Any frame: a commandlet with `-nullrhi` draws nothing, so variant frames come from a rendering editor. Use `-RenderOffScreen` when no one is at the machine, and expect the level viewport to draw nothing; take frames the way the Niagara probes do, from a Play In Editor session.
- [general] Anything that waits on an editor tick, such as an asynchronous compile or `update_skeletal_mesh_async`, is polled from a tick callback in the editor and does not complete in a commandlet unless the loop ticks the engine itself. This was not tried for the Instance update.
- [general] Authoring the graph in the editor UI is editor work by definition; an editor C++ bridge ([Authoring the graph](unreal-mutable-graph.md)) is callable from either mode once its module is loaded.

## Rules

- [general] Put a wall-clock limit on the process and on the compile, in both modes. A timeout is a result.
- [general] Use a throwaway project in a unique temporary folder and stop only processes that name it. Run one editor process at a time on a machine with one GPU.
- [general] Pass the Mutable plugin in the `.uproject`; a commandlet run on a project without it cannot see the classes.
- [tested] 2026-10-29: a fresh process needs a compile of its own; saving a compiled object does not carry compiled state across a restart.

## Not established

- [general] Headless is partial: an empty object compiles in a commandlet, and the compile of a real graph with meshes, the object the forum hang and memory reports describe, was not run. The empty object says nothing about it. The smallest next experiment is the same headless phase on a hand-authored or bridge-built object, under the same timeout.

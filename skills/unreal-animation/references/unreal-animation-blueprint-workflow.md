# Animation Blueprint workflow in Unreal 5.8

Target: Unreal Engine 5.8, Windows. The numbered steps for [Animation Blueprints](unreal-animation-blueprints.md).

1. Create the Animation Blueprint from an AnimInstance parent class and a target skeleton.
2. Use the Event Graph as little as possible (Epic): it runs on the game thread. Put update logic in an override of Blueprint Thread Safe Update Animation.
3. Read game-thread data through Property Access, which snapshots it for worker threads. Give custom Property Access functions the Thread Safe property and a pure Return Node whose output is named `ReturnValue`; leave Call Site on Automatic.
4. Keep AnimGraph pins on Fast Path: member variables, negated Boolean members and members of nested structs; any calculation removes it. Turn on Warn About Blueprint Usage so Compiler Results lists calls into the Blueprint VM.
5. Parallel update needs `AnimInstance::NeedsImmediateUpdate` to pass; Epic: root motion blocks it.
6. State machines: connect the machine to the Output Pose; each state outputs a pose; transitions are one-way, so two-way movement needs one in each direction. Conduits give one-to-many and many-to-one routing; aliases share transition rules. Enable Create Notify Meta Data when transition rules call notify functions; Max Transitions Per Frame = 1 allows one transition decision per tick.
7. Linked Anim Layers: create an Animation Layer Interface; bind it in Class Settings of the base Blueprint and of every Blueprint that implements it; call Link Anim Class Layers. Layers under one non-default Group name share an instance. Layers load when linked; unloading is your own streaming logic (Epic).
8. Montages: place animations in slots, name Sections, and route slots through the AnimGraph so separate Slot Groups can drive separate body parts. Do not overlap animations in one slot. Replicate Play Montage yourself with an RPC. Montage Notifies need Play Montage, not Play Anim Montage. Montage Tick Type: Queued is asynchronous and cheaper; Branching Point is synchronous and precise.
9. Notifies: Notify fires once; Notify State has begin, tick and end. Skeleton Notifies live on the Skeleton asset, so save it. 5.8 adds an option to not merge notify-state lifetimes.
10. Blend Spaces: set axis range and grid; Smoothing Time and Type set how an axis eases; Wrap Input needs similar animations at both ends; use a Blend Space player node; analysis functions can place samples.
11. For many characters, enable Update Rate Optimizations at 15 Hz or lower at distance, or use the Animation Budget Allocator plugin (Epic's recommendation).

## Sources

- [Graphing in Animation Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/graphing-in-animation-blueprints-in-unreal-engine)
- [Animation Optimization](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-optimization-in-unreal-engine)
- [Property Access](https://dev.epicgames.com/documentation/en-us/unreal-engine/property-access-in-unreal-engine)
- [State Machines](https://dev.epicgames.com/documentation/en-us/unreal-engine/state-machines-in-unreal-engine)
- [Animation Blueprint Linking](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprint-linking-in-unreal-engine)
- [Animation Montage](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-montage-in-unreal-engine)
- [Animation Notifies](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine)
- [Blend Spaces](https://dev.epicgames.com/documentation/en-us/unreal-engine/blend-spaces-in-unreal-engine)

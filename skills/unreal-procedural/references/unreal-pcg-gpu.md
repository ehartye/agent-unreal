# PCG GPU execution in Unreal 5.8: supported nodes, when it pays and its limits

Target: Unreal Engine 5.8, Windows. Companion to [PCG](unreal-pcg.md), which covers enabling the plugin, when to use it, the driving table and the workflow. This is the GPU execution of nodes and the GPU Static Mesh Spawner.

## GPU execution

- Supported nodes: Attribute Partition, Copy Points, Cull Points Outside Actor Bounds, Custom HLSL, Data Count, Normal to Density, Static Mesh Spawner, Transform Points.
- Use it when the data holds enough points to fill the GPU; group GPU nodes to limit CPU-GPU transfers.
- A GPU Static Mesh Spawner creates transient instances in GPU memory; it does not support collision and physics, navigation, ray tracing, Distance Field lighting, baked static lighting or HLOD, and works only with the Weighted and By-Attribute selectors and the by-attribute packer. Epic labels the feature Beta and the GPU spawner Experimental.

## Sources

- [Using PCG with GPU Processing](https://dev.epicgames.com/documentation/unreal-engine/using-pcg-with-gpu-processing-in-unreal-engine)

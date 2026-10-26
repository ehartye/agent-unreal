# Mesh Terrain materials and Runtime Virtual Textures in Unreal 5.8

Target: Unreal Engine 5.8, Windows. **Experimental.** [documented] Epic's material page says to "use caution when shipping with it". Written only from Epic's two 5.8 pages (Sources); nothing here was run. Setup, channels and pipelines: [Mesh Terrain](unreal-mesh-terrain.md).

## Material nodes

[documented] Mesh partition data is available in the Material graph through five nodes.

| Node | What the page says |
|---|---|
| Mesh Partition Resource | Provides the mesh partition channel texture to the material |
| Mesh Partition Channel Sample | Samples a channel by name; set a Mesh Partition Definition first, which fills the Channel list |
| Mesh Partition Channel Sample Index | Samples a channel by index instead of by name |
| Mesh Partition Channel Inspector | Debug only: shows one unique colour per channel |
| Mesh Partition Tex Coord | Returns the UVs of the mesh partition geometry |

- [documented] Channel Sample has two settings: **Channel** (a weight channel defined in the selected definition) and **Mesh Partition Definition** (an asset from the Content Browser). Select the definition first; the Channel list stays empty until then.
- [documented] Tex Coord has two outputs: **UV**, normalised 0 to 1 per mesh partition section, and **UV [unit]**, in 3D units (a 100 cm section runs 0 to 100).
- [general] Use UV for a texture that should fit each section once. Use UV [unit] for a tiling texture that keeps one size across sections of different dimensions.
- [general] Put the Inspector on the base colour of a test material to see which channels a modifier or paint stroke reached, then remove it before shipping.

## Reading weight channels

1. [documented] Connect the **Mesh Partition Resource** output to the **Mesh Partition Channel Sample** input.
2. [documented] Read the channel you want from the Sample node (Epic's example reads a Gravel channel).
3. [documented] Use the value for material effects, for example to blend material attributes.

- [general] The Resource node carries the baked channel texture, and the sibling reference documents that a channel a modifier writes but the definition lacks stays editor-only and is not baked. Add the channel to the definition before wiring it into a material.
- [general] One Sample node per channel, each feeding a lerp or layer blend, is the straightforward shape the page's example points to; the page shows no other layout.
- [general] Pick the Sample Index node only when the channel order is fixed and known. The page does not say which numbering the index uses, so check against the Inspector colours before relying on it.

## Runtime Virtual Textures

[documented] RVT on Mesh Terrain takes three steps.

1. [documented] **Create RVT assets** in the Content Browser, for the mesh partition to use.
2. [documented] **Create RVT volumes** in the level, then link the RVT assets from the Content Browser to the volume. The volumes appear in the Outliner.
3. [documented] **Add an RVT transformer** to the transformer pipelines the mesh partition definition uses, in **both** the Build and the Preview settings.

- [documented] Epic's Preview example is a pipeline holding one RVT transformer with three elements, each pointing to an RVT asset in the Content Browser.
- [general] Step 3 needs a pipeline in each of the two settings; a definition that lists only one leaves the other without RVT output. Reuse the pipeline assets named in the sibling reference (`TP_Compiled_...`, `TP_Preview_...`) rather than adding a second pipeline per setting.
- [general] If RVT output shows in the editor preview but not in a compiled section (or the reverse), check first that both settings hold the transformer.
- [documented] The sibling reference lists the RVT transformer among the pipeline transformer types (with Collision, Far Field, Skirt, Static Mesh, Subsection and WP Actor Properties).

## Where the pages are silent

- Which RVT type each of the three transformer elements takes, and what the three assets are for (the page says only that the example has three).
- RVT asset settings (size, tile count, material type) and how the volume must cover the terrain.
- Project settings, plugin or platform requirements for virtual textures.
- How the terrain material writes to the RVT, and how other materials sample it.
- What the Sample Index numbering follows, and the Mesh Partition Resource node's settings and outputs beyond the channel texture.
- Python, C++ or Blueprint access to any of these nodes, assets or transformers. Treat the work as editor-interactive.
- Performance cost of the nodes or of RVT on a partition.

## Sources

- [Mesh Terrain Material](https://dev.epicgames.com/documentation/unreal-engine/mesh-terrain-material-in-unreal-engine)
- [Runtime Virtual Textures and Mesh Terrain](https://dev.epicgames.com/documentation/unreal-engine/runtime-virtual-textures-and-mesh-terrain-in-unreal-engine)

Related: [Mesh Terrain](unreal-mesh-terrain.md), [Water](unreal-water.md) (water bodies add their own channels), [PCG](unreal-pcg.md) (graphs write the same channels).

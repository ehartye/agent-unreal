# Substrate slab graphs, blend modes and lighting modes in Unreal 5.8

Target: Unreal Engine 5.8, Windows. The nodes and pin names of a layered slab material (lacquered, fuzzy, plain metal), and the blend and lighting modes of a translucent one. Status, GBuffer formats and the Toon route are in [Substrate](unreal-substrate.md).

## Layered slab from Python

Connect pins by name. The spelling differs by node, so spell each as listed.

- [documented] `MaterialExpressionSubstrateMetalnessToDiffuseAlbedoF0` (displayed as Substrate Metalness-To-DiffuseColorF0) converts a metalness parameterization into the slab's inputs. Its pins have no custom names, so they carry the property names without spaces: inputs `BaseColor`, `Metallic`, `Specular`; outputs `DiffuseAlbedo`, `F0` (`MaterialExpressionSubstrate.h`, `MaterialExpressionSubstrate.cpp`, symbol `UMaterialExpressionSubstrateMetalnessToDiffuseAlbedoF0`).
- [documented] `MaterialExpressionSubstrateSlabBSDF` overrides its pin names with spaces: `Diffuse Albedo`, `F0`, `F90`, `Roughness`, `Anisotropy`, `Normal`, `Tangent`, `Emissive Color`, `Fuzz Roughness`, `Fuzz Amount`, `Fuzz Color`. `MaterialExpressionSubstrateSimpleClearCoatBSDF` takes `Diffuse Albedo`, `F0`, `Roughness`, `Clear Coat Coverage`, `Clear Coat Roughness`, `Normal`, `Emissive Color`, `Bottom Normal` (`GetInputName` in `MaterialExpressionSubstrate.cpp`). The Toon BSDF has no such override and takes the unspaced names in [Substrate](unreal-substrate.md).
- [documented] The header says `Fuzz Roughness` is ignored with the Blendable GBuffer (fuzz roughness is forced to 0.5), and falls back to `Roughness` when unconnected.
- [general] Observed once on 5.8.x from Python: helper outputs `DiffuseAlbedo` and `F0` feed the slab's `Diffuse Albedo` and `F0`, `Roughness` and `Emissive Color` are set on the slab, and the BSDF output goes to `MP_FRONT_MATERIAL` (the connect call is the one tested for Toon). The slab and clear-coat graphs were not run from this repo.
- [general] Observed once on 5.8.x: a clear coat on a metal darkened it at coverage 0.3 to 0.7, because the coat's sharp reflections of a dark ground replaced the base's softer ones (gold turned to dark bronze), so metals went back to plain slabs. A fuzz layer on cloth changed nothing visible in the views tried.
- [general] Observed once on 5.8.x: a translucent slab needs its blend mode and lighting mode chosen (below). A legacy translucent material (glass) was left legacy and converted at compile time. Substrate-native glass, subsurface, hair and eye shading were not tried.
- [general] Observed once on 5.8.x: switching `r.Substrate` off and restarting the editor still worked for materials never converted explicitly. Each restart recompiles every material, so the first run waits.
- [general] Measured once on one high-end GPU in a scene with 76 shadow-casting lights: the Blendable GBuffer cost 7.1 to 8.3 ms mean against 7.1 to 8.5 ms with Substrate off; the Adaptive format cost about 1 ms (12 percent) more in the one run of three that agreed with the others. Two runs read low and the reason was not settled. The visible gain from adopting Substrate was small.

## Blend modes and translucent lighting modes

Set the Blend Mode on the root node: Opaque, Masked, Translucent - Grey Transmittance, Translucent - Colored Transmittance, Colored Transmittance Only (the Multiply equivalent), Additive, AlphaComposite (Premultiplied Alpha), AlphaHoldout. Translucent modes also need a Lighting Mode:

- [documented] Volumetric NonDirectional: cheapest per pixel; ignores the normal.
- [documented] Volumetric Directional: uses the normal; enable Generate Spherical Particles for a useful tangent space.
- [documented] Volumetric PerVertex NonDirectional and Directional: per-vertex evaluation, lower pixel cost.
- [documented] Surface Translucency Volume: blurry and distance-limited. Epic's overview says both "only diffuse lighting is supported" and that it "supports reflections on the surface"; the page does not reconcile them, so test the look you need.
- [documented] Surface ForwardShading: per-light specular; the most expensive.

Related: [Substrate](unreal-substrate.md), [Lumen](unreal-lumen.md).

## Sources

- [Overview of Substrate Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-substrate-materials-in-unreal-engine)
- The 5.8 install: `MaterialExpressionSubstrate.h`, `MaterialExpressionSubstrate.cpp`.

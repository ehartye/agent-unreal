# Substrate materials in Unreal 5.8: when to use it and how to drive it

Target: Unreal Engine 5.8, Windows. Substrate is the material authoring framework that replaces the fixed suite of shading models and blend modes (Default Lit, Clear Coat and the rest) with modular, principled BSDF building blocks (Epic's Substrate pages). In 5.8 it also carries Substrate Toon Shading for stylized, non-photorealistic looks.

## Enable it

Substrate is a renderer feature, not a plugin: the engine ships no plugin descriptor for it.

- Project Settings > Rendering > Substrate > "Substrate materials" (`r.Substrate`). Restart the editor after changing it (`ConfigRestartRequired` in the 5.8 install).
- New projects have Substrate enabled by default. A project upgraded to 5.7 or later stays on the non-Substrate path until you enable it (Epic's overview page).
- Status: Epic's Substrate landing page labels it Beta and advises caution when shipping, and the overview notes that platform support and testing are incomplete. Path Tracer support is Beta; opaque rough reflection and material layer support are Experimental.
- Substrate Toon Shading is Experimental in the 5.8 release notes, and the Substrate Toon BSDF node carries `DevelopmentStatus = "Experimental"` in the 5.8 install.

## Use it when

- Materials need layered or mixed surfaces: clear coat, fuzz, thin film, conductors, dielectrics, or a vertical stack of slabs.
- Authoring should follow physical parameters: F0 and Diffuse Albedo replace Base Color, Specular and Metalness.
- A stylized look is wanted inside the same lighting stack: Substrate Toon supports all light types, including local lights, sky lights and Lumen global illumination (5.8 release notes).
- Measured materials arrive as X-Rite AxF files: 5.8 imports them as Substrate materials.
- Existing materials keep working: legacy materials compile to Substrate at compile time and opening one does not modify it (Epic's overview page).

## Use something else when

- Mobile needs diffusion sub-surface: mobile does not support it, and the compiler enables parameter blending automatically on lower-end platforms (Epic's overview page).
- The target platform is DirectX 11 or Mac: Epic notes these may not work entirely, so confirm support before committing.
- Photorealistic lighting is the goal and the look is not stylized: author with Slab nodes, not Toon. The legacy shading models are superseded by Substrate and remain only for existing content.

## GBuffer formats

Set Project Settings > Rendering > Substrate > "Substrate GBuffer Format (Project)" (`r.Substrate.ProjectGBufferFormat`); changing it requires an editor restart.

| | Blendable GBuffer | Adaptive GBuffer |
|---|---|---|
| Focus | Fixed memory, predictable speed | Visual fidelity |
| Limits | 1 closure, 20 bytes per pixel (5.8 install) | Closure Count and Bytes Per Pixel are project settings |
| Cost | Parity with the non-Substrate path | Depends on on-screen material complexity; cook time about 15% above Blendable |
| Decals | Blendable and DBuffer | DBuffer only; forces DBuffer decals on |
| Platforms | All | Xbox Series X/S, PlayStation 5 and 5 Pro, Windows, macOS and Linux with Shader Model 6; others fall back to Blendable |

New Substrate projects default to Blendable; the Automotive and Architectural templates use Adaptive. Use Blendable for 60 Hz projects and Adaptive when fidelity is the goal (Epic's overview page). Substrate Toon is built on Blendable GBuffer mode (5.8 release notes), so choose Blendable when using it.

## Blend modes and translucent lighting modes

Set the Blend Mode on the root node: Opaque, Masked, Translucent - Grey Transmittance, Translucent - Colored Transmittance, Colored Transmittance Only (the Multiply equivalent), Additive, AlphaComposite (Premultiplied Alpha), AlphaHoldout. Translucent modes also need a Lighting Mode:

- Volumetric NonDirectional: cheapest per pixel; ignores the normal.
- Volumetric Directional: uses the normal; enable Generate Spherical Particles for a useful tangent space.
- Volumetric PerVertex NonDirectional and Directional: per-vertex evaluation, lower pixel cost.
- Surface Translucency Volume: blurry, distance-limited, diffuse only, supports reflections.
- Surface ForwardShading: per-light specular; the most expensive.

## Substrate Toon Shading

- Author with the Substrate Toon BSDF node plus a Toon Profile asset. The profile holds a diffuse ramp, a specular ramp, optional ramp offset textures with strength and size, and a shadow extinction value (`ToonProfile.h` in the 5.8 install). The release notes add dithered ramps, self-shadowing with hatching patterns, anisotropic specular highlights and global illumination scale controls.
- Epic's documentation states no further render path requirement beyond the Blendable GBuffer base.

## How an agent drives it

| Task | Route | What to call |
|---|---|---|
| Enable Substrate, pick GBuffer format | Project settings | `r.Substrate`, `r.Substrate.ProjectGBufferFormat`; restart |
| Tune Adaptive limits | Project settings / cvars | `r.Substrate.ProjectClosuresPerPixel`, `r.Substrate.BytesPerPixel` (default 80) |
| Author Substrate graphs, Toon BSDF, Toon Profile | Material Editor UI | Slab and Toon BSDF nodes; right-click the root node > Convert to Substrate (permanent; the material then renders black with Substrate off) |
| Create material expressions from script | Python | Not confirmed: the class surface dump names only `MaterialExpressionSubstrateHairBSDF` and `MaterialExpressionSubstrateSingleLayerWaterBSDF` |
| Set or read cvars | Python | `unreal.SystemLibrary.execute_console_command` (documented for the 5.7 Python API) |
| Inspect cost | Editor UI | Substrate stats panel; advanced visualization shaders setting (Editor, Win64, DX12) |

## Workflow

1. Enable Substrate and restart; choose Blendable or Adaptive GBuffer per the table.
2. Author new materials from Slab nodes; use Substrate Simple Clear Coat, Wrap and Diffusion building blocks in place of legacy shading models.
3. Pick the Blend Mode, then the translucent Lighting Mode with the lowest cost that looks right.
4. Reduce cost with parameter blending: Epic's example drops 108 bytes per pixel to 28. Each extra BSDF roughly doubles per-pixel lighting cost.
5. Read the Substrate stats panel for simplification reasons when a material exceeds closure or bytes-per-pixel limits.
6. For stylized work, create a Toon Profile, assign it to a Substrate Toon BSDF, and keep the project on Blendable GBuffer.

Related: [Lumen](unreal-lumen.md), [Niagara](unreal-niagara.md).

## Sources

- [Substrate Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/substrate-materials-in-unreal-engine)
- [Overview of Substrate Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-substrate-materials-in-unreal-engine)
- [Unreal Engine 5.8 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes)
- [Unreal Python 5.7 SystemLibrary](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SystemLibrary?application_version=5.7)
- The 5.8 install: `RendererSettings.h`, `MaterialExpressionSubstrate.h`, `ToonProfile.h`, `Engine/Shaders/Private/Substrate`.

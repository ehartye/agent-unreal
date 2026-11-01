# Niagara: drawn, ink and cel looks

For system creation, toolsets, simulation and profiling, start with [Niagara](unreal-niagara.md). For outlines, ribbons and measured cost, use [Niagara ink looks](unreal-niagara-ink-looks.md). Run complete probes through the [shared launcher adapter](../../unreal-native/references/unreal-engine-launcher.md) from the plugin root.

## Drawn, ink and cel looks

Choose by what must stay drawn. [`stylized_validate.mjs`](../../../examples/unreal/stylized/stylized_validate.mjs) runs each [tested] line.

- Drawn frames that ignore the lighting: a self-emissive sprite that plays a flipbook. [tested] An Unlit, Masked material (Texture Sample Parameter SubUV into Emissive Color and Opacity Mask) drew the same colours and area under a bright backdrop with a strong sun and a dark backdrop with no sun.
- [tested] Set the Sprite Renderer's Sub Image Size to the grid (`SetRendererData`, `{"SubImageSize":{"x":4,"y":4}}`). SubUV Animation in Linear mode writes `Particles.SubImageIndex` as normalized age x frame count (0 to 16 over the lifetime). Direct Index mode with a constant Direct Frame Index shows that cell.
- [documented] Turn Sub UV Blending Enabled off for hard cuts: on, it blends with the next cell by the fractional index (`NiagaraSpriteRendererProperties.h`).
- Stepped light on an unlit particle: quantize a light term, `floor(term x N) / (N - 1)`, into a Lerp. [tested] It drew flat bands next to a smooth control.
- [tested] The Dynamic Material Parameters module's Index 0 Param 1 (3) reached the material's Dynamic Parameter node (default 4): three bands rendered.
- Lit toon on a particle: [tested] Substrate Toon works on sprites ([Substrate](../../unreal-rendering/references/unreal-substrate.md)).
- [tested] 2026-10-29, one throwaway project and scene: a Direct Frame Index linked to a float user parameter stayed age-driven (`SubImageIndex` = 16 x `NormalizedAge`) when the saved system loaded as written, though the link, the Direct Index mode and an UpToDate state read back (`frame` probe, 3 of 5). With `fx.ForceCompileOnLoad=1` in the project's `[ConsoleVariables]`, set before the asset loads, it read 0, 2 and 9 for the parameter set to 0, 2 and 9 and the three screenshots differed (5 of 5).
- [documented] The toolset edits with auto compile off and requests no compile after a link, and Python cannot request one (`UNiagaraSystem::RequestCompile` is not exposed): recompile on load, as above, before relying on a link.

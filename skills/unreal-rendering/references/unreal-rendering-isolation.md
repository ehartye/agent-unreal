# Isolating a rendering artifact

Unreal 5.8. Attribute an artifact to one lighting term before changing materials or lighting settings: capture the same camera repeatedly and switch one term off per capture.

## Show flags

Console command `ShowFlag.<Name> 0` turns a term off and `ShowFlag.<Name> 1` turns it on. Names and groups are in `Engine/Source/Runtime/Engine/Public/ShowFlagsValues.inl` in the installed engine.

| Term to switch off | Show flag | Group |
|---|---|---|
| Direct light from lights | `DirectLighting` | Lighting components |
| Indirect lighting | `GlobalIllumination` | Lighting components |
| Lumen global illumination | `LumenGlobalIllumination` | Lighting features |
| Lumen reflections | `LumenReflections` | Lighting features |
| Screen-space reflections | `ScreenSpaceReflections` | Lighting features |
| Reflection captures and sky reflections | `ReflectionEnvironment` | Lighting features |
| Specular response | `Specular` | Lighting components |
| Sky light | `SkyLighting` | Light types |
| Dynamic shadows | `DynamicShadows` | Lighting components |
| Fog | `Fog` | Normal |

- [documented] Installed-source inspection (`ShowFlagsValues.inl:50,88,148,154,158,159,199,293,339,365`): the flags above exist in 5.8. `DirectLighting` is declared fixed in shipping builds (`ShowFlags.h:71–76`), so it can be switched in the editor and in development builds and not in a shipping build.
- [general] A console command changes state for the rest of the run. Each capture therefore sets every flag in the recipe explicitly, on or off, so no capture inherits a flag from the one before.
- [general] Order of work: capture a baseline; capture again with one term off per shot; read which shot removes the artifact; change the setting that term belongs to; capture again and compare with the baseline. Keep the baseline and the final capture from the same camera and the same flags.

## Grazing-angle sheen

- [documented] Installed-source inspection: the Fresnel term is Schlick's (`BRDF.ush`, `F_Schlick`), whose reflectance rises toward 1 as the view or light angle approaches grazing for any base reflectance. For a non-metal the base reflectance is `0.08 * Specular` (`ShadingCommon.ush`, `DielectricSpecularToF0`), so the material Specular value scales the sheen.
- [general] A low sun on rough ground can therefore show a bright, mirror-like sheen with no reflection involved. If switching off direct lighting removes it and switching off reflections does not, lower the Specular of the material before touching reflections or roughness.

Capturing from a native game: [presentation](../../unreal-native/references/unreal-native-presentation.md), [exposure and vertex colour](../../unreal-native/references/unreal-native-exposure-and-vertex-color.md). Lighting systems: [Lumen](unreal-lumen.md), [Virtual Shadow Maps](unreal-virtual-shadow-maps.md).

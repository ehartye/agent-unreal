# Stylized look example scenes (Unreal 5.8)

[`examples/unreal/stylized/`](stylized_validate.mjs) backs the Drawn, ink and cel looks section of [Niagara](../../../skills/unreal-effects/references/unreal-niagara.md) and the Substrate Toon bullets of [Substrate](../../../skills/unreal-rendering/references/unreal-substrate.md). It builds one probe level with six stations (each has its own camera and a backdrop wall) from a throwaway project and measures engine screenshots; no external art.

```text
node examples/unreal/stylized/stylized_validate.mjs --engine "C:/Program Files/Epic Games/UE_5.8" [--keep] [--shots <folder>]
```

It makes a project in the OS temp folder with `r.Substrate=True` and the Blendable GBuffer, plus a bare project, and runs five scripts: `stylized_cvar.py` (what a bare project gets), `stylized_build.py` (commandlet: procedural 4x4 ink-blob flipbook PNG, Toon Profile, Toon and unlit materials, six Niagara systems authored through the toolsets, the level), `stylized_render.py` (offscreen Play-In-Editor, one engine screenshot per look, a simulation-cache read of `SubImageIndex`, compile states) and `stylized_persist.py` twice (write, then read in a new process). About 2.5 minutes on 5.8.2; exit code 0 when all 17 checks pass. Pass `--shots` to copy nine screenshots out. The run is manual; `node scripts/check.mjs` runs only the pure part: `png-tools.mjs` (a small PNG reader, luminance bands, colour counts), `stylized-measure.mjs`, `stylized-validate-checks.mjs` and `stylized-validate.test.mjs`.

Stations and what they showed on 5.8.2:

| Station | Check | Measured |
|---|---|---|
| `meshes`: Toon sphere beside a plain lit sphere | flat bands vs gradient | Toon 2 flat bands (53% of its pixels), plain 0 |
| `toon_masked`, `toon_translucent`: Toon BSDF on a sprite | lit and stepped, same silhouette | 3 and 2 flat bands; both 164,144 sprite pixels; no log errors |
| `drawn`: age-driven flipbook | frames advance | 5 to 7 distinct drawn areas in 8 shots (it varies with capture timing); `SubImageIndex` rose 0.27 to 16.0 in 120 steps (16 distinct frames) |
| `frame_2`, `frame_9`, `frame_13`: SubUV Direct Index | the chosen cell shows | on-screen fill area / cell area spread 0.001 across the three |
| `frame_9` bright and dark | sprite ignores light | same 38,201 pixels and centre colour with sun 10 and a light backdrop vs sun 0 and a dark one |
| `stepped`, `smooth`: floor-quantized ramp | flat bands | 3 bands (Dynamic Material Parameter 3; material default 4) vs 16 luminance levels |

Other results: all six systems compile `UpToDate`; a bare project has `r.Substrate=0` and the Adaptive GBuffer; the Python name `toon_profile_override` does not exist, and a `Set <instance name> ToonProfileOverride` override survived a save and a new editor process (`GetAll` with `-LogCmds="global Log"`). Not run: Toon on the Adaptive GBuffer, linking Direct Frame Index to a user parameter (the frame stayed age-driven), frame cost.

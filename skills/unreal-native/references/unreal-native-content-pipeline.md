# Separate native gameplay from content-only asset construction

Observed in one consuming Unreal **5.8.2 CL56702186** project on Windows; not reproduced in this repo. Read the [native packaging recipe](unreal-native-packaging.md) for receipt staging and its acceptance limits. This is a conventional content-only project feeding a separately compiled native game. It does not require changing host security policy.

## Why the split was used

- [general] Windows Application Control refused the rebuilt game's Editor module (`UnrealEditor-MyGame.dll`) with GetLastError 4551 / HRESULT 0x800711C7. Unchanged retries failed, including a retry after the user accepted App Control prompts. The normal project exited before its MCP server or Python module-check callback started. A compiler success was insufficient evidence of OS load permission.
- [general] A later Game build was also refused despite the earlier Game EXE working. After the user independently changed Smart App Control, the same refused executable started and the existing Editor DLL loaded. Native MCP initialization and StartPIE succeeded; a live scene query returned the named vehicle actors in the PIE world. Historical refusals remain valid evidence; the agent did not change policy. The Editor viewport image showed the empty editor view, so it was not counted as a game-camera frame.
- [general] A separate content-only project with **no Modules entry** loaded the installed Editor, built/saved native materials and font assets, and cooked them. It never renamed, moved or loaded the refused native Editor module. The independently rebuilt native **Game EXE** was allowed and actually rendered the staged game.
- [general] Do not interpret this result as permission to bypass Application Control or as a guarantee that any later executable will be allowed. Preserve policy failures, and test each relevant executable through its normal launch path.

## Keep construction and runtime contracts explicit

- [general] The bake project used the **same basename**, `MyGame.uproject`, under a separate directory. Its descriptor enabled PythonScriptPlugin and EditorScriptingUtilities but declared no native Modules. A Python script read `MY_SOURCE_ROOT` for the original material recipe and bundled fonts, while `unreal.Paths.project_dir()` selected the bake project's output Content/Saved directories.
- [general] Construction config used `GlobalDefaultGameMode=/Script/Engine.GameModeBase` and an Engine entry map for editor startup. The saved map had no native GameMode override. The delivered game instead staged the **real runtime config**, with its native `/Script/MyGame.MyGameMode`. This let the native game construct procedural actors while loading the same cooked `/Game/Art` material/font paths.
- [general] The same project basename preserved cooked `MyGame/Content/...` package paths and the expected pak mount. The native materials, UFont assets and their FontFaces were generated. The native game consumed those real assets; reference screenshots were not used as runtime backplates.

Use the full Editor synchronous Python construction path for the font importer:

```powershell
$previousSourceRoot = $env:MY_SOURCE_ROOT
try {
    $env:MY_SOURCE_ROOT = $sourceRoot
    & "$ueRoot/Engine/Binaries/Win64/UnrealEditor.exe" $contentOnlyProject "-ExecutePythonScript=$sourceRoot/Scripts/build_content.py" -RenderOffScreen -unattended -nullrhi -nosplash -nosound -notraceserver
    if ($LASTEXITCODE -ne 0) { throw 'Asset construction failed' }
    & "$ueRoot/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" $contentOnlyProject -run=Cook -TargetPlatform=Windows -CookAll -SkipZenStore -unversioned -unattended -nullrhi -nosound -notraceserver
    if ($LASTEXITCODE -ne 0) { throw 'Cook failed' }
} finally {
    $env:MY_SOURCE_ROOT = $previousSourceRoot
}
```

Check each native exit code and fresh receipt before proceeding. The [presentation reference](unreal-native-presentation.md) explains the font factory's commandlet/Slate assertion. `-nullrhi` is suitable for asset construction/cook, never for a visual acceptance capture.

## Short paths and repeatable asset reuse

- [general] A deeply nested timestamped bake directory caused an actual Cook filename to reach **262 characters**, failing Windows MAX_PATH 260 validation. A short project-local path such as `Build/ab-e458df02` fixed this without suppressing cook errors. Full dependency cook then completed in seconds on a warm cache; that is an observed timing, not an estimate for a fresh machine.
- [general] The project wrappers added content recipe fingerprints over the font sources, material/builder Python scripts and relevant config, plus fingerprints of the actual cooked files. Reuse checks reject changed recipes, changed cooked assets, failed cooks and a cooked-root/receipt mismatch. Dependency-free tooling tests should exercise these rejection paths.
- [general] Reuse cooked assets for a C++-only Game build only while those inputs remain unchanged. Preserve the original asset receipt independently from the new code build identity. HEAD alone cannot describe a dirty worktree, a previous executable or content generated from another recipe.

## Rigid GLB controls and native WAVs through the same bake

- [general] The full Editor bake imported several Blender GLBs as real StaticMesh assets through `InterchangeManager.import_asset`. A saved `InterchangeGenericAssetsPipeline` used static-mesh combine `ALL`, baked meshes, explicit `IVCIO_REPLACE` vertex colors and disabled material import. `ImportAssetParameters.override_pipelines` received its saved soft object path, not a pipeline object. Each result was deliberately named, assigned the owned material and explicitly saved.
- [general] Native conversion put source glTF +Z on Unreal +Y; an asymmetric part's forward extent and the actual game-camera frame confirmed a single -90-degree component yaw into the actor's +X. A body-origin offset aligned the authored wheel hubs without changing physics. Do not copy these asset-specific transforms to another model without measuring it.
- [general] CPU access was enabled on the imported StaticMeshes before cook. The real Game target read nonwhite native RGBA vertices with baseline wear alpha across the meshes. That establishes retained data; the [presentation reference](unreal-native-presentation.md) records why its material still initially crushed the visible form.
- [general] Mono PCM16/48kHz WAV exports imported through `AssetTools`, with explicit loop/compression settings and saves. WAVs did not use Interchange. Native game receipts confirmed assets, an audio device and bounded engine/one-shot voices; owner listening approval was not inferred.
- [general] Cook reuse hashes included the exact imported GLBs and mesh/audio importer scripts. Editable Blender files, preview renders and transient managed-build locks were excluded. Changing an imported GLB or WAV invalidated reuse; an unrelated draft model did not. An exclusive transient Blender lock had previously broken source hashing before capture, so the exclusion addressed an observed workflow failure.

## Actual second-generation runtime proof

- [general] After the separated bake/cook and native Game build, receipt staging/UnrealPak produced a new Windows folder. The real EXE delivered fresh PNGs and matching JSON for each scenario; the images were opened. A jump scenario sampled zero grounded wheels at altitude. This establishes an airborne sample, not a landing.
- [general] This package retained **visual GAP** status. No full session, physical keyboard/controller input, audible audio, normal-gameplay performance or cross-machine acceptance follows from those offscreen frames. Fixed simulation timestep and short measured frame samples are not performance acceptance.

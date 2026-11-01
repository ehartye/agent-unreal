# Separate native gameplay from content-only asset construction

Observed in one consuming project on an earlier engine build; not reproduced in this repo. Read the [native packaging staging recipe](unreal-native-packaging-staging.md) for receipt staging and its acceptance limits. This is a conventional content-only project feeding a separately compiled native game. It does not require changing host security policy.

## Why the split was used

- [general] Windows Application Control refused the rebuilt game's Editor module (`UnrealEditor-MyGame.dll`) with GetLastError 4551 / HRESULT 0x800711C7. Unchanged retries failed, including a retry after the user accepted App Control prompts. The normal project exited before its MCP server or Python module-check callback started. A compiler success was insufficient evidence of OS load permission.
- [general] A later Game build was also refused despite the earlier Game EXE working. After the user independently changed Smart App Control, the same refused executable started and the existing Editor DLL loaded. Native MCP initialization and StartPIE succeeded; a live scene query returned the named vehicle actors in the PIE world. The agent did not change policy. The Editor viewport image showed the empty editor view, so it was not counted as a game-camera frame.
- [general] A separate content-only project with **no Modules entry** loaded the installed Editor, built/saved native materials and font assets, and cooked them. It never renamed, moved or loaded the refused native Editor module. The independently rebuilt native **Game EXE** was allowed and actually rendered the staged game.
- [general] This is not permission to bypass Application Control, and each later executable needs its own test through its normal launch path. Preserve policy failures.

## Keep construction and runtime contracts explicit

- [general] The bake project used the **same basename**, `MyGame.uproject`, under a separate directory. Its descriptor enabled PythonScriptPlugin and EditorScriptingUtilities but declared no native Modules. A Python script read `MY_SOURCE_ROOT` for the original material recipe and bundled fonts, while `unreal.Paths.project_dir()` selected the bake project's output Content/Saved directories.
- [general] Construction config used `GlobalDefaultGameMode=/Script/Engine.GameModeBase` and an Engine entry map for editor startup. The saved map had no native GameMode override. The delivered game instead staged the **real runtime config**, with its native `/Script/MyGame.MyGameMode`. This let the native game construct procedural actors while loading the same cooked `/Game/Art` material/font paths.
- [general] The same project basename preserved cooked `MyGame/Content/...` package paths and the expected pak mount. The native materials, UFont assets and their FontFaces were generated. The native game consumed those real assets; reference screenshots were not used as runtime backplates.

Historical construction transcript from that project, using the full Editor synchronous Python path for the font importer. For new construction and cook runs, route these arguments through the [shared launcher](unreal-engine-launcher.md) and retain each operation's receipt:

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

## Keep a rebuilt content folder free of constructor-time loads

- [tested] With the editor open on Windows, a C++ actor that loads a mesh and a material in its constructor with `ConstructorHelpers::FObjectFinder` keeps both asset files locked: open for write, rename, overwrite and delete from another process all fail. Python reports `PermissionError: [WinError 32] The process cannot access the file because it is being used by another process` for a delete or rename and `[Errno 13] Permission denied` for an overwrite. The editor loads the class default object at startup, so the lock exists before any level opens.
- [tested] Assets loaded with `LoadObject` in `PostInitializeComponents`, or with `TSoftObjectPtr::LoadSynchronous`, stayed free until an actor ran that function. Spawning the actors in the editor world did not; a Play-In-Editor session did, and those files stayed locked after the session ended and garbage was collected. The locks ended with the editor process.
Do: run a stage that deletes or rewrites a content folder with the editor closed, and keep the folder's assets out of `ConstructorHelpers`. Read a `PermissionError` from the stage as a lock. Example: `examples/unreal/constructor_locks/`.

GLB and WAV imports through the same bake, and the runtime proof: [Content pipeline assets and runtime proof](unreal-native-content-pipeline-assets.md).

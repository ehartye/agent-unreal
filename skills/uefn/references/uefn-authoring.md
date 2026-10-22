# UEFN authoring beyond MCP

Use this when UEFN MCP lacks an operation, animation controls need exact Reset, audio needs importing, or authoring in regular Unreal and porting is proposed. Observed in one consuming UEFN project on UEFN 42.30 and UE 5.8.3; not reproduced in this repo. Re-discover capabilities after upgrades.

## Read next

| You are about to | Read |
|---|---|
| Run Python in the editor: startup scripts, remote execution, launch with a project, operational traps | [Native Python](uefn-native-python.md) |
| Make a Level Sequence, set an exact Reset, or migrate assets from regular UE | [Animation and migration](uefn-animation.md) |
| Save, delete or capture natively | [Native operations](uefn-native-operations.md) |

## Choose the smallest working route

Keep a Fortnite project's playable scene, devices and Verse behavior authoritative in
UEFN. Use available MCP tools; for missing operations, try native editor Python or
ordinary editor actions. Regular UE is an optional asset workshop. This ordering is
a recommendation from one consuming project, not a requirement to reject other workflows.

| Route | Time | Risk | Complexity | Architectural fit | Maintenance |
|---|---|---|---|---|---|
| UEFN MCP plus a small native Python script | One probe, then repeatable batch work | Preview API/validation uncertainty | Low–moderate | Target owns bindings and behavior | One project script |
| Native UEFN editor exemplar | Fast for a few operations | Repeated manual edits | Low initially | Direct target authoring | Document recipe; automate repetition |
| Selective UE asset authoring and migration | Setup and compatibility proof | Versions, dependencies, actor bindings | Moderate | Separate asset workshop | Second project and upgrade checks |
| Whole level in UE, then port | Most adaptation work | Unsupported assets/gameplay | High | Two scene representations | Ongoing conversion work |

## Capability discovery: do not confuse transport with editor support

[general] UEFN exposes MCP wrappers `list_toolsets`, `describe_toolset`
and `call_tool`. Discover the live schemas; regular UE tool names and argument
shapes are not a UEFN contract. With AllToolsets mounted in the observed 42.30 build,
Sequencer and Sequencer Keyframing toolsets were absent. Audio import was also
absent. Do not send the user searching for an unverified toggle after this check.

The MCP script sandbox allowed `json`, `re`, `math`, `copy`, `time`, `datetime`
and registered tools; it could not import `unreal`. Do not treat native Python
documentation as permission to bypass that sandbox. Native editor Python is a
separate, Epic-documented entrypoint.

[documented] [UEFN Python](https://dev.epicgames.com/documentation/en-us/fortnite/python-tools-in-uefn)
supports imports, scene automation and remote execution in early preview. It links
[Unreal Python execution](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python),
which describes File > Execute Python Script and Output Log Cmd mode:

```text
py "C:/path/to/project_script.py"
```

Preflight required APIs and the active project before edits. UEFN validation can
reject Python-created content; restrict changes to project assets and properties
available in its UI. A successful Python call is not validation or runtime proof.
Before asking the user to execute scripts manually, check the routes in [native Python](uefn-native-python.md).
If an editor action is needed, prepare its exact script and expected receipt first.

## Audio: import rendered files directly

Agent Beeps supplies rendered WAVs; its browser synth is not the Fortnite audio
runtime. [Native UEFN import](https://dev.epicgames.com/documentation/en-us/fortnite/importing-custom-audio-in-unreal-editor-for-fortnite)
supports WAV through Import or Content Browser drag/drop. Use Sound Wave/Sound Cue
and Audio Player as appropriate; verify looping and volume in the target session.
[general] In 42.30, SoundFactory plus AssetImportTask imported approved WAVs,
created their direct looping Wave Player Cues and saved only the new packages.
The [native-audio reference](uefn-native-audio.md) covers the source checks,
pending receipts, task-result omission and independent metadata/package verification.
This removes the need for manual dragging when the native connection is available.
Auto Reimport did not create WAV assets in the earlier local test; repeating it
or introducing a second UE project is not a necessary prerequisite for audio.
For an initial score, one auditioned loop is enough to prove delivery. Stems and
adaptive scheduling should follow a musical or gameplay need.

## Bounded proof and reporting

Reuse one imported clip and actor. Create, save and reopen one sequence; inspect
start/middle/end poses. Configure controls and optionally import an existing short
WAV independently. If Python fails, record the exact failure and use one native
editor exemplar. Try UE staging when native authoring fails or repeated work
justifies its cost. Stop broad workflow research after a reproducible validated
authoring path exists; keep runtime acceptance open until observed in Fortnite.

Report separately: files exported, assets imported/saved, editor appearance,
validation, runtime behavior and listener audition. The observed project verified
export/import, editor appearance, project startup, native remote execution,
scoped native saves and saved Sequence evaluation. After an earlier client
disconnection, automatic startup and controller checks passed in Fortnite,
followed by a normal push with QA disabled. Physical button
use, rendered reset poses, completed-clip reset, audible audio, multiplayer and performance
remain unverified. Native audio import/save and personal playback preparation are
verified separately; a later launch reached server cook but ended without a connected
game client. The [operations reference](uefn-native-operations.md) records
those operational checks and their limits.

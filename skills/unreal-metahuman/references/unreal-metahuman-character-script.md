# Script the character: create, edit, commit, auto-rig, textures

Unreal 5.8 on Windows, MetaHuman Character plugin. [tested] lines are probe results dated 2026-10-29 on one machine in a windowed editor, each naming its runs (a person was at the first launch of each run). [documented] lines name Epic's page. What the cloud and the sign-in need is in [Cloud and setup](unreal-metahuman-cloud-and-setup.md); building the character into assets is in [Assemble and spawn](unreal-metahuman-assemble-and-spawn.md).

## Create from a preset

- [tested] Runs 1 to 4: a character was created by copying one of the 29 installed preset assets (the preset Ada) into the project with `unreal.EditorAssetLibrary.duplicate_asset`.
- [general] The probe copied the asset instead of calling the editor's own preset call, which its author took not to be exposed to Python. No run checked that, so list the subsystem's members in the install before choosing.
- [documented] Epic ships runnable examples and tests with the plugin at `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/`: an `examples/` folder, one script per task, and `test_*.py` files that exercise the API. `examples/example_create_asset.py` creates a new asset from Python. Source: Epic's page "MetaHuman Creator Python Scripting in Unreal Engine", Reference Scripts and The MetaHuman Character Asset.
- [general] Read the example script for the task before writing one, and list the class members in the install (`dir(unreal.MetaHumanCharacterEditorSubsystem)`) because Epic's names changed between 5.7 and 5.8.
- [general] Not established: a character from a non-preset source, such as an empty asset from the factory, a conform from DNA or a scanned mesh, or a Mesh to MetaHuman result. Only a preset copy was run.

## Register, edit, commit, remove

- [documented] Register the character with `try_add_object_to_edit(character)`, edit through the subsystem, commit each domain, then `remove_object_to_edit(character)`. Opening the asset in the editor registers it automatically. Source: the same page, The MetaHuman Character Editor Subsystem.
- [documented] Subsystem edits go to an internal preview state until committed. `commit_face_state(character)` and `commit_body_state(character)` take only the character, because the state was staged by earlier calls such as `translate_face_landmarks`. The eyes, makeup, skin and head-model commits take a settings struct. Source: the same page, Commit Changes.
- [documented] Many properties (skin, eyes, makeup, viewport settings, the wardrobe collection) can be written on the asset without registering it, which Epic calls the right choice for headless or batch scripts that do not open the character. Source: the same page, The MetaHuman Character Asset.
- [tested] Runs 1 to 4 (the create checks passed each time; the details are from runs 1 and 4): `try_add_object_to_edit` returned true for the copied preset; `get_face_landmarks` and `translate_face_landmarks` moved 79 landmarks; `commit_face_state` and `commit_body_state` ran; `remove_object_to_edit` ran.
- [general] Remove the character from the subsystem even when an edit fails, so the subsystem does not hold its state for the rest of the session.

## Auto-rig and textures

- [documented] `request_auto_rigging(character, params)` uses `MetaHumanCharacterAutoRiggingRequestParams`: `blocking`, `report_progress` and `rig_type`, one of `MetaHumanRigType.JOINTS_ONLY` or the joints-and-blendshapes value. `request_texture_sources(character, params)` uses `MetaHumanCharacterTextureRequestParams` with `blocking` and `report_progress`. `remove_face_rig(character)` removes the rig without resetting the face mesh. Source: the same page, Download Textures and Auto-Rig.
- [tested] Runs 1 to 4: both requests ran with `blocking = True` and `report_progress = False`, with `rig_type` set to `JOINTS_ONLY`. Auto-rigging took 150.7 s the first time (run 1, with the one sign-in) and 10.8 to 12.9 s in the six later requests (run 1's repeat launch, run 2, run 3's two launches, run 4's two launches); textures 12.7 s, then 8.7 to 11.6 s. The joints-and-blendshapes rig type was not run.
- [tested] Runs 1 to 4: the probe used no rig-state getter. The read-back it used was `character.has_high_resolution_textures` and `subsystem.can_build_meta_human(character)`; both were true after the two requests. The texture information structs held 9 face and 11 body entries (runs 1 and 4).
- [tested] Run 1: a blocking cloud call does not return control to the script, but the editor kept ticking Slate. The probe's tick handler, which advanced its own state machine, re-entered it during the call, and the launch failed with `ValueError: generator already executing`; runs 2 to 4 used a guarded handler.
- [general] Guard any editor tick callback against re-entry before a blocking call, set a timeout around the whole run, and write a progress file after each stage so a stall is visible from outside.

## Not run: wardrobe, conform, export

- [documented] Grooms and clothing use the Pipeline slot system: register the item with `character.internal_collection.try_add_item_from_wardrobe_item(slot_name, item)`, build a `MetaHumanPipelineSlotSelection`, then `default_instance.try_add_slot_selection(selection)`. Examples: `example_add_grooms.py`, `example_add_clothing.py`. Source: the same page, Configure Outfits and Grooms. Not run.
- [documented] The face and body conform from DNA, a template mesh, vertex arrays or an Identity, and a custom mesh pipeline, each with an example script. The 5.8 release renamed the stepwise body-conform functions, and `example_conform_body.py` is out of date. Source: the same page, Migration Notes. Not run.
- [documented] Export is a separate Blueprint function library, `MetaHumanCharacterExportBlueprintLibrary`, with `export_dcc`, `export_dna`, `export_geometry` and `export_materials`. It needs a rigged character with high-resolution textures; `export_geometry` also needs the character open for editing. Source: the same page, Export Tools. Not run: not established.
- [general] DNA moves in and out of the character with `import_from_face_dna` and `export_dna`; the DNA format and the face rig standard are in [Driving the face](unreal-metahuman-face.md). A model from agent-meshes is not a MetaHuman; Epic's tools do not recognise it (see mesh-rigging for its ARKit face rig).

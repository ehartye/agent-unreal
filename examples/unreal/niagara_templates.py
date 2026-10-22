"""List the description Epic ships with each Niagara template system (Unreal 5.8, editor Python).

Each template system carries a one-line `template_asset_description`, which the editor shows in its New System picker. This writes
them to a JSON report, one entry per system, so the catalog in the Niagara templates reference can be reproduced:
  UnrealEditor-Cmd.exe Project.uproject -run=pythonscript -script=<this file> -unattended -nullrhi -nosplash -nopause -nosound -notraceserver
The project needs PythonScriptPlugin, EditorScriptingUtilities, Niagara and NiagaraFluids. Set NIAGARA_TEMPLATES_REPORT for the output
(an absolute path; default Saved/niagara-templates.json in the project, because a relative path lands in the engine's binaries folder).
"""
import json
import os

import unreal

FOLDERS = [
    "/NiagaraFluids/Templates/Gas/2D/Systems",
    "/NiagaraFluids/Templates/Gas/3D/Systems",
    "/NiagaraFluids/Templates/Liquid/3D/Systems",
    "/NiagaraFluids/Templates/Sand/Systems",
    "/Niagara/DefaultAssets/Templates/Systems",
]

unreal.AssetRegistryHelpers.get_asset_registry().search_all_assets(True)
report = {"engine": unreal.SystemLibrary.get_engine_version(), "templates": {}}
for folder in FOLDERS:
    for path in sorted(unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False)):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not asset or asset.get_class().get_name() != "NiagaraSystem":
            continue
        try:
            description = str(asset.get_editor_property("template_asset_description"))
        except Exception as exc:   # an engine version without the property
            description = "unavailable: " + str(exc)[:80]
        report["templates"][path.split(".")[0]] = " ".join(description.split())

out = os.environ.get("NIAGARA_TEMPLATES_REPORT") or os.path.join(unreal.SystemLibrary.get_project_directory(), "Saved", "niagara-templates.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as fh:
    json.dump(report, fh, indent=2)
unreal.log("[niagara_templates] %d systems, wrote %s" % (len(report["templates"]), out))

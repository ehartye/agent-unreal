"""Question 1, the container half: make a widget animation inside a saved Widget Blueprint with editor Python and try to link it. Run through the stage script's rpc mode
(umg-hold.mjs pyCall), which supplies `unreal` and takes `result`. The runner puts ASSET, ANIM_NAME and TEXT_WIDGET in front of this text.

What it does: load the blueprint; make a WidgetAnimation and a MovieScene as sub-objects of it; try every way the editor's scripting reaches to put the movie scene on the
animation and the animation in the blueprint's animation list (the properties are not reflected for scripts); then try the Sequencer scripting on the animation (add a
possessable for the text block, add a float track). Each step is recorded with its result or its error text, word for word.
"""
import json
import traceback

steps = []


def step(name, fn):
    try:
        value = fn()
        if value is False:   # a call that returns False did not do what it was asked
            steps.append({"step": name, "ok": False, "error": "returned False"})
        else:
            steps.append({"step": name, "ok": True, "value": str(value)[:300]})
        return value
    except Exception:
        steps.append({"step": name, "ok": False, "error": traceback.format_exc().strip().splitlines()[-1][:400]})
        return None


blueprint = step("load the Widget Blueprint", lambda: unreal.EditorAssetLibrary.load_asset(ASSET))
animation = step("new_object WidgetAnimation inside the blueprint", lambda: unreal.new_object(unreal.WidgetAnimation, blueprint, ANIM_NAME))
scene = step("new_object MovieScene inside the animation", lambda: unreal.new_object(unreal.MovieScene, animation, "MovieScene"))
step("animation.set_editor_property('movie_scene')", lambda: animation.set_editor_property("movie_scene", scene))
step("ToolsetLibrary.set_object_properties(animation, MovieScene)", lambda: unreal.ToolsetLibrary.set_object_properties(animation, json.dumps({"MovieScene": {"refPath": scene.get_path_name()}}), unreal.BypassContainerCheck.YES))
step("blueprint.set_editor_property('animations')", lambda: blueprint.set_editor_property("animations", [animation]))
step("ToolsetLibrary.set_object_properties(blueprint, Animations)", lambda: unreal.ToolsetLibrary.set_object_properties(blueprint, json.dumps({"Animations": [{"refPath": animation.get_path_name()}]}), unreal.BypassContainerCheck.YES))
step("blueprint.get_editor_property('animations')", lambda: blueprint.get_editor_property("animations"))
step("animation.get_movie_scene()", lambda: animation.get_movie_scene())
text = step("find the text block", lambda: unreal.load_object(None, TEXT_WIDGET))
step("animation.add_possessable(text block)", lambda: animation.add_possessable(text))
step("animation.add_track(MovieSceneFloatTrack)", lambda: animation.add_track(unreal.MovieSceneFloatTrack))
step("animation.get_possessables()", lambda: animation.get_possessables())
result = {"steps": steps, "animation": animation.get_path_name() if animation else None, "movie_scene": scene.get_path_name() if scene else None}

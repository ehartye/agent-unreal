"""Bounded skeleton, scale, material and component experiments. Engine names come from installed headers.
MU_GROUP selects one question; dependencies have imported the agent-meshes parts.
"""
import ctypes
import json
import os
import struct
import sys
import threading
import time
import traceback
import unreal

sys.path.insert(0, os.environ["MU_PROBE_DIR"])
os.environ["MU_LIBRARY_ONLY"] = "1"
import mu_probe_common as c
import mu_probe_graph as g
import mu_probe_variants as v

GROUP = os.environ["MU_GROUP"]
probe = c.Probe(GROUP)
bridge = unreal.MutableBridgeLibrary
retained = []
active_builder = None


def compile_object(co, label, level=None):
    record = {"label": label}
    try:
        yield from c.run_compile(co, record, level)
    except Exception:
        record["error"] = traceback.format_exc()[-1200:]
    probe.step("compile", **record)
    probe.write()
    return record


def graph(path, body, groups, components=1, material=None, texture=None):
    """One fixed body, independent enum groups, all sections; optionally a material parameter."""
    global active_builder
    co = g.new_co(path)
    retained.append(co)
    b = g.Builder(co)
    active_builder = b
    section_keys = {}
    part_list = [body] + [p for _, parts in groups for p in parts]
    for i, part in enumerate(part_list):
        key = part["id"]
        node = b.add("mesh_"+key, g.MESH_NODE, -1400, i*260, {"SkeletalMesh":part["mesh"].get_path_name()})
        pins = [str(p.name) for p in bridge.get_node_pins(node) if str(p.direction)=="Output" and str(p.category)=="mesh" and not p.hidden and not p.orphaned]
        section_keys[key] = []
        for k, pin in enumerate(pins):
            sk = "section_%s_%d" % (key,k)
            b.add(sk,g.SECTION_NODE,-1100,i*260+k*70)
            b.link("mesh_"+key,sk,"mesh","mesh",out_name=pin)
            section_keys[key].append(sk)
    if texture is not None:
        b.add("texture", "CustomizableObjectNodeTextureParameter", -1400, -300,
              {"ParameterName":"Finish","DefaultValue":texture.get_path_name(),"ReferenceValue":texture.get_path_name()})
        probe.step("texture_node", pins=g.pin_summary(b.nodes["texture"]))
        for keys in section_keys.values():
            for key in keys:
                for property_name,value in (("Material",material.get_path_name()),("TextureParametersMode","Mutable")):
                    result=bridge.set_node_property(b.nodes[key],property_name,value)
                    b.record("set %s.%s" % (key,property_name),result.ok,result.message)
                b.link("texture",key,"image","image",in_name="Tint")
    elif material is not None:
        b.add("material", "CustomizableObjectNodeMaterialParameter", -1400, -300,
              {"ParameterName":"Finish","DefaultValue":material.get_path_name(),"ReferenceValue":material.get_path_name()})
        probe.step("material_node", pins=g.pin_summary(b.nodes["material"]))
        for keys in section_keys.values():
            for key in keys:
                b.link("material",key,"materialAsset","materialAsset")
    outputs = list(section_keys[body["id"]])
    for group_index,(parameter,parts) in enumerate(groups):
        pk = "param_%d" % group_index
        b.add(pk,g.ENUM_NODE,-1000,-300-group_index*160,
              {"ParameterName":parameter,"Values":"(%s)" % ",".join('(Name="%s")' % p["option"] for p in parts),"DefaultIndex":"0"})
        for k in range(max(len(section_keys[p["id"]]) for p in parts)):
            key="switch_%d_%d" % (group_index,k)
            b.add(key,g.SWITCH_NODE,-700,group_index*400+k*100,{"PinType":"material"})
            b.link(pk,key,"enum","enum")
            for part in parts:
                if k < len(section_keys[part["id"]]):
                    b.link(section_keys[part["id"]][k],key,"material","material",in_name=part["option"])
            outputs.append(key)
    b.nodes["base"] = next(n.node for n in bridge.get_graph_nodes(co) if str(n.class_name)==g.OBJECT_NODE)
    for index in range(components):
        mk, om, ck = ["%s_%d" % (s,index) for s in ("make","object_make","component")]
        b.add(mk,g.MAKE_NODE,-350,index*500)
        for source in outputs:
            b.link(source,mk,"material","material")
        b.add(om,g.OBJECT_MAKE_NODE,-50,index*500)
        b.link(mk,om,"skeletalMesh","skeletalMesh")
        b.add(ck,g.COMPONENT_NODE,250,index*500,{"ReferenceSkeletalMesh":body["mesh"].get_path_name(),"ComponentName":"Component%d" % index})
        b.link(om,ck,"passThroughSkeletalMesh","passThroughSkeletalMesh")
        b.link(ck,"base","component","component")
    probe.step("graph", path=path, part_count=len(part_list),groups=[{"name":n,"options":[p["option"] for p in ps]} for n,ps in groups],
               components=components, ops=b.ops, state=g.graph_state(co))
    return co


def selected_parts():
    parts=g.asset_parts()
    body=next(p for p in parts if p["id"]=="person_body")
    hats=[next(p for p in parts if p["id"]==name) for name in ("hat_cap","hat_tall")]
    if any(p["mesh"] is None for p in [body]+hats):
        raise RuntimeError("body/cap/tall skeletal imports missing")
    return parts,body,hats


def import_shared(original):
    imported=[]
    skeleton=None
    for part in original:
        spec=next(p for p in g.PARTS if p["id"]==part["id"])
        pipeline=unreal.AssetToolsHelpers.get_asset_tools().create_asset("P_shared_"+part["id"],"/Game/Pipelines",unreal.InterchangeGenericAssetsPipeline,None)
        pipeline.get_editor_property("mesh_pipeline").set_editor_property("combine_skeletal_meshes_behavior",unreal.InterchangeCombineSkeletalMeshesBehavior.BY_SKELETON)
        if skeleton is not None:
            pipeline.get_editor_property("common_skeletal_meshes_and_animations_properties").set_editor_property("skeleton",skeleton)
        c.eal.save_loaded_asset(pipeline,only_if_is_dirty=False)
        params=unreal.ImportAssetParameters()
        params.is_automated=True
        params.override_pipelines=[unreal.SoftObjectPath(pipeline.get_path_name())]
        dest="/Game/Mu/Shared/"+part["id"]
        ok=unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(dest,unreal.InterchangeManager.create_source_data(spec["path"]),params)
        c.eal.save_directory(dest,only_if_is_dirty=False,recursive=True)
        meshes=[c.eal.load_asset(str(p)) for p in c.eal.list_assets(dest,recursive=True,include_folder=False)]
        mesh=next(m for m in meshes if isinstance(m,unreal.SkeletalMesh))
        actual=mesh.get_editor_property("skeleton")
        if skeleton is None:skeleton=actual
        imported.append({**part,"mesh":mesh})
        probe.step("shared_import", id=part["id"],returned=bool(ok),skeleton=actual.get_path_name(),expected_skeleton=skeleton.get_path_name(),matches=actual==skeleton)
    return imported


def capture(co, label, options, parameter="Hat", materials=None, texture_mode=False):
    inst=co.create_instance()
    retained.append(inst)
    v.build_level()
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
    started=time.monotonic()
    while v.game_world() is None and time.monotonic()-started<60:yield 0.5
    world=v.game_world()
    if world is None:raise RuntimeError("PIE world unavailable after 60s")
    yield 8.0
    for pawn in unreal.GameplayStatics.get_all_actors_of_class(world,unreal.DefaultPawn):pawn.set_actor_hidden_in_game(True)
    for cmd in ("r.AntiAliasingMethod 0","r.ScreenPercentage 100","r.MotionBlurQuality 0"):
        unreal.SystemLibrary.execute_console_command(world,cmd)
    actor=v.by_label(world,unreal.CustomizableSkeletalMeshActor,"Mu_Actor")
    component=actor.get_component_by_class(unreal.CustomizableSkeletalComponent)
    component.set_component_name(co.get_component_name(0))
    component.set_customizable_object_instance(inst)
    unreal.GameplayStatics.get_player_controller(world,0).set_view_target_with_blend(v.by_label(world,unreal.CameraActor,"Mu_Cam"),0)
    control=label+"_control.png"
    probe.step("control",label=label,shot=control)
    unreal.AutomationLibrary.take_high_res_screenshot(1280,720,control)
    yield 3.0
    v.by_label(world,unreal.SkeletalMeshActor,"Mu_Control").set_actor_hidden_in_game(True)
    for index,option in enumerate(options):
        if materials is None:
            setter=getattr(inst,"set_enum_parameter_selected_option",None) or inst.set_int_parameter_selected_option
            getter=getattr(inst,"get_enum_parameter_selected_option",None) or inst.get_int_parameter_selected_option
            setter(parameter,option)
            selected=str(getter(parameter))
        else:
            setter=inst.set_texture_parameter_selected_option if texture_mode else inst.set_material_parameter_selected_option
            getter=inst.get_texture_parameter_selected_option if texture_mode else inst.get_material_parameter_selected_option
            setter(parameter,materials[index])
            selected=getter(parameter).get_path_name()
        inst.update_skeletal_mesh_async(True,True)
        yield 12.0
        shot=label+"_"+str(index)+".png"
        probe.step("variant",label=label,option=option,selected=selected,expected_asset=materials[index].get_path_name() if materials else None,has_skeletal_mesh=bool(inst.has_any_skeletal_mesh()),shot=shot)
        unreal.AutomationLibrary.take_high_res_screenshot(1280,720,shot)
        yield 3.0
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
    yield 4.0


class MemorySamples:
    """Win32 samples of this editor PID only, at one-second intervals plus endpoints."""
    def __init__(self):self.samples=[];self.stop=threading.Event()
    def sample(self):
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[("cb",wintypes.DWORD),("PageFaultCount",wintypes.DWORD)]+[(n,ctypes.c_size_t) for n in ("PeakWorkingSetSize","WorkingSetSize","QuotaPeakPagedPoolUsage","QuotaPagedPoolUsage","QuotaPeakNonPagedPoolUsage","QuotaNonPagedPoolUsage","PagefileUsage","PeakPagefileUsage")]
        counters=Counters();counters.cb=ctypes.sizeof(counters)
        kernel=ctypes.WinDLL("kernel32",use_last_error=True)
        kernel.GetCurrentProcess.restype=wintypes.HANDLE
        api=ctypes.WinDLL("psapi",use_last_error=True).GetProcessMemoryInfo
        api.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
        if not api(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb):raise ctypes.WinError(ctypes.get_last_error())
        self.samples.append({"monotonic_s":time.monotonic(),"pid":os.getpid(),"working_set_bytes":counters.WorkingSetSize,"process_peak_working_set_bytes":counters.PeakWorkingSetSize})
    def begin(self):
        self.sample()
        def collect():
            while not self.stop.wait(1.0):self.sample()
        self.thread=threading.Thread(target=collect,daemon=True);self.thread.start()
    def finish(self):
        self.stop.set();self.thread.join(2);self.sample()
        return {"pid":os.getpid(),"interval_s":1,"samples":self.samples,"peak_sampled_working_set_bytes":max(x["working_set_bytes"] for x in self.samples),"process_peak_working_set_bytes":max(x["process_peak_working_set_bytes"] for x in self.samples)}


def skeleton_task():
    _,body,hats=selected_parts()
    for label in ("separate","shared"):
        try:
            chosen=[body]+hats if label=="separate" else import_shared([body]+hats)
            probe.step("skeletons",label=label,paths=[p["mesh"].get_editor_property("skeleton").get_path_name() for p in chosen])
            co=graph("/Game/Mu/CO_"+label,chosen[0],[("Hat",chosen[1:])])
            record=yield from compile_object(co,label)
            probe.step("readback",label=label,**c.read_back(co))
            if record.get("timed_out"):return
            if record.get("compiled"):yield from capture(co,label,[p["option"] for p in chosen[1:]])
        except Exception:
            probe.step("layout_error",label=label,error=traceback.format_exc()[-2200:],ops=active_builder.ops if active_builder else [])
            unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
            yield 4.0


def scale_task():
    parts,body,_=selected_parts()
    groups=[]
    for index in range(4):
        chosen=[p for p in parts if p["id"].startswith("group%d_" % index)]
        if len(chosen)!=6:raise RuntimeError("scale needs exactly six options per group")
        groups.append(("Choice%d" % index,chosen))
    co=graph("/Game/Mu/CO_Scale",body,groups)
    for name in ("NONE","MAXIMUM"):
        memory=MemorySamples();memory.begin()
        try:
            record=yield from compile_object(co,name,getattr(unreal.CustomizableObjectOptimizationLevel,name))
        finally:
            probe.step("memory",label=name,**memory.finish())
        probe.step("readback",label=name,**c.read_back(co))
        probe.write()
        if record.get("timed_out"):return


def make_material(name,color,texture=None):
    material=unreal.AssetToolsHelpers.get_asset_tools().create_asset(name,"/Game/Mu/Materials",unreal.Material,unreal.MaterialFactoryNew())
    material.set_editor_property("shading_model",unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("used_with_skeletal_mesh",True)
    kind=unreal.MaterialExpressionTextureSampleParameter2D if texture else unreal.MaterialExpressionConstant3Vector
    expr=unreal.MaterialEditingLibrary.create_material_expression(material,kind,-200,0)
    if texture:
        expr.set_editor_property("parameter_name","Tint")
        expr.set_editor_property("texture",texture)
    else:expr.set_editor_property("constant",unreal.LinearColor(*color,1))
    unreal.MaterialEditingLibrary.connect_material_property(expr,"RGB" if texture else "",unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material)
    c.eal.save_loaded_asset(material,only_if_is_dirty=False)
    return material


def make_texture(name,rgb):
    """A generated 8x8 solid TGA, imported by the rendering editor's existing AssetTools route."""
    path=os.path.join(os.path.dirname(os.environ["MU_REPORT"]),name+".tga")
    with open(path,"wb") as out:
        out.write(struct.pack("<BBBHHBHHHHBB",0,0,2,0,0,0,0,0,8,8,24,32))
        out.write(bytes(reversed(rgb))*64)
    task=unreal.AssetImportTask()
    task.filename=path;task.destination_path="/Game/Mu/Textures";task.automated=True;task.save=True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return c.eal.load_asset(task.imported_object_paths[0])


def material_task():
    _,body,hats=selected_parts()
    mats=[make_material("M_Red",(1,0.02,0.02)),make_material("M_Blue",(0.02,0.04,1))]
    yield 10.0
    probe.step("material_attempt",class_name="CustomizableObjectNodeMaterialParameter",functions_added=[])
    texture_mode=False
    try:
        co=graph("/Game/Mu/CO_Material",body,[("Hat",hats)],material=mats[0])
    except g.Stop:
        probe.step("material_unreachable",error=traceback.format_exc()[-2200:],ops=active_builder.ops)
        mats=[make_texture("T_Red",(255,5,5)),make_texture("T_Blue",(5,10,255))]
        texture_material=make_material("M_Texture",None,mats[0])
        yield 10.0
        probe.step("texture_fallback",class_name="CustomizableObjectNodeTextureParameter",functions_added=[])
        co=graph("/Game/Mu/CO_Texture",body,[("Hat",hats)],material=texture_material,texture=mats[0])
        texture_mode=True
    probe.step("parameter_route",kind="texture" if texture_mode else "material")
    record=yield from compile_object(co,"material")
    probe.step("readback",label="material",**c.read_back(co))
    if record.get("compiled"):
        yield from capture(co,"material",["Red","Blue"],"Finish",mats,texture_mode)


def components_task():
    _,body,hats=selected_parts()
    record={}
    try:
        co=graph("/Game/Mu/CO_Components",body,[("Hat",hats)],components=2)
        record=yield from compile_object(co,"components")
        probe.step("readback",label="components",names=[str(co.get_component_name(i)) for i in range(co.get_component_count())],**c.read_back(co))
    except Exception:
        probe.step("component_error",error=traceback.format_exc()[-2200:],ops=active_builder.ops if active_builder else [])
    probe.step("lod",status="reachable but not run",header="CONodeSkeletalMeshMake_V2::AllocateDefaultPins; LOD construction is outside the chosen second-component route")
    if record.get("timed_out"):
        probe.step("callback",bound=False,error="not attempted: component compile reached its limit; no further compile in this process")
        return
    if not record.get("compiled"):
        co=graph("/Game/Mu/CO_Callback",body,[("Hat",hats)])
        callback_compile=yield from compile_object(co,"callback_baseline")
        if not callback_compile.get("compiled"):
            probe.step("callback",bound=False,error="not attempted: independent baseline did not compile")
            return
    inst=co.create_instance();retained.append(inst)
    callbacks=[]
    def updated(instance):
        callbacks.append({"instance":instance.get_path_name(),"at":time.monotonic()})
        unreal.log("[mu_components] UpdatedDelegate callback instance="+instance.get_path_name())
    try:
        delegate=inst.get_editor_property("updated_delegate")
        delegate.add_callable(updated)
        retained.extend([delegate,updated])
        inst.update_skeletal_mesh_async(True,True)
        start=time.monotonic()
        while not callbacks and time.monotonic()-start<30:yield 0.5
        probe.step("callback",route="updated_delegate.add_callable",bound=True,callbacks=callbacks,has_skeletal_mesh=bool(inst.has_any_skeletal_mesh()))
    except Exception:
        probe.step("callback",bound=False,error=traceback.format_exc()[-1200:],instance_update_delegate_present=hasattr(unreal,"InstanceUpdateDelegate"))


def task():
    probe.step("source",group=GROUP,compile_limit_s=c.COMPILE_TIMEOUT_S)
    try:
        yield from {"skeleton":skeleton_task,"scale":scale_task,"material":material_task,"components":components_task}[GROUP]()
    except Exception:
        probe.step("experiment_error",error=traceback.format_exc()[-2200:],ops=active_builder.ops if active_builder else [])

c.drive(probe,task)

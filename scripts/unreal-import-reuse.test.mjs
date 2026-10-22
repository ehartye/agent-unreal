import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { importGlb } from '../skills/unreal-import/scripts/unreal-import.mjs';

function put(path, data) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
function glb(width = 1) {
  const json = Buffer.from(JSON.stringify({asset:{version:'2.0'},extras:{width}}).padEnd(100, ' '));
  const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2,4); header.writeUInt32LE(20+json.length,8); header.writeUInt32LE(json.length,12); header.writeUInt32LE(0x4e4f534a,16);
  return Buffer.concat([header,json]);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(),'engine-import-'));
  put(join(root,'Project/Test.uproject'),JSON.stringify({FileVersion:3,Plugins:[{Name:'PythonScriptPlugin',Enabled:true},{Name:'EditorScriptingUtilities',Enabled:true}]}));
  put(join(root,'Project/Config/DefaultEngine.ini'),'[/Script/EngineSettings.GameMapsSettings]\n');
  put(join(root,'UE/Engine/Build/Build.version'),JSON.stringify({MajorVersion:5,MinorVersion:8,PatchVersion:2,Changelist:56702186}));
  put(join(root,'UE/Engine/Binaries/Win64/UnrealEditor.exe'),'editor-v1');
  put(join(root,'UE/Engine/Binaries/Win64/UnrealEditor-InterchangeEngine.dll'),'importer-v1');
  put(join(root,'model.glb'),glb());
  put(join(root,'import.json'),JSON.stringify({source:'model.glb',project:'Project/Test.uproject',engine:'UE',destination:'/Game/Generated/Example',options:{}}));
  // A separate process writes packages and the native report, exercising the real filesystem boundary.
  put(join(root,'collaborator.mjs'),`import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
const r=JSON.parse(readFileSync(process.argv[2],'utf8')); mkdirSync(r.outputDirectory,{recursive:true});
for(const f of ['Mesh.uasset','Mesh.uexp','Materials/Ink.uasset','Skeleton.uasset']) { const p=join(r.outputDirectory,f);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,readFileSync(r.source)); }
appendFileSync(${JSON.stringify(join(root,'launches'))},'launch\\n');writeFileSync(r.report,JSON.stringify({ok:true,operation:r.operation,destination:r.destination,engine:'5.8.2',assets:['/Game/Generated/Example/Mesh','/Game/Generated/Example/Materials/Ink','/Game/Generated/Example/Skeleton']}));`);
  const runEditor = async request => {
    put(join(root,'request.json'),JSON.stringify(request));
    const child=spawnSync(process.execPath,[join(root,'collaborator.mjs'),join(root,'request.json')],{encoding:'utf8'});
    if(child.status!==0) throw new Error(child.stderr); return {code:0};
  };
  const execute = options => importGlb(join(root,'import.json'),{...options,runEditor});
  const output = join(root,'Project/Content/Generated/Example');
  const launches = () => existsSync(join(root,'launches')) ? readFileSync(join(root,'launches'),'utf8').trim().split('\n').length : 0;
  return {root,execute,output,launches};
}

test('cold imports every generated package; unchanged skips the Editor; force regenerates',async()=>{
  const f=fixture(); const cold=await f.execute({ifChanged:true}); assert.equal(cold.status,'built'); assert.equal(cold.outputs.length,4);
  const warm=await f.execute({ifChanged:true}); assert.equal(warm.status,'reused'); assert.equal(f.launches(),1);
  assert.equal((await f.execute({force:true})).status,'built'); assert.equal(f.launches(),2);
});
test('delivered GLB, project config and importer bytes each invalidate reuse',async()=>{
  const f=fixture(); await f.execute({ifChanged:true});
  put(join(f.root,'model.glb'),glb(2)); assert.equal((await f.execute({ifChanged:true})).status,'built');
  put(join(f.root,'Project/Config/DefaultEngine.ini'),'new config'); assert.equal((await f.execute({ifChanged:true})).status,'built');
  put(join(f.root,'UE/Engine/Binaries/Win64/UnrealEditor-InterchangeEngine.dll'),'importer-v2'); assert.equal((await f.execute({ifChanged:true})).status,'built'); assert.equal(f.launches(),4);
});
test('missing outputs invalidate; owner edits and unowned outputs conflict even with force',async()=>{
  const f=fixture(); await f.execute({ifChanged:true}); unlinkSync(join(f.output,'Mesh.uexp'));
  assert.equal((await f.execute({ifChanged:true})).status,'built');
  put(join(f.output,'Materials/Ink.uasset'),'owner edit'); await assert.rejects(f.execute({force:true}),/OUTPUT_CONFLICT/); assert.equal(f.launches(),2);
  assert.equal(readFileSync(join(f.output,'Materials/Ink.uasset'),'utf8'),'owner edit');
  const g=fixture(); await g.execute({}); put(join(g.output,'Notes.txt'),'unowned'); await assert.rejects(g.execute({force:true}),/OUTPUT_CONFLICT/); assert.equal(g.launches(),1);
});
test('inspect neither launches nor creates state; first import refuses preexisting outputs',async()=>{
  const f=fixture(); const result=await f.execute({inspect:true}); assert.equal(result.status,'needs-import'); assert.equal(f.launches(),0); assert.equal(existsSync(join(f.root,'Project/Saved')),false);
  put(join(f.output,'Anything.uasset'),'owner'); await assert.rejects(f.execute({}),/OUTPUT_CONFLICT/); assert.equal(f.launches(),0);
});
test('failed import preserves pending evidence and blocks replay',async()=>{
  const f=fixture(); await assert.rejects(importGlb(join(f.root,'import.json'),{runEditor:async()=>{throw new Error('native died');}}),/native died/);
  await assert.rejects(f.execute({force:true}),/PENDING_OPERATION/); assert.equal(f.launches(),0);
});
test('pending inspect still exposes recovery evidence after the source GLB is removed',async()=>{
  const f=fixture();
  await assert.rejects(importGlb(join(f.root,'import.json'),{runEditor:async()=>{throw new Error('native died');}}),/native died/);
  unlinkSync(join(f.root,'model.glb'));
  const result=await f.execute({inspect:true});
  assert.equal(result.status,'pending');
  assert.equal(result.pending.request.source,join(f.root,'model.glb'));
  assert.equal(f.launches(),0);
});
test('rejects unknown options, external GLB dependencies and unsafe destinations',async()=>{
  for(const patch of [{options:{mystery:true}},{destination:'/Game/OwnerStuff'},{destination:'/Game/Generated/../OwnerStuff'}]) {
    const f=fixture(); const path=join(f.root,'import.json');put(path,JSON.stringify({...JSON.parse(readFileSync(path)),...patch})); await assert.rejects(f.execute({}),/CONFIG/); assert.equal(f.launches(),0);
  }
  const f=fixture(); const data=glb();const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'elsewhere.bin'}]}).padEnd(100,' '));json.copy(data,20);put(join(f.root,'model.glb'),data);await assert.rejects(f.execute({}),/SELF_CONTAINED/);
});
test('missing registry-reported packages and input drift retain pending evidence',async()=>{
  const f=fixture();
  await assert.rejects(importGlb(join(f.root,'import.json'),{runEditor:async r=>{
    put(join(r.outputDirectory,'One.uasset'),'asset');put(r.report,JSON.stringify({ok:true,operation:r.operation,destination:r.destination,assets:[r.destination+'/Missing']}));return {code:0};
  }}),/NATIVE_OUTPUT_MISSING/);
  assert.equal((await f.execute({inspect:true})).status,'pending');
  const g=fixture();
  await assert.rejects(importGlb(join(g.root,'import.json'),{runEditor:async r=>{
    put(join(r.outputDirectory,'One.uasset'),'asset');put(r.report,JSON.stringify({ok:true,operation:r.operation,destination:r.destination,assets:[r.destination+'/One']}));put(join(g.root,'Project/Config/New.ini'),'native changed config');return {code:0};
  }}),/INPUT_CHANGED/);
  assert.ok((await g.execute({inspect:true})).pending.identity);
});
test('an active project import blocks another destination too',async()=>{
  const f=fixture(); const lock=join(f.root,'Project/Saved/AgentEngineImports/lock');mkdirSync(lock,{recursive:true});
  await assert.rejects(f.execute({}),/IMPORT_LOCKED/);assert.equal(f.launches(),0);
});
test('an uncertain import blocks different destinations in the same project',async()=>{
  const f=fixture();await assert.rejects(importGlb(join(f.root,'import.json'),{runEditor:async()=>{throw new Error('native died');}}),/native died/);
  const path=join(f.root,'import.json');put(path,JSON.stringify({...JSON.parse(readFileSync(path)),destination:'/Game/Generated/Second'}));
  await assert.rejects(f.execute({}),/PENDING_OPERATION/);assert.equal((await f.execute({inspect:true})).status,'pending');assert.equal(f.launches(),0);
});
test('a broken destination link is rejected before creating any output',async t=>{
  const f=fixture();mkdirSync(dirname(f.output),{recursive:true});
  try { symlinkSync(join(f.root,'missing-target'),f.output,process.platform==='win32'?'junction':'dir'); }
  catch(error) { if(error.code==='EPERM'){t.skip('symlink creation needs host permission');return;}throw error; }
  await assert.rejects(f.execute({}),/LINK_NOT_ALLOWED/);assert.equal(existsSync(join(f.root,'missing-target')),false);
});

#!/usr/bin/env node
// Node 20+, no dependencies. Orchestrates Unreal's importer; never implements GLB conversion.
import { readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, mkdirSync, renameSync, unlinkSync, rmdirSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname, join, relative, parse, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('./unreal_import_native.py',import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path,'utf8'));
const slash = path => path.split(sep).join('/');
const canonical = value => JSON.stringify(value, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key=>[key,x[key]])) : x);
function fail(code, detail) { throw new Error(`${code}: ${detail}`); }
function noLinks(path) {
  const absolute=resolve(path), base=parse(absolute).root;
  let next=base;
  for(const part of absolute.slice(base.length).split(sep)) { next=join(next,part);if(lstatSync(next,{throwIfNoEntry:false})?.isSymbolicLink()) fail('LINK_NOT_ALLOWED',next); }
  return absolute;
}
function bytes(path) {
  noLinks(path);const before=lstatSync(path);if(!before.isFile())fail('FILE_REQUIRED',path);
  const data=readFileSync(path),after=lstatSync(path);
  if(before.size!==after.size || before.mtimeMs!==after.mtimeMs)fail('INPUT_CHANGED',path);
  return data;
}
function inventory(root,select=()=>true) {
  noLinks(root);if(!existsSync(root))return [];
  if(!lstatSync(root).isDirectory())fail('DIRECTORY_REQUIRED',root);
  const result=[],seen=new Set();
  function walk(dir) {
    for(const name of readdirSync(dir).sort()) {
      const path=join(dir,name),stat=lstatSync(path),rel=slash(relative(root,path));
      if(seen.has(rel.toLowerCase()))fail('CASE_COLLISION',rel);seen.add(rel.toLowerCase());
      if(stat.isSymbolicLink())fail('LINK_NOT_ALLOWED',path);
      if(stat.isDirectory())walk(path);
      else if(stat.isFile()) { if(select(rel))result.push({path:rel,size:stat.size,sha256:hash(bytes(path))}); }
      else fail('FILE_REQUIRED',path);
    }
  }
  walk(root);return result;
}
function strictKeys(value,allowed,label) {
  if(!value || typeof value!=='object'||Array.isArray(value))fail('CONFIG',`${label} must be an object`);
  for(const key of Object.keys(value))if(!allowed.includes(key))fail('CONFIG',`unknown ${label}.${key}`);
}
function atomic(path,value) { const temp=`${path}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temp,path); }
function glb(path) {
  const data=bytes(path);
  if(data.length<20||data.toString('ascii',0,4)!=='glTF'||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length||data.readUInt32LE(16)!==0x4e4f534a)fail('CONFIG','source must be a GLB 2.0 file');
  const length=data.readUInt32LE(12);if(length%4||length>data.length-20)fail('CONFIG','invalid GLB JSON chunk');
  const doc=JSON.parse(data.subarray(20,20+length).toString('utf8'));
  for(const item of [...doc.buffers??[],...doc.images??[]])if(item.uri&&!item.uri.startsWith('data:'))fail('SELF_CONTAINED_GLB_REQUIRED',item.uri);
  return hash(data);
}
const BOOLEAN_OPTIONS=['combineStaticMeshes','combineSkeletalMeshes','importMaterials'];
const VERTEX_COLORS=['replace','ignore','override'];
const MESH_KEYS=['node','asset','allowCpuAccess','fullPrecisionUVs','material','collision','doubleSidedCollision','expect'];
const EXPECT_KEYS=['boundsCm','maxVertices','nanite','fullPrecisionUVs','vertexColors','minUvChannels','collision','doubleSidedCollision'];
const COLLISION={'complex-as-simple':'CTF_USE_COMPLEX_AS_SIMPLE'};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function boolKey(value,key,label) { if(value[key]!==undefined&&typeof value[key]!=='boolean')fail('CONFIG',`${label}.${key} must be boolean`); }
function triple(value,label) { if(!Array.isArray(value)||value.length!==3||!value.every(finite))fail('CONFIG',`${label} must be three numbers`); }
function meshPolicy(meshes,options,destination) {
  if(!Array.isArray(meshes)||!meshes.length)fail('CONFIG','meshes must be a non-empty array');
  const assets=new Set(),nodes=new Set();
  const result=meshes.map((mesh,index)=>{
    const label=`meshes[${index}]`;
    strictKeys(mesh,MESH_KEYS,label);
    if(typeof mesh.asset!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(mesh.asset))fail('CONFIG',`${label}.asset must be an asset name such as SM_Barrel`);
    if(assets.has(mesh.asset.toLowerCase()))fail('CONFIG',`${label}.asset ${mesh.asset} is used twice`);assets.add(mesh.asset.toLowerCase());
    if(mesh.node!==undefined) {
      if(typeof mesh.node!=='string'||!mesh.node)fail('CONFIG',`${label}.node must be a non-empty string`);
      if(nodes.has(mesh.node))fail('CONFIG',`${label}.node ${mesh.node} is used twice`);nodes.add(mesh.node);
    } else if(meshes.length>1)fail('CONFIG',`${label}.node is required when several meshes are listed`);
    for(const key of ['allowCpuAccess','fullPrecisionUVs','doubleSidedCollision'])boolKey(mesh,key,label);
    if(mesh.material!==undefined) {
      if(typeof mesh.material!=='string'||!/^\/(?:Game|Engine)(?:\/[A-Za-z0-9_]+)+$/.test(mesh.material))fail('CONFIG',`${label}.material must be an object path such as /Game/Art/M_Ink`);
      if(mesh.material===destination||mesh.material.startsWith(`${destination}/`))fail('CONFIG',`${label}.material must not be inside the owned destination`);
    }
    if(mesh.collision!==undefined&&!Object.hasOwn(COLLISION,mesh.collision))fail('CONFIG',`${label}.collision must be one of ${Object.keys(COLLISION).join(', ')}`);
    if(mesh.expect!==undefined) {
      const expect=mesh.expect,where=`${label}.expect`;
      strictKeys(expect,EXPECT_KEYS,where);
      for(const key of ['nanite','fullPrecisionUVs','vertexColors','doubleSidedCollision'])boolKey(expect,key,where);
      if(expect.maxVertices!==undefined&&!(Number.isInteger(expect.maxVertices)&&expect.maxVertices>0))fail('CONFIG',`${where}.maxVertices must be a positive integer`);
      if(expect.minUvChannels!==undefined&&!(Number.isInteger(expect.minUvChannels)&&expect.minUvChannels>0))fail('CONFIG',`${where}.minUvChannels must be a positive integer`);
      if(expect.collision!==undefined&&!Object.hasOwn(COLLISION,expect.collision))fail('CONFIG',`${where}.collision must be one of ${Object.keys(COLLISION).join(', ')}`);
      if(expect.boundsCm!==undefined) {
        const bounds=expect.boundsCm;strictKeys(bounds,['min','max','toleranceCm'],`${where}.boundsCm`);
        triple(bounds.min,`${where}.boundsCm.min`);triple(bounds.max,`${where}.boundsCm.max`);
        if(bounds.min.some((x,axis)=>x>bounds.max[axis]))fail('CONFIG',`${where}.boundsCm.min must not exceed max`);
        if(bounds.toleranceCm!==undefined&&!(finite(bounds.toleranceCm)&&bounds.toleranceCm>=0))fail('CONFIG',`${where}.boundsCm.toleranceCm must be zero or more`);
      }
    }
    return mesh;
  });
  if(result.length>1&&options.combineStaticMeshes!==false)fail('CONFIG','several meshes need options.combineStaticMeshes false (a kit)');
  return result;
}
function configAt(path) {
  path=noLinks(path);const config=json(path),base=dirname(path);
  strictKeys(config,['source','project','engine','destination','options','meshes','inputs'],'config');
  for(const key of ['source','project','engine','destination'])if(typeof config[key]!=='string'||!config[key])fail('CONFIG',`${key} is required`);
  if(!/^\/Game\/Generated\/[A-Za-z][A-Za-z0-9_]*$/.test(config.destination))fail('CONFIG','destination must be /Game/Generated/<one-asset-folder>');
  if(config.options!==undefined)strictKeys(config.options,[...BOOLEAN_OPTIONS,'vertexColors','nanite'],'options');
  const options={combineStaticMeshes:true,combineSkeletalMeshes:true,importMaterials:true,...config.options};
  strictKeys(options,[...BOOLEAN_OPTIONS,'vertexColors','nanite'],'options');
  for(const [key,value]of Object.entries(options))if(key==='vertexColors'){if(!VERTEX_COLORS.includes(value))fail('CONFIG',`vertexColors must be one of ${VERTEX_COLORS.join(', ')}`);}else if(typeof value!=='boolean')fail('CONFIG',`${key} must be boolean`);
  const meshes=config.meshes===undefined?undefined:meshPolicy(config.meshes,options,config.destination);
  const readback=meshes!==undefined||options.nanite!==undefined||options.vertexColors!==undefined;
  if(config.inputs!==undefined&&(!Array.isArray(config.inputs)||config.inputs.some(x=>typeof x!=='string')))fail('CONFIG','inputs must be file paths');
  const project=noLinks(resolve(base,config.project)),engine=noLinks(resolve(base,config.engine)),source=noLinks(resolve(base,config.source));
  if(!project.endsWith('.uproject'))fail('CONFIG','project must name a .uproject');
  json(project);const projectRoot=dirname(project),outputDirectory=join(projectRoot,'Content',...config.destination.slice(6).split('/'));
  const id=hash(config.destination).slice(0,20),state=join(projectRoot,'Saved','AgentEngineImports',id);
  noLinks(outputDirectory);noLinks(state);
  return {configPath:path,source,project,projectRoot,engine,destination:config.destination,outputDirectory,options,meshes,readback,inputs:(config.inputs??[]).map(x=>noLinks(resolve(base,x))),state,projectPending:join(projectRoot,'Saved','AgentEngineImports','pending.json')};
}
function identity(c) {
  const files=[];
  const add=path=>files.push({path:slash(resolve(path)),sha256:hash(bytes(path))});
  add(c.project);add(join(c.engine,'Engine','Build','Build.version'));
  const editor=join(c.engine,'Engine','Binaries','Win64','UnrealEditor.exe');add(editor);add(SELF);add(SCRIPT);
  for(const path of c.inputs)add(path);
  for(const folder of [join(c.projectRoot,'Config'),join(c.projectRoot,'Binaries'),join(c.projectRoot,'Plugins')])for(const item of inventory(folder))add(join(folder,item.path));
  const engineRoot=join(c.engine,'Engine');
  // Installed Interchange/Python binaries, descriptors, configuration and pipeline assets.
  // This is an explicit identity surface, not inferred complete engine dependency closure.
  const binaryFolder=join(engineRoot,'Binaries','Win64');
  for(const name of readdirSync(binaryFolder).sort())if(/^UnrealEditor-(?:Interchange|PythonScriptPlugin).*(?:\.dll|\.modules)$/.test(name))add(join(binaryFolder,name));
  for(const folder of [join(engineRoot,'Config'),join(engineRoot,'Plugins','Interchange'),join(engineRoot,'Plugins','Experimental','PythonScriptPlugin')]) {
    for(const item of inventory(folder,path=>!/(?:^|\/)Source\//.test(path)&&/\.(?:dll|modules|uplugin|uasset|ini|py)$/.test(path)))add(join(folder,item.path));
  }
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {schema:1,source:{path:slash(c.source),sha256:glb(c.source)},project:slash(c.project),destination:c.destination,options:c.options,...(c.meshes?{meshes:c.meshes}:{}),node:process.version,platform:process.platform,files};
}
const onOff=value=>value?'on':'off';
const objectPath=path=>String(path??'').split('.')[0];
// Pure comparison of what the native script read back against what the config asked for or expects. Returns every mismatch.
export function evaluatePolicy(c,report) {
  const failures=[...(Array.isArray(report.problems)?report.problems.map(String):[])];
  const readbacks=report.meshes,claimed=new Set(),specs=c.meshes??[];
  const check=(label,mesh,spec)=>{
    const expect=spec?.expect??{};
    const flag=(name,actual,wanted,source,text)=>{
      if(wanted===undefined)return;
      if(actual===null||actual===undefined)failures.push(`${label}: ${name} could not be read back`);
      else if(actual!==wanted)failures.push(`${label}: ${text(actual)} but ${source}`);
    };
    if(mesh.vertices===null||mesh.vertices===undefined)failures.push(`${label}: vertex count could not be read back`);
    else if(!(mesh.vertices>0))failures.push(`${label}: ${mesh.vertices} vertices were imported`);
    else if(expect.maxVertices!==undefined&&mesh.vertices>expect.maxVertices)failures.push(`${label}: ${mesh.vertices} vertices, more than the allowed ${expect.maxVertices}`);
    const nanite=actual=>`Nanite is ${onOff(actual)}`;
    flag('Nanite state',mesh.naniteEnabled,c.options.nanite,`the options ask for ${onOff(c.options.nanite)}`,nanite);
    flag('Nanite state',mesh.naniteEnabled,expect.nanite,`the expectation is ${onOff(expect.nanite)}`,nanite);
    const uvs=actual=>`full-precision UVs are ${onOff(actual)}`;
    flag('full-precision UV state',mesh.fullPrecisionUvs,spec?.fullPrecisionUVs,`the config asks for ${onOff(spec?.fullPrecisionUVs)}`,uvs);
    flag('full-precision UV state',mesh.fullPrecisionUvs,expect.fullPrecisionUVs,`the expectation is ${onOff(expect.fullPrecisionUVs)}`,uvs);
    flag('CPU access state',mesh.allowCpuAccess,spec?.allowCpuAccess,`the config asks for ${onOff(spec?.allowCpuAccess)}`,actual=>`CPU access is ${onOff(actual)}`);
    for(const wanted of [spec?.collision,expect.collision]) {
      if(wanted===undefined)continue;
      if(mesh.collisionTraceFlag==null)failures.push(`${label}: collision trace flag could not be read back`);
      else if(mesh.collisionTraceFlag!==COLLISION[wanted])failures.push(`${label}: collision trace flag is ${mesh.collisionTraceFlag}, not ${COLLISION[wanted]}`);
    }
    const doubleSided=spec?.doubleSidedCollision??(spec?.collision==='complex-as-simple'?true:undefined);
    const sided=actual=>`double-sided collision is ${onOff(actual)}`;
    flag('double-sided collision state',mesh.doubleSidedCollision,doubleSided,`the config asks for ${onOff(doubleSided)}`,sided);
    flag('double-sided collision state',mesh.doubleSidedCollision,expect.doubleSidedCollision,`the expectation is ${onOff(expect.doubleSidedCollision)}`,sided);
    if(spec?.material!==undefined) {
      const slots=Array.isArray(mesh.materialSlots)?mesh.materialSlots:null;
      if(slots===null)failures.push(`${label}: material slots could not be read back`);
      else if(!slots.length||slots.some(x=>objectPath(x)!==spec.material))failures.push(`${label}: material slots are ${JSON.stringify(slots)}, not all ${spec.material}`);
    }
    if(expect.vertexColors!==undefined) {
      if(mesh.hasVertexColors===null||mesh.hasVertexColors===undefined)failures.push(`${label}: vertex colours could not be read back`);
      else if(mesh.hasVertexColors!==expect.vertexColors)failures.push(`${label}: ${mesh.hasVertexColors?'vertex colours were imported but none are expected':'no vertex colours were imported'}`);
    }
    if(expect.minUvChannels!==undefined) {
      if(mesh.uvChannels===null||mesh.uvChannels===undefined)failures.push(`${label}: UV channels could not be read back`);
      else if(mesh.uvChannels<expect.minUvChannels)failures.push(`${label}: ${mesh.uvChannels} UV channels, expected at least ${expect.minUvChannels}`);
    }
    if(expect.boundsCm!==undefined) {
      const wanted=expect.boundsCm,tolerance=wanted.toleranceCm??0.5,actual=mesh.boundsCm;
      if(!actual||!Array.isArray(actual.min)||!Array.isArray(actual.max)||actual.min.length!==3||actual.max.length!==3)failures.push(`${label}: bounds could not be read back`);
      else for(const [axis,name] of ['X','Y','Z'].entries())
        if(!(Math.abs(actual.min[axis]-wanted.min[axis])<=tolerance)||!(Math.abs(actual.max[axis]-wanted.max[axis])<=tolerance))
          failures.push(`${label}: ${name} bounds [${Number(actual.min[axis]).toFixed(2)}, ${Number(actual.max[axis]).toFixed(2)}] cm differ from expected [${wanted.min[axis]}, ${wanted.max[axis]}] by more than ${tolerance}`);
    }
  };
  for(const spec of specs) {
    const mesh=readbacks.find(x=>x.requested===spec.asset);
    if(!mesh){failures.push(`${spec.asset}: no imported mesh was read back`);continue;}
    claimed.add(mesh);check(spec.asset,mesh,spec);
  }
  for(const mesh of readbacks) {
    if(claimed.has(mesh))continue;
    const label=mesh.requested??String(mesh.asset).split('/').pop().split('.')[0];
    if(specs.length)failures.push(`${label}: imported mesh matches no entry in meshes`);
    else check(label,mesh,undefined);
  }
  return failures;
}
function ownedReceipt(c) {
  const path=join(c.state,'receipt.json');if(!existsSync(path))return null;
  const receipt=json(path);
  if(receipt.schema!==1||receipt.project!==slash(c.project)||receipt.destination!==c.destination||!Array.isArray(receipt.outputs)||!receipt.outputs.length||!/^[a-f0-9]{64}$/.test(receipt.key??''))fail('INVALID_RECEIPT',path);
  const seen=new Set();
  for(const item of receipt.outputs) {
    if(typeof item.path!=='string'||!item.path||item.path.includes('\\')||item.path.split('/').some(x=>!x||x==='.'||x==='..')||item.path.startsWith('/')||!Number.isSafeInteger(item.size)||item.size<0||!/^[a-f0-9]{64}$/.test(item.sha256??'')||seen.has(item.path.toLowerCase()))fail('INVALID_RECEIPT',path);
    seen.add(item.path.toLowerCase());
  }
  return receipt;
}
function preflight(c) {
  if(existsSync(c.projectPending))fail('PENDING_OPERATION',`${c.projectPending}; inspect the project-wide pending journal before manual recovery`);
  if(existsSync(join(c.state,'pending.json')))fail('PENDING_OPERATION',`${c.state}; inspect the pending journal and native log before manual recovery`);
  const previous=ownedReceipt(c),outputs=inventory(c.outputDirectory),owned=new Map(previous?.outputs.map(x=>[x.path,x])??[]);
  for(const item of outputs)if(!owned.has(item.path)||owned.get(item.path).sha256!==item.sha256)fail('OUTPUT_CONFLICT',`${item.path}; preserve owner edits/unowned files before import`);
  return {previous,outputs,missing:previous?previous.outputs.filter(x=>!outputs.some(y=>y.path===x.path)).map(x=>x.path):[]};
}
async function nativeEditor(request,c) {
  const executable=join(c.engine,'Engine','Binaries','Win64','UnrealEditor.exe');
  const args=[c.project,`-ExecutePythonScript=${SCRIPT}`,`-abslog=${request.log}`,'-RenderOffScreen','-unattended','-nullrhi','-nosplash','-nosound','-notraceserver'];
  const log=openSync(`${request.log}.console`,'wx');
  try {
    return await new Promise((resolvePromise,reject)=>{
      const child=spawn(executable,args,{env:{...process.env,AGENT_ENGINE_IMPORT_REQUEST:request.requestFile},stdio:['ignore',log,log],windowsHide:true});
      const timer=setTimeout(()=>{child.kill();reject(new Error('NATIVE_TIMEOUT: Editor exceeded 180 seconds; pending journal retained'));},180000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolvePromise({code});});
    });
  } finally { closeSync(log); }
}

export async function importGlb(configPath,{ifChanged=false,force=false,inspect=false,runEditor=nativeEditor}={}) {
  if(ifChanged&&force)fail('CONFIG','--if-changed and --force are mutually exclusive');
  const c=configAt(configPath);
  const pendingPath=existsSync(c.projectPending)?c.projectPending:join(c.state,'pending.json');
  if(inspect&&existsSync(pendingPath))return {status:'pending',state:c.state,pending:json(pendingPath)};
  const initial=identity(c),key=hash(canonical(initial));
  if(inspect) { const p=preflight(c),failed=p.previous?.policy?.failures?.length>0;return {status:p.previous?.key===key&&!p.missing.length&&!failed?'reusable':'needs-import',key,state:c.state,missing:p.missing,outputs:p.outputs,...(failed?{failures:p.previous.policy.failures}:{})}; }
  mkdirSync(c.state,{recursive:true});const lock=join(c.projectRoot,'Saved','AgentEngineImports','lock');
  try { mkdirSync(lock); } catch { fail('IMPORT_LOCKED',lock); }
  try {
    const p=preflight(c);
    if(ifChanged&&p.previous?.key===key&&!p.missing.length&&!p.previous.policy?.failures?.length)return {status:'reused',key,outputs:p.outputs,receipt:join(c.state,'receipt.json')};
    const operation=randomUUID(),work=join(c.state,'operations',operation);mkdirSync(work,{recursive:true});
    const backup=join(work,'previous-output'),pending=join(c.state,'pending.json');
    const request={schema:1,source:c.source,project:c.project,destination:c.destination,outputDirectory:c.outputDirectory,options:c.options,...(c.meshes?{meshes:c.meshes}:{}),...(c.readback?{readback:true}:{}),report:join(work,'native-report.json'),log:join(work,'native.log'),requestFile:join(work,'request.json'),operation};
    const journal={schema:1,operation,key,identity:initial,request,previousOutputs:p.outputs,backup};
    atomic(c.projectPending,journal);atomic(pending,journal);
    if(canonical(inventory(c.outputDirectory))!==canonical(p.outputs))fail('OUTPUT_CONFLICT','outputs changed after preflight');
    if(existsSync(c.outputDirectory))renameSync(c.outputDirectory,backup);
    atomic(request.requestFile,request);
    const native=await runEditor(request,c);
    if(native.code!==0)fail('NATIVE_IMPORT_FAILED',`exit ${native.code}; ${request.log}`);
    if(!existsSync(request.report))fail('NATIVE_REPORT_MISSING',request.report);
    const report=json(request.report);
    if(report.ok!==true||report.operation!==operation||report.destination!==c.destination||!Array.isArray(report.assets)||!report.assets.length)fail('NATIVE_IMPORT_FAILED',JSON.stringify(report));
    for(const asset of report.assets)if(typeof asset!=='string'||!asset.startsWith(`${c.destination}/`))fail('NATIVE_OUTPUT_OUTSIDE_DESTINATION',String(asset));
    const outputs=inventory(c.outputDirectory);
    if(!outputs.some(x=>x.path.endsWith('.uasset')))fail('NATIVE_OUTPUT_MISSING',c.outputDirectory);
    for(const asset of report.assets) {
      const assetFile=asset.slice(c.destination.length+1).split('.')[0]+'.uasset';
      if(!outputs.some(x=>x.path===assetFile))fail('NATIVE_OUTPUT_MISSING',assetFile);
    }
    if(hash(canonical(identity(c)))!==key)fail('INPUT_CHANGED','identity changed during native import; pending journal retained');
    let policy;
    if(c.readback) {
      if(!Array.isArray(report.meshes)||report.meshes.some(x=>!x||typeof x!=='object'||typeof x.asset!=='string'||!x.asset.startsWith(`${c.destination}/`)))fail('NATIVE_IMPORT_FAILED',`report has no usable mesh read-back: ${JSON.stringify(report)}`);
      policy={pipeline:report.pipeline??null,meshes:report.meshes,failures:evaluatePolicy(c,report)};
    }
    const receipt={schema:1,project:slash(c.project),destination:c.destination,key,identity:initial,outputs,nativeReport:request.report,operation,created:new Date().toISOString(),...(policy?{policy}:{})};
    atomic(join(c.state,'receipt.json'),receipt);unlinkSync(pending);unlinkSync(c.projectPending);
    // The outputs are known and owned, so a failed expectation leaves no pending journal. The receipt keeps the evidence and is never reused.
    if(policy?.failures.length)fail('IMPORT_EXPECTATIONS_FAILED',`${policy.failures.length} mismatch${policy.failures.length===1?'':'es'} (read-back in ${join(c.state,'receipt.json')})\n${policy.failures.map(x=>`- ${x}`).join('\n')}`);
    return {status:'built',key,outputs,receipt:join(c.state,'receipt.json'),nativeReport:request.report,backup:existsSync(backup)?backup:null,...(policy?{policy}:{})};
  } finally { rmdirSync(lock); }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [config,...flags]=process.argv.slice(2);
  if(!config||flags.some(x=>!['--if-changed','--force','--inspect'].includes(x))) { process.stderr.write('Usage: node unreal-import.mjs import.json [--if-changed | --force] [--inspect]\n');process.exitCode=2; }
  else importGlb(config,{ifChanged:flags.includes('--if-changed'),force:flags.includes('--force'),inspect:flags.includes('--inspect')}).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}

// Opt-in native-engine probe; the dependency-free gate runs its tests only.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOptions,planPhases,evaluate} from './am-probe-checks.mjs';
export function runBounded(executable,args,options={},limitMs=240000) {
 return new Promise(resolveResult=>{
  const child=spawn(executable,args,{...options,windowsHide:true});
  let timedOut=false,settled=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill();},limitMs);
  const finish=result=>{if(!settled){settled=true;clearTimeout(timer);resolveResult({...result,timedOut});}};
  child.once('error',e=>finish({error:e.message,status:null}));
  child.once('close',status=>finish({status}));
 });
}
const read=p=>{try{return readFileSync(p,'utf8');}catch{return '';}};
const gpu=()=>{const r=spawnSync('nvidia-smi',['--query-gpu=utilization.gpu,memory.used,memory.total','--format=csv,noheader'],{encoding:'utf8',windowsHide:true,timeout:10000});return {at:new Date().toISOString(),output:r.stdout?.trim()||r.error?.message||r.stderr?.trim(),status:r.status};};
export async function main(argv) {
 let o;try{o=parseOptions(argv,process.env);}catch(e){console.error(e.message);return 2;}
 const phases=planPhases(o);
 if(o.plan){console.log(JSON.stringify({options:o,phases},null,2));return 0;}
 const binaries=join(o.engine,'Engine','Binaries','Win64');
 if(!phases.every(p=>existsSync(join(binaries,p.mode==='commandlet'?'UnrealEditor-Cmd.exe':'UnrealEditor.exe')))){console.error('engine executable missing');return 2;}
 const root=mkdtempSync(join(tmpdir(),'audio-modulation-probe-')),project=join(root,'AudioModulationProbe.uproject'),saved=join(root,'Saved');
 mkdirSync(saved,{recursive:true});
 writeFileSync(project,JSON.stringify({FileVersion:3,EngineAssociation:'5.8',Plugins:['PythonScriptPlugin','EditorScriptingUtilities','AudioModulation'].map(Name=>({Name,Enabled:true}))}));
 const reports={},runs=[];let quartzLog='';
 const evidence=o.evidence?resolve(o.evidence):null;
 if(evidence){mkdirSync(evidence,{recursive:true});if(existsSync(join(evidence,'run.json')))throw new Error('evidence folder already contains run.json');}
 console.log(`project: ${root}`);
 for(const p of phases){
  const report=join(saved,p.name+'.json'),log=join(saved,p.name+'.log'),script=join(import.meta.dirname,p.script).replaceAll('\\','/');
  const args=[project];
  if(p.mode==='commandlet')args.push('-run=pythonscript',`-script=${script}`);
  else args.push('/Engine/Maps/Entry',`-ExecCmds=py ${script}`);
  args.push('-unattended','-nullrhi','-nosplash','-nopause','-notraceserver',`-abslog=${log}`);
  if(o.audio==='nosound')args.push('-nosound');
  const samples=[gpu()],timer=setInterval(()=>{samples.push(gpu());console.log(`${p.name}: GPU ${samples.at(-1).output}`);},5000);
  console.log(`phase ${p.name}`);
  const result=await runBounded(join(binaries,p.mode==='commandlet'?'UnrealEditor-Cmd.exe':'UnrealEditor.exe'),args,{stdio:'ignore',env:{...process.env,AM_REPORT:report,AM_PHASE:p.name,AM_SECONDS:String(o.seconds),AM_AUDIO:o.audio}},p.limitMs);
  clearInterval(timer);samples.push(gpu());
  const text=read(log);try{reports[p.name]=JSON.parse(read(report));}catch{reports[p.name]={error:'missing or invalid report'};}
  runs.push({phase:p.name,args,result,samples,audioLines:text.split(/\r?\n/).filter(l=>/LogAudio(?:Mixer)?[: ]|null.*device/i.test(l)),memoryFailure:/out of video memory|out of device memory/i.test(text)});
  if(p.name==='quartz')quartzLog=text;
  if(evidence){writeFileSync(join(evidence,p.name+'.log'),text);writeFileSync(join(evidence,p.name+'.json'),JSON.stringify(reports[p.name],null,2));writeFileSync(join(evidence,'run.json'),JSON.stringify({root,options:o,runs,reports},null,2));}
  console.log(`${p.name}: ${JSON.stringify(result)}`);
 }
 const checks=evaluate(reports,o.groups,quartzLog),summary={root,options:o,runs,reports,checks};
 writeFileSync(join(saved,'run.json'),JSON.stringify(summary,null,2));
 if(evidence)writeFileSync(join(evidence,'run.json'),JSON.stringify(summary,null,2));
 for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.group}/${c.name}: ${c.detail}`);
 console.log(`${checks.filter(c=>c.pass).length} of ${checks.length} checks passed`);
 const clean=runs.every(r=>r.result.status===0&&!r.result.timedOut)&&checks.every(c=>c.pass);
 if(clean&&!o.keep&&!evidence)rmSync(root,{recursive:true,force:true});else console.log(`retained: ${root}`);
 return clean?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main(process.argv.slice(2));

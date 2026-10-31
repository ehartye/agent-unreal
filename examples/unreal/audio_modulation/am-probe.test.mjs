import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseOptions,planPhases,evaluate,parseEvents,timing} from './am-probe-checks.mjs';
import {runBounded} from './am_probe.mjs';
test('options reject unsafe/malformed selections before engine work',()=>{
 for(const args of [[],['--engine'],['--engine','x','--seconds','NaN'],['--engine','x','--seconds','0'],['--engine','x','--only','bogus'],['--engine','x','--audio','device'],['--engine','x','--audio','other'],['--engine','x','--keep','--keep']])assert.throws(()=>parseOptions(args));
 const o=parseOptions(['--engine','x','--only','quartz','--audio','device','--seconds','16','--keep','--evidence','e']);assert.equal(o.audio,'device');assert.equal(o.keep,true);
});
test('assets need a fresh readback process and every phase has a finite timeout',()=>{
 const p=planPhases(parseOptions(['--engine','x']));
 assert.deepEqual(p.map(x=>x.name),['surface','assets','readback','value','quartz']);
 assert(p.every(x=>Number.isFinite(x.limitMs)&&x.limitMs>0));
 assert.equal(p[2].mode,'commandlet');
});
test('plan mode succeeds without an engine or scratch project',()=>{
 const r=spawnSync(process.execPath,[new URL('./am_probe.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--engine','absent','--plan'],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).phases.length,5);
});
test('owned child that never exits is stopped at timeout',async()=>{
 const start=Date.now();const r=await runBounded(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'},100);
 assert.equal(r.timedOut,true);assert(Date.now()-start<5000);
});
test('missing executable reports failure without a hang',async()=>{
 const r=await runBounded('nonexistent-audio-probe-executable',[],{stdio:'ignore'},100);assert(r.error);
});
test('surface requires each named class',()=>{
 const classes=Object.fromEntries(['AudioModulationStatics','QuartzSubsystem','QuartzClockHandle','SoundControlBusFactory','SoundControlBusMixFactory','SoundModulationPatchFactory'].map(n=>[n,{present:true}]));
 assert(evaluate({surface:{classes}},['surface']).every(c=>c.pass));
 for(const name of Object.keys(classes)){const c=structuredClone(classes);c[name].present=false;assert.equal(evaluate({surface:{classes:c}},['surface']).find(x=>x.name===name).pass,false);}
 assert(evaluate({},['surface']).every(c=>!c.pass));
});
test('asset checks reject missing, inconsistent and wrong stage data',()=>{
 const snapshot={classes:['SoundControlBus','SoundControlBusMix','SoundModulationPatch'],bus:'/Game/Bus.Bus',parameter:null,stages:[{bus:'/Game/Bus.Bus',value:0.25}],inputs:0,transforms:0};
 const r={assets:{saved:true,snapshot},readback:{snapshot:structuredClone(snapshot)}};
 assert(evaluate(r,['assets']).every(c=>c.pass));
 const changed=structuredClone(r);changed.readback.snapshot.inputs=1;assert.equal(evaluate(changed,['assets'])[0].pass,false);
 const stage=structuredClone(r);stage.readback.snapshot.stages[0].value=0.5;assert.equal(evaluate(stage,['assets'])[1].pass,false);
 assert(evaluate({},['assets']).every(c=>!c.pass));
});
test('value checks require activation and restoration in each world',()=>{
 const route={before:{value:1,active:false},after:{value:0.25,active:true},deactivated:{value:1,active:false}};
 const r={value:{routes:{editor:route,pie:structuredClone(route)}}};assert(evaluate(r,['value']).every(c=>c.pass));
 for(const world of ['editor','pie']){const c=structuredClone(r);c.value.routes[world].after.active=false;assert.equal(evaluate(c,['value']).find(x=>x.name===world).pass,false);}
 const c=structuredClone(r);c.value.routes.editor.deactivated.value=0.25;assert.equal(evaluate(c,['value'])[0].pass,false);
 assert(evaluate({},['value']).every(c=>!c.pass));
});
function eventLog(interval=0.5,count=32,step=1){
 const lines=[];
 for(const route of ['editor','pie'])for(let i=0;i<count;i++){
 const time=new Date(Date.UTC(2026,9,31,0,0,0)+i*interval*1000).toISOString().replace(/-/g,'.').replace('T','-').replace(/:(\d\d):/,'.$1.').replace(/\.(\d{3})Z$/,':$1');
 lines.push(`[${time}] LogPython: AM_EVENT ${JSON.stringify({route,quantization:'BEAT',bar:Math.floor(i/4)*step+1,beat:i%4+1})}`);
 if(i%4===0)lines.push(`[${time}] LogPython: AM_EVENT ${JSON.stringify({route,quantization:'BAR',bar:Math.floor(i/4)*step+1,beat:1})}`);
 }return lines.join('\n');
}
test('Quartz judges actual engine-log timestamps, counts and sequential bars',()=>{
 const log=eventLog();assert.equal(parseEvents(log).length,80);assert.equal(timing(parseEvents(log),'editor').beatMedian,0.5);
 assert(evaluate({},['quartz'],log).every(c=>c.pass));
 for(const bad of [eventLog(0.7),eventLog(0.5,20),eventLog(0.5,32,2),''])assert(evaluate({},['quartz'],bad).every(c=>!c.pass));
});

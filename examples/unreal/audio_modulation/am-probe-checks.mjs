// Pure option/phase planning and report judges; no engine or filesystem access.
export const GROUPS = ['surface', 'assets', 'value', 'quartz'];
export const LIMIT_MS = 240000;
export function parseOptions(argv, env = {}) {
  const o = {engine: env.UE_ROOT, groups: GROUPS, audio: 'nosound', seconds: 16, keep: false, plan: false};
  const valued = {'--engine':'engine','--only':'only','--audio':'audio','--seconds':'seconds','--evidence':'evidence'};
  const seen = new Set();
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(seen.has(a)) throw new Error(`duplicate option ${a}`); seen.add(a);
    if(a==='--keep') o.keep=true;
    else if(a==='--plan') o.plan=true;
    else if(valued[a]) {
      if(!argv[i+1] || argv[i+1].startsWith('--')) throw new Error(`${a} needs a value`);
      o[valued[a]]=argv[++i];
    } else throw new Error(`unknown option ${a}`);
  }
  if(!o.engine) throw new Error('pass --engine or UE_ROOT');
  if(o.only!==undefined) {
    const asked=o.only.split(',');
    if(asked.some(g=>!GROUPS.includes(g))) throw new Error('unknown or empty group');
    o.groups=GROUPS.filter(g=>asked.includes(g));
  }
  if(!['nosound','device'].includes(o.audio)) throw new Error('--audio must be nosound or device');
  if(o.audio==='device' && (o.groups.length!==1 || o.groups[0]!=='quartz')) throw new Error('device mode is quartz-only; pass --only quartz');
  o.seconds=Number(o.seconds);
  if(!Number.isFinite(o.seconds)||o.seconds<=0||o.seconds>60) throw new Error('--seconds must be >0 and <=60');
  return o;
}
export function planPhases(o) {
  return o.groups.flatMap(g=>g==='assets'?[{name:'assets',script:'am_assets.py',mode:'commandlet'},{name:'readback',script:'am_assets.py',mode:'commandlet'}]:[{name:g,script:`am_${g}.py`,mode:g==='surface'?'commandlet':'editor'}]).map(p=>({...p,limitMs:LIMIT_MS}));
}
export function median(values) { if(!values.length)return null; const a=[...values].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2; }
export function parseEvents(log) {
  return [...log.matchAll(/\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\].*?AM_EVENT (\{.*\})/g)].flatMap(m=>{try{return [{...JSON.parse(m[8]),time:Date.UTC(...[+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7]])/1000}];}catch{return [];}});
}
export function timing(events,route) {
 const own=events.filter(e=>e.route===route),beats=own.filter(e=>e.quantization==='BEAT'),bars=own.filter(e=>e.quantization==='BAR');
 const intervals=a=>a.slice(1).map((v,i)=>v.time-a[i].time);
 return {beats:beats.length,beatMedian:median(intervals(beats)),barMedian:median(intervals(bars)),bars:bars.map(e=>e.bar),sequential:bars.length>=2&&bars.slice(1).every((b,i)=>b.bar===bars[i].bar+1)};
}
export const near=(n,target,tolerance)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n-target)<=tolerance;
export function evaluate(reports,groups,log='') {
 const out=[],check=(group,name,claim,pass,detail)=>out.push({group,name,claim,pass:Boolean(pass),detail:typeof detail==='string'?detail:JSON.stringify(detail)});
 if(groups.includes('surface')) for(const name of ['AudioModulationStatics','QuartzSubsystem','QuartzClockHandle','SoundControlBusFactory','SoundControlBusMixFactory','SoundModulationPatchFactory']) check('surface',name,`${name} is exposed`,reports.surface?.classes?.[name]?.present,reports.surface?.classes?.[name]?.present??'missing report');
 if(groups.includes('assets')) {
   const a=reports.assets?.snapshot,b=reports.readback?.snapshot;
   check('assets','saved-readback','three assets saved and read back identically in a fresh process',a&&b&&['SoundControlBus','SoundControlBusMix','SoundModulationPatch'].every((c,i)=>b.classes?.[i]===c)&&JSON.stringify(a)===JSON.stringify(b)&&reports.assets.saved===true,b??reports.assets);
   check('assets','stage','one mix stage points at the bus with value 0.25',b?.stages?.length===1&&b.stages[0].bus===b.bus&&near(b.stages[0].value,0.25,0.001),b?.stages);
 }
 if(groups.includes('value')) for(const route of ['editor','pie']) {
   const r=reports.value?.routes?.[route];
   check('value',route,'activation reaches 0.25 then deactivation restores initial value',r?.after?.active===true&&near(r.after.value,0.25,0.01)&&near(r.deactivated?.value,r.before?.value,0.01),r);
 }
 if(groups.includes('quartz')) for(const route of ['editor','pie']) {
   const t=timing(parseEvents(log),route);
   check('quartz',route,'120 BPM events meet the 16-second count and interval tolerance',t.beats>=24&&near(t.beatMedian,0.5,0.05)&&near(t.barMedian,2,0.2)&&t.sequential,{...t,report:reports.quartz?.routes?.[route]});
 }
 return out;
}

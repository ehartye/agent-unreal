// Reproducible small, rigid-skinned fixtures; outputs never belong in source control.
import {mkdirSync, writeFileSync, copyFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bones = () => [
  {op:'bone.add',bone:{name:'root',position:[0,0,0]}},
  {op:'bone.add',bone:{name:'spine',parent:'root',position:[0,1,0]}},
  {op:'bone.add',bone:{name:'head',parent:'spine',position:[0,0.65,0]}},
];
const piece = (name,type,size,position,color,bone) => [
  {op:'add',part:{name,geometry:{type,size,segments:16},position,color}},
  {op:'bind',name,binding:{type:'rigid',bone}},
];
export function fixtureParts() {
  const body=[...bones(),
    ...piece('torso','box',[0.48,0.62,0.28],[0,1.17,0],'#348cb4','spine'),
    ...piece('face','sphere',[0.34,0.40,0.33],[0,1.69,0],'#ebbd88','head'),
    ...piece('leg_l','box',[0.18,0.85,0.23],[-0.14,0.425,0],'#29446c','root'),
    ...piece('leg_r','box',[0.18,0.85,0.23],[0.14,0.425,0],'#29446c','root'),
    ...piece('arm_l','box',[0.15,0.65,0.20],[-0.33,1.14,0],'#ebbd88','spine'),
    ...piece('arm_r','box',[0.15,0.65,0.20],[0.33,1.14,0],'#ebbd88','spine')];
  const out=[{id:'person_body',operations:body},
    {id:'hat_cap',operations:[...bones(),...piece('cap','cylinder',[0.42,0.10,0.42],[0,1.91,0],'#db3529','head')]},
    {id:'hat_tall',operations:[...bones(),...piece('crown','cylinder',[0.34,0.38,0.34],[0,2.05,0],'#55586c','head'),...piece('brim','cylinder',[0.52,0.05,0.52],[0,1.88,0],'#55586c','head')]}];
  const colors=['#cc4030','#3585cb','#f1bb35','#4aaa65','#9052bb','#d75e9a'];
  for(let group=0;group<4;group++) for(let option=0;option<6;option++) {
    const id=`group${group}_option${option}`;
    const positions=[[0,1.94,0],[-0.37,1.3,0],[0.37,1.3,0],[0,1.1,-0.21]];
    out.push({id,group,option,operations:[...bones(),...piece(id,option%2?'sphere':'box',
      [0.18+option*0.025,0.13+option*0.035,0.16+option*0.015],positions[group],colors[option],group===0?'head':'spine')]});
  }
  return out;
}

export function generate(out, plugin) {
  mkdirSync(out,{recursive:true});
  const parts=join(out,'parts');mkdirSync(parts,{recursive:true});
  for(const part of fixtureParts()) {
    const dir=join(out,part.id);mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'ops.json'),JSON.stringify(part.operations,null,2));
    writeFileSync(join(dir,'build.json'),JSON.stringify({version:1,name:part.id,operations:'ops.json',output:'dist'},null,2));
    const args=[join(plugin,'scripts','run-managed.js'),'build',join(dir,'build.json'),'--no-preview'];
    const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:120000});
    writeFileSync(join(dir,'build.log'),`${r.stdout||''}\n${r.stderr||''}`);
    if(r.status!==0)throw Error(`mesh build ${part.id} failed; see its build.log`);
    copyFileSync(join(dir,'dist','model.glb'),join(parts,part.id+'.glb'));
  }
  writeFileSync(join(out,'parts.json'),JSON.stringify(fixtureParts().map(({operations,...x})=>x),null,2));
  return parts;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [out,plugin]=process.argv.slice(2);
  if(!out||!plugin)throw Error('usage: node mu_parts.mjs <new-output-folder> <agent-meshes-plugin-root>');
  console.log(generate(resolve(out),resolve(plugin)));
}

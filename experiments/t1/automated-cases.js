#!/usr/bin/env node
// Fixed synthetic corpus for the automated T1 variant. Description text and
// checkable gold are emitted together from requirements before maps are run.
const fs = require('fs');
const path = require('path');
const cases = [
  { id:'A01', split:'dev', tier:'simple', sea:'E', mountains:[['青脊山','W']], places:[['青湾港','port','E','river_mouth']], rivers:1 },
  { id:'A02', split:'dev', tier:'multi', sea:'none', mountains:[['赤石岭','N']], places:[['沙泉城','city','C'],['赤石堡','fortress','N','near_mountain']], rivers:1, character:['desert_share','high'] },
  { id:'A03', split:'dev', tier:'simple', sea:'none', mountains:[['云山','N']], places:[['柳城','town','C']], character:['grass_share','high'] },
  { id:'A04', split:'dev', tier:'multi', sea:'all', places:[['环礁港','port','E','coast'],['潮汐村','village','W','coast']], lakes:1 },
  { id:'A05', split:'dev', tier:'multi', sea:'W', mountains:[['日照山','E']], places:[['落日港','port','W','river_mouth'],['松谷镇','town','C','on_river']], rivers:2 },
  { id:'A06', split:'dev', tier:'multi', sea:'none', mountains:[['霜角岭','NW']], places:[['镜湖城','city','C','lakeside'],['白石寨','fortress','NW','near_mountain']], lakes:2, namedLake:'镜湖' },
  { id:'A07', split:'dev', tier:'multi', sea:'S', mountains:[['北墙山','N']], places:[['南风港','port','S','coast'],['北墙堡','fortress','N','near_mountain']], rivers:1 },
  { id:'A08', split:'dev', tier:'unsat', sea:'none', places:[['无海港','port','E','coast']], rivers:1 },
  { id:'A09', split:'dev', tier:'unsat', sea:'none', places:[['两界镇','town','E']], conflictRegion:'W' },
  { id:'A10', split:'dev', tier:'simple', sea:'N', mountains:[['霜峰','C']], places:[['北冰港','port','N','coast']], character:['cold_share','high'] },
  { id:'A11', split:'test', tier:'simple', sea:'E', mountains:[['鸦脊山','W']], places:[['灰锚港','port','E','coast']], rivers:1 },
  { id:'A12', split:'test', tier:'multi', sea:'none', mountains:[['铜岭','S']], places:[['铜岭堡','fortress','S','near_mountain'],['麦浪镇','town','C','on_river']], rivers:2 },
  { id:'A13', split:'test', tier:'multi', sea:'all', mountains:[['雾岬岭','N']], places:[['灯塔港','port','E','river_mouth'],['西礁村','village','W','coast']], rivers:1 },
  { id:'A14', split:'test', tier:'unsat', sea:'none', places:[['旱海港','port','S','river_mouth']], character:['desert_share','high'] },
  { id:'A15', split:'test', tier:'simple', sea:'none', places:[['黑松镇','town','N','on_river']], rivers:1, character:['forest_share','high'] },
  { id:'A16', split:'test', tier:'multi', sea:'W', mountains:[['白塔山','E']], places:[['潮湾港','port','W','river_mouth'],['白塔城','city','E','near_mountain']], rivers:2 },
  { id:'A17', split:'test', tier:'multi', sea:'none', mountains:[['青崖','SW']], places:[['鹭湖村','village','C','lakeside'],['青崖堡','fortress','SW','near_mountain']], lakes:2 },
  { id:'A18', split:'test', tier:'simple', sea:'S', places:[['金沙港','port','S','coast']], character:['desert_share','high'] },
  { id:'A19', split:'test', tier:'multi', sea:'E', mountains:[['苍梧岭','NW']], places:[['河口城','city','E','on_river'],['苍梧寨','fortress','NW','near_mountain']], rivers:2, character:['forest_share','high'] },
  { id:'A20', split:'test', tier:'simple', sea:'none', mountains:[['雪脊山','NE']], places:[['雪脊镇','town','NE','near_mountain']], character:['cold_share','high'] },
  { id:'A21', split:'test', tier:'multi', sea:'N', places:[['北湾港','port','N','river_mouth'],['苇滩村','village','C','lakeside']], rivers:1, lakes:1 },
  { id:'A22', split:'test', tier:'unsat', sea:'none', places:[['双向城','city','N']], conflictRegion:'S', rivers:1 },
  { id:'A23', split:'test', tier:'multi', sea:'W', mountains:[['石门岭','SE']], places:[['石门堡','fortress','SE','near_mountain'],['芦苇港','port','W','coast']], lakes:1 },
  { id:'A24', split:'test', tier:'simple', sea:'none', places:[['赤沙镇','town','C','on_river']], rivers:1, character:['desert_share','dominant'] },
  { id:'A25', split:'test', tier:'multi', sea:'E', mountains:[['雷鸣山','N']], places:[['雷鸣堡','fortress','N','near_mountain'],['河灯港','port','E','river_mouth']], rivers:2 },
  { id:'A26', split:'test', tier:'simple', sea:'all', places:[['海星港','port','S','coast']], namedLake:'碧眼湖', lakes:1 },
  { id:'A27', split:'test', tier:'multi', sea:'none', mountains:[['断崖山','W']], places:[['断崖堡','fortress','W','near_mountain'],['平泽城','city','E','on_river']], rivers:1, character:['grass_share','high'] },
  { id:'A28', split:'test', tier:'multi', sea:'S', mountains:[['黄土岭','N']], places:[['黄土镇','town','N','near_mountain'],['盐风港','port','S','coast']], character:['desert_share','high'] },
  { id:'A29', split:'test', tier:'unsat', sea:'none', places:[['荒原港','port','W','coast']], lakes:1 },
  { id:'A30', split:'test', tier:'multi', sea:'E', mountains:[['松涛山','SW']], places:[['松涛镇','town','SW','near_mountain'],['碧潮港','port','E','river_mouth'],['镜水村','village','C','lakeside']], rivers:2, lakes:1 },
];

const zhRegion = { NW:'西北部', N:'北部', NE:'东北部', W:'西部', C:'中部', E:'东部', SW:'西南部', S:'南部', SE:'东南部' };
const seaText = { none:'全图没有海', N:'北临大海', E:'东临大海', S:'南临大海', W:'西临大海', all:'四面环海' };
const typeText = { port:'港口', city:'城市', town:'城镇', village:'村庄', fortress:'要塞' };
const placeText = { coast:'海岸', river_mouth:'河口', on_river:'河畔', lakeside:'湖畔', near_mountain:'山脚' };
const charText = { desert_share:{ high:'大片陆地是沙漠', dominant:'大部分陆地是沙漠' },
  forest_share:{ high:'大片陆地覆盖森林' }, grass_share:{ high:'大片陆地为草地' }, cold_share:{ high:'大片陆地是苔原或冰原' } };

function compile(c) {
  const parts = [seaText[c.sea]], gold = { id:c.id, sea:{ id:'sea', value:c.sea, basis:'explicit' },
    entities:[], constraints:[], character:[], impossible:[], uncheckable:[] };
  for (const [name, reg] of c.mountains || []) {
    parts.push(`${zhRegion[reg]}有山脉「${name}」`);
    gold.entities.push({ id:`e${gold.entities.length + 1}`, name, type:'mountain', basis:'explicit' });
    gold.constraints.push({ id:`c${gold.constraints.length + 1}`, kind:'mountain_in_region', subject:name, region:reg, basis:'explicit' });
  }
  for (const [name, type, reg, req] of c.places || []) {
    parts.push(`${zhRegion[reg]}${placeText[req] || ''}有${typeText[type]}「${name}」`);
    gold.entities.push({ id:`e${gold.entities.length + 1}`, name, type, basis:'explicit' });
    gold.constraints.push({ id:`c${gold.constraints.length + 1}`, kind:'in_region', subject:name, region:reg, basis:'explicit' });
    if (req) gold.constraints.push({ id:`c${gold.constraints.length + 1}`, kind:req, subject:name, basis:'explicit' });
  }
  if (c.namedLake) { parts.push(`还有湖泊「${c.namedLake}」`);
    gold.entities.push({ id:`e${gold.entities.length + 1}`, name:c.namedLake, type:'lake', basis:'explicit' }); }
  if (c.rivers) { parts.push(`至少有${c.rivers}条大河`);
    gold.constraints.push({ id:`c${gold.constraints.length + 1}`, kind:'min_major_rivers', value:c.rivers, basis:'explicit' }); }
  if (c.lakes) { parts.push(`至少有${c.lakes}个湖泊`);
    gold.constraints.push({ id:`c${gold.constraints.length + 1}`, kind:'min_lakes', value:c.lakes, basis:'explicit' }); }
  if (c.character) { const [metric, level] = c.character; parts.push(charText[metric][level]);
    gold.character.push({ id:'ch1', metric, level, basis:'explicit' }); }
  if (c.conflictRegion) {
    const name = c.places[0][0]; parts.push(`但「${name}」还必须同时位于${zhRegion[c.conflictRegion]}，两个位置要求都不能放弃`);
    const first = gold.constraints.find(x => x.kind === 'in_region' && x.subject === name);
    const second = { id:`c${gold.constraints.length + 1}`, kind:'in_region', subject:name, region:c.conflictRegion, basis:'explicit' };
    gold.constraints.push(second);
    gold.impossible.push({ ids:[first.id, second.id], reason:'同一个地点必须同时位于不同九宫区域' });
  } else if (c.sea === 'none' && (c.places || []).some(p => p[1] === 'port')) {
    const port = c.places.find(p => p[1] === 'port'), coast = gold.constraints.find(x => x.subject === port[0] && ['coast','river_mouth'].includes(x.kind));
    gold.impossible.push({ ids:['sea', coast.id], reason:'无海区域要求海港' });
  }
  return { description:{ id:c.id, split:c.split, tier:c.tier, lang:'zh', author:'programmatic', text:parts.join('；') + '。' }, gold };
}
function main() {
  if (cases.length !== 30 || cases.filter(x => x.split === 'dev').length !== 10 ||
      cases.filter(x => x.split === 'test').length !== 20 || cases.filter(x => x.tier === 'unsat').length !== 5)
    throw new Error('Automated corpus must be 30 cases: 10 dev, 20 test, 5 unsat');
  const compiled = cases.map(compile), root = __dirname, dataFile = path.join(root, 'auto-descriptions.json');
  const write = process.argv.includes('--write');
  const expected = JSON.stringify(compiled.map(x => x.description), null, 2) + '\n';
  if (write) fs.writeFileSync(dataFile, expected);
  else if (!fs.existsSync(dataFile) || fs.readFileSync(dataFile, 'utf8') !== expected) throw new Error('Corpus differs; use --write only before freezing');
  for (const x of compiled) {
    const file = path.join(root, 'gold', x.gold.id + '.json'), value = JSON.stringify(x.gold, null, 2) + '\n';
    if (write) fs.writeFileSync(file, value);
    else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== value) throw new Error(`Gold differs: ${file}`);
  }
  console.log(`Automated corpus ${write ? 'written' : 'verified'}: 30 descriptions and 30 programmatic gold files`);
}
if (require.main === module) try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
module.exports = { cases, compile };

const assert = require('assert');
const { fromDirect, fromWorld, saveRep, loadRep } = require('../experiments/t1/representation');
const { goldCheck, physicsCheck } = require('../experiments/t1/evaluate');
const { createRuntime } = require('../experiments/t1/runtime');
const { runFromPlannedSpec } = require('../experiments/t1/engine');
const { validateData } = require('../experiments/t1/run');
const fs = require('fs'), os = require('os'), path = require('path');
const automatedData = require('../experiments/t1/auto-descriptions.json');
assert.doesNotThrow(() => validateData(automatedData, false, true));
assert.throws(() => validateData(automatedData, false, false), /outside the implementation team/);

const raw = { extent_km: 1024, land: [[[0, 0], [.9, 0], [.9, 1], [0, 1]]], lakes: [],
  mountains: [{ name: '青脊山', area: [[.1, .2], [.25, .2], [.25, .45], [.1, .45]] }],
  biomes: [{ type: 'forest', area: [[.05, .05], [.4, .05], [.4, .5], [.05, .5]] }],
  rivers: [{ name: '青河', points: [[.2, .3], [.5, .5], [.7, .7], [.89, .8], [.91, .8]] }],
  settlements: [{ name: '青湾港', type: 'port', x: .89, y: .8 }], unmet: [] };
const rep = fromDirect(raw);
assert(rep.sea.some(Boolean) && rep.dryLand.some(Boolean));
assert(rep.rivers[0].path.length >= 60);
const gold = { sea: { id: 's', value: 'E', basis: 'explicit' },
  entities: [{ id: 'e1', name: '青湾港', type: 'port', basis: 'explicit' }, { id: 'e2', name: '青脊山', type: 'mountain', basis: 'explicit' }],
  constraints: [{ id: 'c1', kind: 'coast', subject: '青湾港', basis: 'explicit' },
    { id: 'c2', kind: 'river_mouth', subject: '青湾港', basis: 'explicit' },
    { id: 'c3', kind: 'min_major_rivers', value: 1, basis: 'explicit' }], character: [] };
const score = goldCheck(rep, gold);
assert.strictEqual(score.explicitN, 6);
assert(score.explicitRate > .8, JSON.stringify(score));
assert.strictEqual(physicsCheck(rep).counts.P5, 0);
const wrong = fromDirect({ ...raw, settlements: [{ ...raw.settlements[0], type: 'town', x: .97 }] });
assert(goldCheck(wrong, gold).explicitRate < score.explicitRate);
assert(physicsCheck(wrong).counts.P5 >= 1);
const ambiguity = { ...gold, entities: [{ id: 'e1', name: '青湾港', type: 'town', accepted_types: ['port'], basis: 'explicit' }] };
assert(goldCheck(rep, ambiguity).items.find(x => x.id === 'e1').status === 'pass');
const splitLake = fromDirect({ ...raw, lakes: [{ name: '双流湖', area: [[.4,.4],[.55,.4],[.55,.55],[.4,.55]] }],
  rivers: [{ name: '出流甲', points: [[.46,.47],[.3,.3]] }, { name: '出流乙', points: [[.52,.5],[.7,.7]] }] });
assert(physicsCheck(splitLake).counts.P4 >= 1);
const temp = path.join(os.tmpdir(), `t1-rep-${process.pid}.gz`);
saveRep(temp, rep); assert.strictEqual(loadRep(temp).rivers[0].name, '青河'); fs.rmSync(temp);

// The headless runner must use the browser's generator and model-stage source.
const rt = createRuntime(async () => { throw new Error('no paid API in this test'); });
const preset = { name: 'test', seed: 321, landform: 'plains', ocean_side: 'none', wind_from: 'W',
  mountains: [{ name: '云山', region: 'N', angle: 20 }], min_major_rivers: 1, min_lakes: 0,
  settlements: [{ name: '柳城', type: 'town', region: 'C', requires: [] }] };
const spec = rt.normalizeSpec(preset), planned = { spec, P: rt.initParams(spec) };
runFromPlannedSpec(rt, planned, '测试', 'G1', 2).then(r => {
  assert(r.W && r.report && r.trace.length > 0);
  assert.strictEqual(r.trace.length, 1);
  assert.strictEqual(r.trace[0].stage, 'simple_rule_pass');
  assert(r.trace[0].actions.every(x => x.auto || ['fill_depressions', 'recompute_climate'].includes(x.a?.tool)));
  const systemRep = fromWorld(r.W);
  assert.strictEqual(systemRep.rivers.length, r.W.hy.rivers.length);
  assert(systemRep.rivers.every(x => x.path.length >= 60));
  console.log('test_t1 passed');
}).catch(e => { console.error(e); process.exitCode = 1; });

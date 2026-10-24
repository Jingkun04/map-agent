#!/usr/bin/env node
// Development-only offline replay of G1 from saved plans. Never calls an API.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRuntime } = require('./runtime');
const { runFromPlannedSpec } = require('./engine');
const { fromWorld, saveRep } = require('./representation');
const { goldCheck, physicsCheck } = require('./evaluate');

async function main() {
  const a = process.argv.slice(2), arg = k => a[a.indexOf(k) + 1];
  if (!['--source', '--data', '--out'].every(k => a.includes(k)))
    throw new Error('usage: replay-g1.js --source OLD_PILOT_DIR --data pilot-descriptions.json --out NEW_DIR');
  const source = path.resolve(arg('--source')), data = JSON.parse(fs.readFileSync(path.resolve(arg('--data')), 'utf8')),
    out = path.resolve(arg('--out'));
  if (out === source) throw new Error('Replay output must differ from source');
  fs.mkdirSync(out, { recursive: true });
  const rt = createRuntime(async () => { throw new Error('Offline replay cannot call an API'); });
  const rows = [];
  for (const d of data) {
    const key = `${d.id}-1`, oldDir = path.join(source, key), dir = path.join(out, key);
    const plan = JSON.parse(fs.readFileSync(path.join(oldDir, 'plan.json'), 'utf8'));
    const result = await runFromPlannedSpec(rt, plan, d.text, 'G1');
    const rep = fromWorld(result.W), goldFile = path.join(__dirname, 'gold', `${d.id}.json`);
    const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
    const score = goldCheck(rep, gold), physics = physicsCheck(rep);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'G1.json'), JSON.stringify({ spec: result.spec, P: result.P,
      report: result.report, trace: result.trace }, null, 2));
    const repFile = path.join(dir, 'G1.rep.json.gz'), png = path.join(dir, 'G1.png');
    saveRep(repFile, rep);
    const render = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'run-python.js'),
      path.join(__dirname, 'render.py'), repFile, png], { stdio: 'inherit' });
    if (render.status !== 0) throw new Error(`Render failed for ${key}`);
    rows.push({ id: d.id, arm: 'G1', explicit_pass: score.explicitPass, explicit_n: score.explicitN,
      rate: score.explicitRate, own_fails: result.report.fails, physics: physics.counts });
    console.log(`${key}: ${score.explicitPass}/${score.explicitN}`);
  }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ note: 'Development-only G1 offline replay from saved plans; no new G0/G2 API samples.', rows }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });

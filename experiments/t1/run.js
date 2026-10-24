#!/usr/bin/env node
// T1 generation only. Scoring and judging run separately from saved raw maps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRuntime } = require('./runtime');
const { createClient } = require('./client');
const { planOnce, runFromPlannedSpec } = require('./engine');
const { directMap } = require('./direct');
const { fromDirect, fromWorld, saveRep } = require('./representation');

const ROOT = path.resolve(__dirname, '../..');
function args(argv) {
  const o = { data: path.join(__dirname, 'descriptions.json'), out: path.join(__dirname, 'runs'), samples: 3,
    model: 'deepseek-flash', temperature: .7, maxIter: 6, pilot: false, automated: false, dryRun: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pilot') o.pilot = true; else if (a === '--automated') o.automated = true; else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--data') o.data = path.resolve(argv[++i]); else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--samples') o.samples = +argv[++i]; else if (a === '--max-usd') o.maxUsd = +argv[++i];
    else if (a === '--limit') o.limit = +argv[++i]; else if (a === '--model') o.model = argv[++i];
    else if (a === '--temperature') o.temperature = +argv[++i]; else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(o.samples) || o.samples < 1 || o.samples > 3) throw new Error('samples must be 1..3');
  if (o.pilot && o.automated) throw new Error('Use either --pilot or --automated');
  if (!o.pilot && o.samples !== 3) throw new Error('Formal T1 requires 3 samples');
  if (!o.dryRun && !(o.maxUsd > 0)) throw new Error('Paid runs require --max-usd <amount>');
  if (!o.pilot && !o.automated && o.limit !== Infinity) throw new Error('--limit is pilot/automated-only');
  return o;
}
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function hashFiles(files) { return hash(files.map(f => `${f}\n${fs.readFileSync(path.join(ROOT, f))}`).join('\n')); }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + `.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file);
}
function validateData(data, pilot, automated = false) {
  if (!Array.isArray(data) || !data.length) throw new Error('descriptions.json must be a nonempty array');
  const ids = new Set();
  for (const d of data) {
    if (!/^[A-Za-z]\w+$/.test(d.id) || ids.has(d.id) || !['dev', 'test'].includes(d.split) || !['simple', 'multi', 'unsat'].includes(d.tier) || !d.text) throw new Error(`Invalid description ${d.id}`);
    ids.add(d.id);
  }
  if (!pilot) {
    if (data.length !== 30 || data.filter(d => d.split === 'dev').length !== 10 || data.filter(d => d.split === 'test').length !== 20 || data.filter(d => d.tier === 'unsat').length !== 5) throw new Error('Formal T1 needs 30 descriptions: 10 dev, 20 test, 5 unsat');
    if (!automated && data.filter(d => d.author === 'external').length < 10) throw new Error('Formal T1 needs at least 10 descriptions authored outside the implementation team');
    const goldDir = path.join(__dirname, 'gold');
    for (const d of data) {
      const file = path.join(goldDir, d.id + '.json'); if (!fs.existsSync(file)) throw new Error(`Missing adjudicated gold: ${file}`);
      if (!automated) for (const suffix of ['A', 'B']) if (!fs.existsSync(path.join(goldDir, `${d.id}.${suffix}.json`))) throw new Error(`Missing independent gold ${d.id}.${suffix}.json`);
      const g = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (g.id !== d.id || !Array.isArray(g.entities) || !Array.isArray(g.constraints) || !Array.isArray(g.character)) throw new Error(`Invalid gold: ${d.id}`);
      if (d.split === 'test' && d.tier !== 'unsat') {
        const n = (g.entities || []).filter(x => x.basis === 'explicit').length + (g.constraints || []).filter(x => x.basis === 'explicit').length +
          (g.character || []).filter(x => x.basis === 'explicit').length + +(g.sea?.basis === 'explicit' && g.sea?.value !== 'unspecified');
        if (!n) throw new Error(`No explicit checkable gold obligation: ${d.id}`);
      }
    }
  }
}
function manifest(o, data) {
  const source = ['src/core.js', 'src/agent-model.js', 'experiments/t1/runtime.js', 'experiments/t1/engine.js',
    'experiments/t1/direct.js', 'experiments/t1/representation.js', 'experiments/t1/evaluate.js',
    'experiments/t1/client.js', 'experiments/t1/render.py', 'experiments/t1/score.js',
    'experiments/t1/judge.js', 'experiments/t1/analyze.js', 'experiments/t1/human-pack.js',
    'experiments/t1/satisfaction-pack.js',
    'experiments/t1/automated-cases.js'];
  const goldDir = path.join(__dirname, 'gold');
  const gold = data.flatMap(d => [d.id + '.A.json', d.id + '.B.json', d.id + '.json'])
    .map(name => path.join(goldDir, name)).filter(fs.existsSync).map(f => fs.readFileSync(f));
  return { version: 2, study: o.automated ? 'automated' : o.pilot ? 'pilot' : 'human_annotated',
    data_hash: hash(fs.readFileSync(o.data)), gold_hash: hash(Buffer.concat(gold)), code_hash: hashFiles(source),
    model: o.model, temperature: o.temperature, thinking: 'disabled', samples: o.samples, maxIter: o.maxIter,
    description_ids: data.map(d => d.id), pilot: o.pilot, automated: o.automated,
    created_at: new Date().toISOString() };
}
async function main() {
  const o = args(process.argv.slice(2)), data = JSON.parse(fs.readFileSync(o.data, 'utf8'));
  validateData(data, o.pilot, o.automated);
  const selected = data.slice(0, o.limit), mf = manifest(o, data), mfPath = path.join(o.out, 'manifest.json');
  if (fs.existsSync(mfPath)) {
    const prev = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    for (const k of ['data_hash', 'gold_hash', 'code_hash', 'model', 'temperature', 'thinking', 'samples', 'maxIter', 'study'])
      if (prev[k] !== mf[k]) throw new Error(`Manifest mismatch: ${k}; use a new output directory`);
  }
  console.log(JSON.stringify({ descriptions: selected.length, samples: o.samples,
    mode: o.automated ? 'automated' : o.pilot ? 'pilot' : 'human_annotated', output: o.out, dryRun: o.dryRun }));
  if (o.dryRun) return;
  fs.mkdirSync(o.out, { recursive: true }); if (!fs.existsSync(mfPath)) atomic(mfPath, mf);
  let current = { key: '', arm: '' };
  const callsPath = path.join(o.out, 'api-calls.jsonl');
  const prior = fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const spentPeak = prior.reduce((s, c) => s + (c.cost_estimated?.peak_usd || 0), 0);
  if (spentPeak >= o.maxUsd) throw new Error(`Existing call estimates already reach --max-usd ${o.maxUsd}`);
  const client = createClient({ model: o.model, temperature: o.temperature, maxUsd: o.maxUsd - spentPeak,
    onRecord: r => fs.appendFileSync(callsPath, JSON.stringify({ key: current.key, arm: current.arm, ...r }) + '\n') });
  const rt = createRuntime((prompt, stage) => client.json(prompt, stage));
  for (const d of selected) for (let sample = 1; sample <= o.samples; sample++) {
    const key = `${d.id}-${sample}`, dir = path.join(o.out, key); fs.mkdirSync(dir, { recursive: true }); current.key = key;
    const file = arm => path.join(dir, arm + '.json'), done = arm => fs.existsSync(file(arm)) || fs.existsSync(file(arm + '.failed'));
    async function stage(arm, work) {
      if (done(arm)) return fs.existsSync(file(arm)) ? JSON.parse(fs.readFileSync(file(arm), 'utf8')) : null;
      current.arm = arm; const start = Date.now();
      try {
        const result = await work();
        if (result.rep) {
          const repFile = path.join(dir, arm + '.rep.json.gz'), tmp = repFile + `.tmp-${process.pid}`;
          saveRep(tmp, result.rep); fs.renameSync(tmp, repFile);
        }
        atomic(file(arm), { ...result.record, wall_s: (Date.now() - start) / 1000 });
        console.log(`${key} ${arm} complete ${((Date.now() - start) / 1000).toFixed(1)}s`);
        return result.record;
      } catch (e) {
        if (e.code === 'API_BUDGET_REACHED') throw e; // pause cleanly; resume with a higher cap
        atomic(file(arm + '.failed'), { error: String(e.message || e), wall_s: (Date.now() - start) / 1000 });
        console.error(`${key} ${arm} failed: ${String(e.message || e).slice(0, 180)}`);
        return null;
      }
    }
    const planned = await stage('plan', async () => ({ record: await planOnce(rt, d.text) }));
    if (planned) {
      await stage('S0', async () => {
        const W = rt.derive(rt.normalizeSpec(planned.spec), planned.P);
        return { record: { spec: planned.spec, P: planned.P, own_fails: rt.verify(W, null).fails.length }, rep: fromWorld(W) };
      });
      await stage('G1', async () => {
        const result = await runFromPlannedSpec(rt, planned, d.text, 'G1', o.maxIter);
        return { record: { spec: result.spec, P: result.P, report: result.report, trace: result.trace }, rep: fromWorld(result.W) };
      });
    }
    const order = parseInt(hash(key).slice(0, 2), 16) % 2 ? ['G0', 'G2'] : ['G2', 'G0'];
    for (const arm of order) {
      if (arm === 'G2' && !planned) continue;
      if (arm === 'G0') await stage('G0', async () => {
        const raw = await directMap(client, d.text);
        return { record: { raw }, rep: fromDirect(raw) };
      });
      else await stage('G2', async () => {
        const result = await runFromPlannedSpec(rt, planned, d.text, 'G2', o.maxIter);
        return { record: { spec: result.spec, P: result.P, report: result.report, trace: result.trace, finalReview: result.finalReview }, rep: fromWorld(result.W) };
      });
    }
  }
  console.log(JSON.stringify({ finished: true, new_calls: client.stats().calls, conservative_peak_usd: spentPeak + client.stats().conservative_peak_usd }));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { args, validateData, manifest };

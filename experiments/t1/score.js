#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadRep } = require('./representation');
const { goldCheck, physicsCheck } = require('./evaluate');
const { manifest: makeManifest } = require('./run');
function csv(rows, fields) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [fields.join(','), ...rows.map(r => fields.map(f => esc(r[f])).join(','))].join('\n') + '\n';
}
function main() {
  const a = process.argv.slice(2), at = k => a[a.indexOf(k) + 1];
  if (!a.includes('--out') || !a.includes('--data')) throw new Error('usage: score.js --out RUN_DIR --data descriptions.json [--render]');
  const out = path.resolve(at('--out')), data = JSON.parse(fs.readFileSync(path.resolve(at('--data')), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const current = makeManifest({ data: path.resolve(at('--data')), model: manifest.model, temperature: manifest.temperature,
    samples: manifest.samples, maxIter: manifest.maxIter, pilot: manifest.pilot, automated: manifest.automated }, data);
  for (const k of ['data_hash', 'gold_hash', 'code_hash']) if (current[k] !== manifest[k]) {
    if (!manifest.pilot) throw new Error(`Frozen manifest mismatch: ${k}`);
    console.warn(`Pilot warning: ${k} changed since generation; scoring is exploratory.`);
  }
  const rows = [], detailed = [];
  for (const d of data) {
    const gf = path.join(__dirname, 'gold', d.id + '.json');
    const gold = fs.existsSync(gf) ? JSON.parse(fs.readFileSync(gf, 'utf8')) : null;
    for (let sample = 1; sample <= manifest.samples; sample++) {
      const key = `${d.id}-${sample}`, dir = path.join(out, key);
      if (!fs.existsSync(dir)) continue;
      for (const arm of ['S0', 'G0', 'G1', 'G2']) {
        const repFile = path.join(dir, arm + '.rep.json.gz'), resultFile = path.join(dir, arm + '.json');
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
        const failed = fs.existsSync(path.join(dir, arm + '.failed.json'));
        if (!result && !failed) continue;
        const declared = arm === 'G0' ? result?.raw?.unmet : result?.P?.unsat;
        let p = null, g = null, strict = null;
        if (fs.existsSync(repFile)) {
          const rep = loadRep(repFile); p = physicsCheck(rep);
          if (gold) { g = goldCheck(rep, gold); strict = goldCheck(rep, gold, { strict: true }); }
          if (a.includes('--render')) {
            const png = path.join(dir, arm + '.png');
            if (!fs.existsSync(png)) {
              const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'run-python.js'), path.join(__dirname, 'render.py'), repFile, png], { stdio: 'inherit' });
              if (r.status !== 0) throw new Error(`Render failed: ${repFile}`);
            }
          }
        }
        const row = { desc_id: d.id, split: d.split, tier: d.tier, sample, arm, model_id: manifest.model,
          code_hash: manifest.code_hash, prompt_hash: manifest.code_hash, temperature: manifest.temperature,
          failed: failed ? 1 : 0, wall_s: result?.wall_s,
          gold_explicit_pass: g?.explicitPass ?? 0, gold_explicit_n: g?.explicitN ?? (gold ?
            (gold.entities || []).filter(x => x.basis === 'explicit').length + (gold.constraints || []).filter(x => x.basis === 'explicit').length +
            (gold.character || []).filter(x => x.basis === 'explicit').length + +(gold.sea?.basis === 'explicit' && gold.sea?.value !== 'unspecified') : null),
          gold_explicit_rate: g?.explicitRate ?? (failed && gold ? 0 : null), strict_rate: strict?.explicitRate,
          all_sat: g?.allSat == null ? '' : +g.allSat,
          entity_recall: g?.entityRecall, entity_type_acc: g?.entityTypeAcc, character_rate: g?.characterRate,
          phys_P1: p?.counts.P1, phys_P2: p?.counts.P2, phys_P3: p?.counts.P3, phys_P4: p?.counts.P4, phys_P5: p?.counts.P5,
          phys_total: p?.total, phys_per_river: p?.perRiver, phys_per_1000km: p?.per1000Km,
          own_verify_fails: result?.report?.fails ?? result?.own_fails, own_score: result?.report?.score?.join('/'),
          invented_n: result?.spec?.settlements?.filter(s => s.invented).length ?? 0,
          unsat_truth: d.tier === 'unsat' ? 1 : 0,
          unsat_declared: Array.isArray(declared) && declared.length ? 1 : 0,
          unsat_declared_count: Array.isArray(declared) ? declared.length : 0,
          unsat_class: '', partial: 0 };
        rows.push(row); detailed.push({ ...row, gold: g, strictGold: strict, physics: p });
      }
    }
  }
  const calls = fs.existsSync(path.join(out, 'api-calls.jsonl')) ? fs.readFileSync(path.join(out, 'api-calls.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  for (const row of rows) {
    const key = `${row.desc_id}-${row.sample}`;
    const own = calls.filter(c => c.key === key && c.arm === row.arm);
    const plan = calls.filter(c => c.key === key && c.arm === 'plan');
    row.llm_calls = own.length; row.retry_calls = own.filter(c => /:retry$|:transport_retry\d+$/.test(c.stage || '')).length;
    row.prompt_tokens = own.reduce((n, c) => n + (c.usage?.prompt_tokens || 0), 0);
    row.completion_tokens = own.reduce((n, c) => n + (c.usage?.completion_tokens || 0), 0);
    row.cost_actual = ''; // API usage does not include charged money.
    row.cost_estimated_offpeak = own.reduce((n, c) => n + (c.cost_estimated?.offpeak_usd || 0), 0);
    row.cost_deployment_offpeak = row.cost_estimated_offpeak + (['G1', 'G2', 'S0'].includes(row.arm) ? plan.reduce((n, c) => n + (c.cost_estimated?.offpeak_usd || 0), 0) : 0);
  }
  const fields = Object.keys(rows[0] || { desc_id: 1 });
  fs.writeFileSync(path.join(out, 'runs.csv'), csv(rows, fields));
  fs.writeFileSync(path.join(out, 'scores.json'), JSON.stringify(detailed, null, 2));
  console.log(`Scored ${rows.length} rows; wrote ${path.join(out, 'runs.csv')}`);
}
if (require.main === module) try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
module.exports = { csv };

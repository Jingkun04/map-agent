#!/usr/bin/env node
// Read score.json, report per-description paired differences. Pilot results remain descriptive.
const fs = require('fs');
const path = require('path');
function group(rows) {
  const by = {};
  for (const r of rows) {
    const key = `${r.desc_id}:${r.arm}`;
    (by[key] ||= []).push(r.gold_explicit_rate);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}
function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function inference(diffs, seed = 4213) {
  const values = diffs.map(x => x.difference), n = values.length;
  if (!n) return null;
  let s = seed >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const boots = Array.from({ length: 10000 }, () => mean(Array.from({ length: n }, () => values[Math.floor(rand() * n)]))).sort((a, b) => a - b);
  const observed = Math.abs(mean(values));
  let extreme = 0, trials = 0;
  const count = 1 << n;
  for (let mask = 0; mask < count; mask++) {
    let sum = 0; for (let j = 0; j < n; j++) sum += (mask & (1 << j) ? 1 : -1) * values[j];
    if (Math.abs(sum / n) >= observed - 1e-12) extreme++;
    trials++;
  }
  return { ci95: [boots[249], boots[9749]], permutation_p: extreme / trials };
}
function judgeSummary(file) {
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const [desc_id, sample, pair, order, choice] = line.split(','); return { desc_id, sample, pair, order, choice };
  });
  const groups = {};
  for (const r of rows) (groups[`${r.desc_id}:${r.sample}:${r.pair}`] ||= []).push(r);
  const result = {};
  for (const [key, two] of Object.entries(groups)) {
    const [a, b] = two[0].pair.split('-');
    const winner = r => r.choice === '差不多' || r.choice === 'invalid' ? null :
      r.order === 'AB' ? (r.choice === 'A' ? a : b) : (r.choice === 'A' ? b : a);
    const w = two.length === 2 && winner(two[0]) && winner(two[0]) === winner(two[1]) ? winner(two[0]) : 'tie';
    const slot = result[`${a}-${b}`] ||= { [a]: 0, [b]: 0, tie: 0, cases: [] };
    slot[w]++; slot.cases.push({ key, winner: w });
  }
  return result;
}
function main() {
  const a = process.argv.slice(2), ix = a.indexOf('--out'); if (ix < 0) throw new Error('usage: analyze.js --out RUN_DIR');
  const out = path.resolve(a[ix + 1]), mf = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(path.join(out, 'scores.json'), 'utf8'));
  const eligible = rows.filter(r => r.gold_explicit_rate != null && r.arm !== 'S0' && r.tier !== 'unsat' && (mf.pilot || r.split === 'test'));
  if (!mf.pilot) {
    const testIds = [...new Set(eligible.map(r => r.desc_id))];
    if (testIds.length !== 17) throw new Error(`Formal main analysis requires 17 satisfiable test descriptions, found ${testIds.length}`);
    for (const id of testIds) for (const arm of ['G0', 'G1', 'G2'])
      if (eligible.filter(r => r.desc_id === id && r.arm === arm).length !== 3) throw new Error(`Missing samples: ${id} ${arm}`);
  }
  const means = group(eligible), ids = [...new Set(eligible.map(r => r.desc_id))];
  const arms = ['G0', 'G1', 'G2'];
  const perArm = Object.fromEntries(arms.map(arm => {
    const vals = ids.map(id => means[`${id}:${arm}`]).filter(Number.isFinite);
    return [arm, { descriptions: vals.length, mean_gold_rate: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      values: Object.fromEntries(ids.map(id => [id, means[`${id}:${arm}`] ?? null])) }];
  }));
  const pairs = {};
  for (const [a, b] of [['G2', 'G0'], ['G2', 'G1'], ['G1', 'G0']]) {
    const diffs = ids.filter(id => Number.isFinite(means[`${id}:${a}`]) && Number.isFinite(means[`${id}:${b}`]))
      .map(id => ({ id, difference: means[`${id}:${a}`] - means[`${id}:${b}`] }));
    pairs[`${a}-${b}`] = { n: diffs.length, mean_difference: diffs.length ? mean(diffs.map(x => x.difference)) : null,
      ...(!mf.pilot ? inference(diffs) : {}), diffs };
  }
  if (!mf.pilot) {
    const primary = ['G2-G0', 'G2-G1'].sort((a, b) => pairs[a].permutation_p - pairs[b].permutation_p);
    pairs[primary[0]].holm_p = Math.min(1, pairs[primary[0]].permutation_p * 2);
    pairs[primary[1]].holm_p = Math.max(pairs[primary[0]].holm_p, pairs[primary[1]].permutation_p);
  }
  const report = { pilot: mf.pilot, study: mf.study || (mf.pilot ? 'pilot' : 'human_annotated'),
    note: mf.pilot ? 'Development-set pilot; no confirmatory significance test.' : mf.automated ?
      'Exploratory automated corpus with programmatic gold; no independent authors, human gold adjudication, or human judge calibration.' :
      'Paired results from the frozen human-annotated holdout set.',
    perArm, pairs, imageJudge: judgeSummary(path.join(out, 'judge_pairs.csv')) };
  fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }

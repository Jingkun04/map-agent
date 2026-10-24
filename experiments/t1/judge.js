#!/usr/bin/env node
// Pairwise image judge. Human-annotated mode requires calibration; automated
// mode runs exploratory comparisons without claiming human agreement.
const fs = require('fs');
const path = require('path');
const { createClient } = require('./client');
const { csv } = require('./score');
function options(a) {
  const get = k => a[a.indexOf(k) + 1];
  if (!a.includes('--out') || !a.includes('--data') || !a.includes('--max-usd')) throw new Error('usage: judge.js --out RUN_DIR --data descriptions.json --max-usd 1 [--pilot] [--calibration FILE]');
  return { out: path.resolve(get('--out')), data: path.resolve(get('--data')), maxUsd: +get('--max-usd'),
    pilot: a.includes('--pilot'), calibration: a.includes('--calibration') ? path.resolve(get('--calibration')) : null };
}
const img = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
function answer(text) {
  const m = String(text).trim().match(/^(差不多|A|B|平局)/i);
  return m ? (m[1] === '平局' ? '差不多' : m[1].toUpperCase()) : 'invalid';
}
async function main() {
  const o = options(process.argv.slice(2)), data = JSON.parse(fs.readFileSync(o.data, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(o.out, 'manifest.json'), 'utf8'));
  const journal = path.join(o.out, 'judge-calls.jsonl');
  const prior = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const spent = prior.reduce((s, x) => s + (x.cost_estimated?.peak_usd || 0), 0);
  if (!(o.maxUsd > spent)) throw new Error('Judge cost cap reached');
  let current = '';
  const client = createClient({ model: manifest.model, temperature: manifest.temperature, maxUsd: o.maxUsd - spent,
    onRecord: r => fs.appendFileSync(journal, JSON.stringify({ key: current, ...r }) + '\n') });
  const result = path.join(o.out, 'judge_pairs.csv');
  const rows = fs.existsSync(result) ? fs.readFileSync(result, 'utf8').trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const p = line.split(','); return { desc_id: p[0], sample: +p[1], pair: p[2], order: p[3], choice: p[4], response: p[5] };
  }) : [];
  const fields = ['desc_id', 'sample', 'pair', 'order', 'choice', 'response'];
  if (!o.pilot && !manifest.automated) {
    if (!o.calibration) throw new Error('Formal judge requires --calibration with at least 20 human-labelled dev maps');
    const cases = JSON.parse(fs.readFileSync(o.calibration, 'utf8'));
    if (!Array.isArray(cases) || cases.length < 20) throw new Error('Calibration needs at least 20 maps');
    const calFile = path.join(o.out, 'judge-calibration.json');
    let cal = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, 'utf8')) : [];
    for (const c of cases) {
      if (cal.some(x => x.id === c.id)) continue;
      if (!fs.existsSync(path.resolve(c.image))) throw new Error(`Missing calibration image: ${c.image}`);
      current = `cal:${c.id}`;
      const prompt = `For this map, judge each listed geographic requirement using only what is visibly shown. Return JSON {"items":[{"id":"...","status":"pass|fail|unclear"}]}. Do not infer hidden facts.\n${JSON.stringify(c.checklist.map(x => ({ id: x.id, text: x.text })))}`;
      const response = await client.json([{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: img(path.resolve(c.image)) } }], 'judge_checklist', { image: true, max_tokens: 500 });
      cal.push({ id: c.id, human: c.checklist, model: response.items || [] });
      fs.writeFileSync(calFile, JSON.stringify(cal, null, 2));
    }
    let matched = 0, total = 0;
    for (const c of cal) for (const h of c.human) {
      const m = c.model.find(x => x.id === h.id);
      if (!m) continue; total++; if (m.status === h.human) matched++;
    }
    const accuracy = matched / Math.max(1, total);
    if (accuracy < .8) throw new Error(`Judge calibration accuracy ${accuracy.toFixed(3)} < 0.8; pairwise judging disabled`);
    console.log(`Judge calibration ${matched}/${total} = ${accuracy.toFixed(3)}`);
  }
  if (manifest.automated) console.log('Automated study: image judge is exploratory and has no human calibration.');
  for (const d of data.filter(d => o.pilot ? d.split === 'dev' : d.split === 'test')) {
    for (let sample = 1; sample <= manifest.samples; sample++) {
      const dir = path.join(o.out, `${d.id}-${sample}`);
      for (const [a, b] of [['G0', 'G1'], ['G0', 'G2'], ['G1', 'G2']]) {
        if (![a, b].every(x => fs.existsSync(path.join(dir, x + '.png')))) continue;
        for (const order of ['AB', 'BA']) {
          const pair = `${a}-${b}`;
          if (rows.some(r => r.desc_id === d.id && r.sample === sample && r.pair === pair && r.order === order)) continue;
          const [left, right] = order === 'AB' ? [a, b] : [b, a]; current = `${d.id}-${sample}:${pair}:${order}`;
          const content = [
            { type: 'text', text: `描述：${d.text}\n哪张图更符合描述？只看地理内容，不看画风。回答 A/B/差不多，附一句理由。` },
            { type: 'text', text: '图 A' }, { type: 'image_url', image_url: { url: img(path.join(dir, left + '.png')) } },
            { type: 'text', text: '图 B' }, { type: 'image_url', image_url: { url: img(path.join(dir, right + '.png')) } },
          ];
          const text = await client.call(content, 'judge_pair', { image: true, max_tokens: 150 });
          rows.push({ desc_id: d.id, sample, pair, order, choice: answer(text), response: text.replace(/[\r\n,]+/g, ' ').slice(0, 200) });
          fs.writeFileSync(result, csv(rows, fields));
          console.log(`${current}: ${answer(text)}`);
        }
      }
    }
  }
  console.log(`Judge responses: ${rows.length}`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { answer };

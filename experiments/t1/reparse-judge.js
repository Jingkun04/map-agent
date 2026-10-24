#!/usr/bin/env node
// Post-hoc, deterministic parsing of saved image-judge text. Keeps the original
// CSV intact so the model responses and first-pass labels remain auditable.
const fs = require('fs');
const path = require('path');
const { csv } = require('./score');

function choiceFromResponse(response) {
  let s = String(response || '').trim();
  s = s.replace(/^\*{0,2}\s*(?:回答|答案)\s*[:：]\s*\*{0,2}/, '');
  s = s.replace(/^\*{1,2}/, '');
  const m = s.match(/^(差不多|平局|A|B)(?=\*|\s|[:：。.,，]|图|$)/i);
  return m ? (/^(差不多|平局)$/.test(m[1]) ? '差不多' : m[1].toUpperCase()) : 'invalid';
}

function summarize(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.desc_id}:${r.sample}:${r.pair}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const summary = {};
  for (const [key, two] of groups) {
    const [a, b] = two[0].pair.split('-');
    const slot = summary[`${a}-${b}`] ||= { [a]: 0, [b]: 0, tie: 0, comparisons: 0 };
    const winner = r => r.choice === 'invalid' || r.choice === '差不多' ? null :
      r.order === 'AB' ? (r.choice === 'A' ? a : b) : (r.choice === 'A' ? b : a);
    const w = two.length === 2 && winner(two[0]) && winner(two[0]) === winner(two[1]) ? winner(two[0]) : 'tie';
    slot[w]++;
    slot.comparisons++;
  }
  return summary;
}

function main() {
  const args = process.argv.slice(2), i = args.indexOf('--out');
  if (i < 0 || !args[i + 1]) throw new Error('usage: reparse-judge.js --out RUN_DIR');
  const out = path.resolve(args[i + 1]);
  const source = fs.readFileSync(path.join(out, 'judge_pairs.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const journal = fs.readFileSync(path.join(out, 'judge-calls.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const responses = new Map(journal.filter(x => x.response && x.status === 200).map(x => [x.key, x.response]));
  const rows = source.map(line => {
    const [desc_id, sample, pair, order, choice] = line.split(',');
    const key = `${desc_id}-${sample}:${pair}:${order}`;
    const response = responses.get(key);
    if (!response) throw new Error(`Missing successful raw response: ${key}`);
    const parsed = choice === 'invalid' ? choiceFromResponse(response) : choice;
    return { desc_id, sample: +sample, pair, order, choice: parsed, response: response.replace(/[\r\n,]+/g, ' ').slice(0, 200) };
  });
  const fields = ['desc_id', 'sample', 'pair', 'order', 'choice', 'response'];
  fs.writeFileSync(path.join(out, 'judge_pairs_reparsed.csv'), csv(rows, fields));
  const report = {
    method: 'Post-hoc deterministic prefix parsing of saved responses; original judge_pairs.csv retained.',
    responses: rows.length,
    originally_invalid: source.filter(line => line.includes(',invalid,')).length,
    still_invalid: rows.filter(r => r.choice === 'invalid').length,
    original: summarize(source.map(line => {
      const [desc_id, sample, pair, order, choice] = line.split(',');
      return { desc_id, sample: +sample, pair, order, choice };
    })),
    reparsed: summarize(rows),
  };
  fs.writeFileSync(path.join(out, 'image-judge-reparsed-summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
module.exports = { choiceFromResponse, summarize };

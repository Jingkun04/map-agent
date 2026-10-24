const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { build } = require('../experiments/t1/satisfaction-pack');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-satisfaction-'));
const desc = [];
for (let i = 1; i <= 3; i++) {
  const id = `T0${i}`;
  desc.push({ id, split:'test', text:i === 1 ? '测试</script><img src=x>' : `测试${i}` });
  const sample = path.join(dir, `${id}-1`); fs.mkdirSync(sample);
  for (const arm of ['G0','G1','G2']) fs.copyFileSync(path.join(__dirname, '..', 'docs', 'screenshots', 'map-2d.png'), path.join(sample, `${arm}.png`));
}
const data = path.join(dir, 'data.json'); fs.writeFileSync(data, JSON.stringify(desc));
build(dir, data, 2);
const html = fs.readFileSync(path.join(dir, 'satisfaction', 'rate.html'), 'utf8');
assert(!html.includes('</script><img'));
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert.strictEqual(fs.readdirSync(path.join(dir, 'satisfaction', 'images')).length, 6);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'satisfaction', 'blinding-key.json'))).length, 6);
console.log('test_satisfaction_pack passed');

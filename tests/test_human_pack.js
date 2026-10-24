const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os');
const vm = require('vm');
const { build } = require('../experiments/t1/human-pack');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 't1-human-'));
const data = [];
for (let i = 1; i <= 10; i++) {
  const id = 'H' + String(i).padStart(2, '0');
  data.push({ id, split: 'test', text: '测试描述' + i + (i === 1 ? '</script><img src=x onerror=alert(1)>' : '') });
  const dir = path.join(base, id + '-1'); fs.mkdirSync(dir);
  for (const arm of ['G0', 'G1', 'G2'])
    fs.copyFileSync(path.join(__dirname, '..', 'docs', 'screenshots', 'map-2d.png'), path.join(dir, arm + '.png'));
}
const list = path.join(base, 'fixture.json'); fs.writeFileSync(list, JSON.stringify(data));
build(base, list, 2);
const html = fs.readFileSync(path.join(base, 'human', 'rater-01.html'), 'utf8');
assert(html.includes('下载结果 CSV'));
assert((html.match(/测试描述/g) || []).length === 10);
assert(!html.includes('</script><img'));
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert(fs.existsSync(path.join(base, 'human', 'blinding-key.json')));
console.log('test_human_pack passed');

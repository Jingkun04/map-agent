// Small, paid DeepSeek probes for planning T1. Not the formal experiment runner.
// Reads .env locally and records usage only; never writes credentials.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error('DEEPSEEK_API_KEY missing');
const outPath = path.join(ROOT, 'results', 'deepseek-t1-probes.json');
const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
const descriptions = [
  '东临大海的温带海岸，至少一条大河入海。东部河口有港口「青湾港」，西部有山脉「青脊山」。',
  '炎热干旱的内陆盆地，四周是山，没有海。中部有绿洲城「沙泉城」，北部山脚有要塞「赤石堡」，至少一条大河流经盆地。',
];
const schema = `坐标均为 0 到 1 的比例，x 向东，y 向南。只输出一个合法 JSON 对象，不要 Markdown：
{"extent_km":1024,"land":[[[0,0],[1,0],[1,1],[0,1]]],"lakes":[{"name":"","area":[[0.4,0.4],[0.5,0.4],[0.5,0.5]]}],"mountains":[{"name":"山名","area":[[0.2,0.2],[0.4,0.2],[0.3,0.4]]}],"biomes":[{"type":"desert","area":[[0,0],[0.2,0],[0.2,0.2]]}],"rivers":[{"name":"河名","points":[[0.3,0.3],[0.5,0.5],[0.7,0.8]]}],"settlements":[{"name":"城名","type":"city","x":0.5,"y":0.5}],"unmet":[]}
extent_km 只能取 1024、2048、4096；land 是大陆/岛屿的多边形数组，多边形外为海，内陆世界用覆盖全图的陆地；湖泊和山脉的 area 是多边形；biomes.type 只能是 desert/grassland/forest/marsh/tundra/ice/rock，未覆盖陆地默认草地；河流 points 是从源头到河口依序排列的折线；settlements.type 只能是 port/city/town/village/fortress。
规则：河流由高处向低处流，最终入海、入湖或出图，不能半路断掉；只汇合不分叉；湖泊最多一个出口；港口临海，河口港放在河流入海处；说内陆或没有海则全图没有海；山脉背风面更干燥。原文中用「」标出的地名必须全部出现，名字一致。允许补出少量合理地点。做不到的要求写入 unmet 并给原因，不要偷偷修改原文。请给足以看出地理布局的几何细节，不要只画几个点。`;
function usageCost(u) {
  const hit = u?.prompt_cache_hit_tokens ?? 0;
  const miss = u?.prompt_cache_miss_tokens ?? Math.max(0, (u?.prompt_tokens ?? 0) - hit);
  return { offpeak_usd: (hit * 0.003 + miss * 0.15 + (u?.completion_tokens ?? 0) * 0.6) / 1e6,
    peak_usd: (hit * 0.006 + miss * 0.30 + (u?.completion_tokens ?? 0) * 1.2) / 1e6 };
}
async function request(kind, content, max_tokens = 8000) {
  const started = Date.now();
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model: 'deepseek-flash', stream: false, thinking: { type: 'disabled' }, max_tokens,
      messages: [{ role: 'user', content }] }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${kind}: HTTP ${response.status}: ${JSON.stringify(body.error || {}).slice(0, 300)}`);
  const record = { kind, model: body.model, seconds: +(Date.now() - started) / 1000,
    usage: body.usage, ...usageCost(body.usage), finish_reason: body.choices?.[0]?.finish_reason };
  const answer = body.choices?.[0]?.message?.content || '';
  if (kind.startsWith('g0')) {
    try {
      const obj = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      record.json_valid = true;
      record.fields = Object.fromEntries(['land', 'lakes', 'mountains', 'biomes', 'rivers', 'settlements', 'unmet'].map(k => [k, Array.isArray(obj[k]) ? obj[k].length : null]));
      record.extent_km = obj.extent_km;
      record.named = ['青湾港', '青脊山', '沙泉城', '赤石堡'].filter(n => answer.includes(n));
    } catch { record.json_valid = false; record.answer_chars = answer.length; }
  } else { record.reply = answer.slice(0, 100); }
  existing.push(record);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
  console.log(JSON.stringify(record));
}
async function main() {
  for (let i = 0; i < descriptions.length; i++) {
    if (!existing.some(x => x.kind === `g0_${i + 1}`)) await request(`g0_${i + 1}`, `${schema}\n\n地图描述：${descriptions[i]}`);
  }
  // Existing project screenshots test the image API and billing only; they do not form a fair T1 pair.
  const png = ['map-2d.png', 'gamemap-region.png'].map(name =>
    'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'docs', 'screenshots', name)).toString('base64'));
  for (let i = 0; i < 2; i++) {
    if (existing.some(x => x.kind === `vision_${i + 1}`)) continue;
    const images = i ? [...png].reverse() : png;
    await request(`vision_${i + 1}`, [
      { type: 'text', text: `描述：${descriptions[0]}\n哪张图更符合描述？只看地理内容，不看画风。回答 A/B/差不多，附一句理由。` },
      { type: 'text', text: '图 A' }, { type: 'image_url', image_url: { url: images[0] } },
      { type: 'text', text: '图 B' }, { type: 'image_url', image_url: { url: images[1] } },
    ], 150);
  }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });

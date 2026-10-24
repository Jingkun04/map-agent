#!/usr/bin/env node
// Optional, single-metric human supplement for a completed automated study.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const escapeHTML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const scriptJSON = x => JSON.stringify(x).replace(/</g, '\\u003c');
function build(out, data, count = 10) {
  const src = JSON.parse(fs.readFileSync(data, 'utf8')).filter(d => d.split === 'test');
  if (!Number.isInteger(count) || src.length < count || count < 1) throw new Error('Invalid satisfaction count');
  const chosen = Array.from({ length: count }, (_, i) => src[Math.floor((i + .5) * src.length / count)]);
  if (chosen.some(d => !/^[A-Za-z]\w+$/.test(d.id))) throw new Error('Invalid description ID');
  const dir = path.join(out, 'satisfaction'), assets = path.join(dir, 'images');
  fs.mkdirSync(assets, { recursive: true });
  const secret = crypto.randomBytes(6).toString('hex'), pages = [], key = [];
  for (const d of chosen) {
    const arms = ['G0', 'G1', 'G2'], shift = parseInt(crypto.createHash('sha256').update(d.id).digest('hex').slice(0, 2), 16) % 3;
    const rotated = arms.map((_, i) => arms[(i + shift) % 3]);
    const images = rotated.map((arm, i) => {
      const source = path.join(out, `${d.id}-1`, `${arm}.png`), name = `${d.id}-${i + 1}.png`;
      if (!fs.existsSync(source)) throw new Error(`Missing rendered map: ${source}`);
      fs.copyFileSync(source, path.join(assets, name));
      key.push({ desc_id:d.id, label:'ABC'[i], arm });
      return { label:'ABC'[i], src:`images/${name}` };
    });
    pages.push({ id:d.id, text:escapeHTML(d.text), images });
  }
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>地图满意度</title><style>body{font:16px/1.5 sans-serif;background:#f6f3eb;color:#263535;max-width:1200px;margin:24px auto;padding:0 16px}article{background:#fff;border-radius:12px;padding:20px;margin:20px 0}.maps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}img{width:100%;border:1px solid #aaa}select,button{font-size:17px;padding:6px}button{padding:10px 20px}@media(max-width:800px){.maps{grid-template-columns:1fr}}</style><h1>地图满意度</h1><p>请根据描述为每张地图的总体满意度打 1–5 分：1 很不满意，5 很满意。只用于补充自动评测，可随时退出。完成后下载 CSV 并交给组织者。</p><main id="pages"></main><button id="download">下载满意度 CSV</button><script>const code=${scriptJSON(secret)},pages=${scriptJSON(pages)};const root=document.querySelector('#pages');root.innerHTML=pages.map(p=>'<article data-id="'+p.id+'"><h2>'+p.id+'</h2><p>'+p.text+'</p><div class="maps">'+p.images.map(m=>'<div><h3>图 '+m.label+'</h3><a href="'+m.src+'" target="_blank"><img src="'+m.src+'"></a><label>满意度 <select data-label="'+m.label+'"><option value="">未评分</option>'+[1,2,3,4,5].map(n=>'<option>'+n+'</option>').join('')+'</select></label></div>').join('')+'</div></article>').join('');document.querySelector('#download').onclick=()=>{const rows=['rater,desc_id,label,satisfaction'];for(const p of pages){const article=[...document.querySelectorAll('article')].find(x=>x.dataset.id===p.id);for(const m of p.images){const v=article.querySelector('select[data-label="'+m.label+'"]').value;if(!v){alert('请完成 '+p.id+' 的评分');return}rows.push([code,p.id,m.label,v].join(','))}}const blob=new Blob([rows.join(String.fromCharCode(10))+String.fromCharCode(10)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='satisfaction-'+code+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>`;
  fs.writeFileSync(path.join(dir, 'rate.html'), html);
  fs.writeFileSync(path.join(dir, 'blinding-key.json'), JSON.stringify(key, null, 2));
  console.log(`Wrote ${path.join(dir, 'rate.html')} (${count} descriptions, 3 maps each)`);
}
if (require.main === module) try {
  const a = process.argv.slice(2), at = k => a[a.indexOf(k) + 1];
  if (!a.includes('--out') || !a.includes('--data')) throw new Error('usage: satisfaction-pack.js --out RUN_DIR --data descriptions.json [--count 10]');
  build(path.resolve(at('--out')), path.resolve(at('--data')), a.includes('--count') ? +at('--count') : 10);
} catch (e) { console.error(e.message); process.exitCode = 1; }
module.exports = { build };

#!/usr/bin/env node
// Build blinded static rating packs; no network service and no participant identities collected.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const escapeHTML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
function build(out, data, raters = 6) {
  const src = JSON.parse(fs.readFileSync(data, 'utf8'));
  const chosen = src.filter(d => d.split === 'test').slice(0, 10);
  if (chosen.length !== 10) throw new Error('Human pack requires at least 10 test descriptions');
  if (chosen.some(d => !/^[A-Za-z]\w+$/.test(d.id))) throw new Error('Invalid description ID for human pack');
  const dir = path.join(out, 'human'), assets = path.join(dir, 'images'); fs.mkdirSync(assets, { recursive: true });
  const key = [];
  for (const d of chosen) {
    for (const [j, arm] of ['G0', 'G1', 'G2'].entries()) {
      const from = path.join(out, `${d.id}-1`, `${arm}.png`);
      if (!fs.existsSync(from)) throw new Error(`Missing rendered map ${from}`);
      fs.copyFileSync(from, path.join(assets, `${d.id}-${j + 1}.png`));
    }
  }
  for (let r = 0; r < raters; r++) {
    const code = crypto.randomBytes(6).toString('hex'), pages = [];
    for (const d of chosen) {
      const rotation = (r + chosen.indexOf(d)) % 3;
      const ids = [0, 1, 2].map(j => (j + rotation) % 3);
      pages.push({ id: d.id, text: escapeHTML(d.text), images: ids.map((j, k) => ({ label: 'ABC'[k], src: `images/${d.id}-${j + 1}.png` })) });
      key.push({ rater: code, desc_id: d.id, A: ['G0','G1','G2'][ids[0]], B: ['G0','G1','G2'][ids[1]], C: ['G0','G1','G2'][ids[2]] });
    }
    const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>地图评价</title><style>body{font:16px/1.5 sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;background:#f6f3eb;color:#263535}article{background:white;padding:20px;margin:24px 0;border-radius:12px}.maps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.maps img{width:100%;cursor:zoom-in;border:1px solid #bbb}.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}label{display:block;margin:8px 0}select{font-size:16px;padding:4px}button{padding:10px 20px;font-size:17px}@media(max-width:800px){.maps,.scores{grid-template-columns:1fr}}</style><h1>地区地图评价</h1><p>自愿、匿名，可随时退出。请只看描述和地图，为每张图评 1–5 分，并选一张最喜欢的。图片可点开查看。完成后点击“下载结果”，把下载的 CSV 交给组织者。编号不包含姓名。</p><main id="pages"></main><button id="download">下载结果 CSV</button><script>const code=${scriptJSON(code)},pages=${scriptJSON(pages)};const root=document.querySelector('#pages');root.innerHTML=pages.map(p=>'<article data-id="'+p.id+'"><h2>'+p.id+'</h2><p>'+p.text+'</p><div class="maps">'+p.images.map(m=>'<div><h3>图 '+m.label+'</h3><a href="'+m.src+'" target="_blank"><img src="'+m.src+'"></a></div>').join('')+'</div><div class="scores">'+p.images.map(m=>'<div><h3>图 '+m.label+'</h3>'+['忠实度','合理性','跑团可用性'].map((n,k)=>'<label>'+n+' <select data-label="'+m.label+'" data-metric="'+k+'"><option value="">未评分</option>'+[1,2,3,4,5].map(x=>'<option>'+x+'</option>').join('')+'</select></label>').join('')+'</div>').join('')+'</div><label>最喜欢 <select class="preferred"><option value="">未选择</option><option>A</option><option>B</option><option>C</option></select></label></article>').join('');document.querySelector('#download').onclick=()=>{const rows=['rater,desc_id,label,fidelity,plausibility,usable,preferred'];for(const p of pages){const a=[...document.querySelectorAll('article')].find(x=>x.dataset.id===p.id),fav=a.querySelector('.preferred').value;for(const m of p.images){const v=[0,1,2].map(k=>a.querySelector('select[data-label="'+m.label+'"][data-metric="'+k+'"]').value);if(v.some(x=>!x)||!fav){alert('请完成 '+p.id+' 的所有评分和偏好');return}rows.push([code,p.id,m.label,...v,fav].join(','))}}const b=new Blob([rows.join(String.fromCharCode(10))+String.fromCharCode(10)],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='ratings-'+code+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};</script></html>`;
    fs.writeFileSync(path.join(dir, `rater-${String(r + 1).padStart(2, '0')}.html`), html);
  }
  fs.writeFileSync(path.join(dir, 'blinding-key.json'), JSON.stringify(key, null, 2));
  console.log(`Wrote ${raters} rating forms in ${dir}; keep blinding-key.json away from raters.`);
}
if (require.main === module) try {
  const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
  if (!a.includes('--out') || !a.includes('--data')) throw new Error('usage: human-pack.js --out RUN_DIR --data descriptions.json [--raters 6]');
  build(path.resolve(get('--out')), path.resolve(get('--data')), a.includes('--raters') ? +get('--raters') : 6);
} catch (e) { console.error(e.message); process.exitCode = 1; }
module.exports = { build };

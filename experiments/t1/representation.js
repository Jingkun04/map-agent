const fs = require('fs');
const zlib = require('zlib');
const SIZE = 512, CELLS = SIZE * SIZE;
const BIOMES = ['grassland', 'desert', 'forest', 'marsh', 'tundra', 'ice', 'rock'];
const BIOME_ID = Object.fromEntries(BIOMES.map((x, i) => [x, i]));
const index = (x, y) => y * SIZE + x;
const xy = i => [i % SIZE, Math.floor(i / SIZE)];
const clamp = n => Math.max(0, Math.min(1, +n || 0));
const cell = p => [Math.min(SIZE - 1, Math.floor(clamp(p[0]) * SIZE)), Math.min(SIZE - 1, Math.floor(clamp(p[1]) * SIZE))];

function polygonMask(points, diagnostics) {
  const mask = new Uint8Array(CELLS);
  if (!Array.isArray(points) || points.length < 3 || !points.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))) {
    diagnostics.invalidPolygons++; return mask;
  }
  const poly = points.map(p => [clamp(p[0]) * SIZE, clamp(p[1]) * SIZE]);
  for (let y = 0; y < SIZE; y++) {
    const yy = y + 0.5, xs = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      if ((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)) xs.push(a[0] + (yy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const lo = Math.max(0, Math.ceil(xs[k] - 0.5)), hi = Math.min(SIZE - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = lo; x <= hi; x++) mask[index(x, y)] = 1;
    }
  }
  return mask;
}
function union(into, other) { for (let i = 0; i < CELLS; i++) if (other[i]) into[i] = 1; }
function cellsOf(mask) { const out = []; for (let i = 0; i < CELLS; i++) if (mask[i]) out.push(i); return out; }
function components(mask, min = 1) {
  const seen = new Uint8Array(CELLS), out = [], q = new Int32Array(CELLS);
  for (let start = 0; start < CELLS; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 1, sx = 0, sy = 0; q[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = q[head++], x = i % SIZE, y = (i - x) / SIZE; sx += x; sy += y;
      for (const n of [x ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, y ? i - SIZE : -1, y < SIZE - 1 ? i + SIZE : -1]) {
        if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; q[tail++] = n; }
      }
    }
    if (tail >= min) out.push({ cells: Array.from(q.subarray(0, tail)), cx: sx / tail, cy: sy / tail });
  }
  return out;
}
function lineCells(a, b) {
  let [x0, y0] = cell(a), [x1, y1] = cell(b);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy; const out = [];
  while (true) {
    out.push(index(x0, y0)); if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}
function pathCells(points, diagnostics) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))) {
    diagnostics.invalidLines++; return [];
  }
  const out = [];
  for (let k = 1; k < points.length; k++) {
    const part = lineCells(points[k - 1], points[k]);
    if (out.length && out.at(-1) === part[0]) part.shift();
    out.push(...part);
  }
  return out;
}
function emptyRep(kmPerCell, source) {
  return { size: SIZE, kmPerCell, source, sea: new Uint8Array(CELLS), dryLand: new Uint8Array(CELLS),
    lake: new Uint8Array(CELLS), mountain: new Uint8Array(CELLS), biome: new Uint8Array(CELLS),
    riverMask: new Uint8Array(CELLS), riverEdges: [], rivers: [], mountainFeatures: [], lakeFeatures: [],
    settlements: [], diagnostics: { invalidPolygons: 0, invalidLines: 0, waterOverlap: 0, riverOverSea: 0 } };
}
function fromDirect(raw) {
  if (!raw || ![1024, 2048, 4096].includes(raw.extent_km)) throw new Error('invalid extent_km');
  const r = emptyRep(raw.extent_km / SIZE, 'G0'), land = new Uint8Array(CELLS);
  for (const poly of raw.land || []) union(land, polygonMask(poly, r.diagnostics));
  if (!land.some(Boolean)) throw new Error('no valid land polygon');
  for (let i = 0; i < CELLS; i++) r.sea[i] = land[i] ? 0 : 1;
  for (const l of raw.lakes || []) {
    const m = polygonMask(l.area, r.diagnostics), cells = [];
    for (let i = 0; i < CELLS; i++) if (m[i]) { if (r.sea[i]) { r.diagnostics.waterOverlap++; continue; } r.lake[i] = 1; cells.push(i); }
    if (cells.length) r.lakeFeatures.push({ name: String(l.name || ''), cells });
  }
  for (let i = 0; i < CELLS; i++) r.dryLand[i] = !r.sea[i] && !r.lake[i] ? 1 : 0;
  for (const m of raw.mountains || []) {
    const mask = polygonMask(m.area, r.diagnostics), cells = [];
    for (let i = 0; i < CELLS; i++) if (mask[i] && r.dryLand[i]) { r.mountain[i] = 1; cells.push(i); }
    if (cells.length) r.mountainFeatures.push({ name: String(m.name || ''), cells });
  }
  for (const b of raw.biomes || []) {
    if (!(b.type in BIOME_ID)) continue;
    const mask = polygonMask(b.area, r.diagnostics);
    for (let i = 0; i < CELLS; i++) if (mask[i] && r.dryLand[i]) r.biome[i] = BIOME_ID[b.type];
  }
  for (const river of raw.rivers || []) {
    const path = pathCells(river.points, r.diagnostics);
    if (path.length < 2) continue;
    r.rivers.push({ name: String(river.name || ''), path });
    for (let k = 0; k < path.length; k++) {
      const c = path[k]; r.riverMask[c] = 1;
      if (r.sea[c] && k < path.length - 1) r.diagnostics.riverOverSea++;
      if (k) r.riverEdges.push([path[k - 1], c]);
    }
  }
  for (const s of raw.settlements || []) {
    if (!s || !Number.isFinite(+s.x) || !Number.isFinite(+s.y)) continue;
    const [x, y] = cell([s.x, s.y]);
    r.settlements.push({ name: String(s.name || ''), type: String(s.type || 'town'), x, y });
  }
  r.unmet = Array.isArray(raw.unmet) ? raw.unmet : [];
  return r;
}
const worldBiome = b => ({ playa: 'desert', savanna: 'grassland', steppe: 'grassland', taiga: 'forest',
  jungle: 'forest', rainforest: 'forest', snow: 'ice' })[b] || (BIOME_ID[b] != null ? b : 'grassland');
function fromWorld(W) {
  const kmPerCell = ({ region: 2, kingdom: 4, continent: 8 })[W.spec.scale] || 2;
  const r = emptyRep(kmPerCell, 'system');
  for (let i = 0; i < CELLS; i++) {
    r.sea[i] = W.ocean[i] ? 1 : 0;
    r.lake[i] = !r.sea[i] && W.hy.lake[i] ? 1 : 0;
    r.dryLand[i] = !r.sea[i] && !r.lake[i] ? 1 : 0;
    r.mountain[i] = r.dryLand[i] && W.h[i] - W.P.sea > 0.36 ? 1 : 0;
    r.biome[i] = BIOME_ID[worldBiome(W.biome[i])];
    if (W.hy.channel[i]) {
      if (!r.lake[i]) r.riverMask[i] = 1;
      const d = W.hy.down[i]; if (d >= 0) r.riverEdges.push([i, d]);
    }
  }
  const lakeComps = components(r.lake, 1);
  for (const l of W.hy.lakes) {
    const match = lakeComps.find(c => c.cells.includes(Math.round(l.cy) * SIZE + Math.round(l.cx))) ||
      lakeComps.reduce((best, c) => !best || Math.hypot(c.cx - l.cx, c.cy - l.cy) < Math.hypot(best.cx - l.cx, best.cy - l.cy) ? c : best, null);
    if (match) r.lakeFeatures.push({ name: l.name, cells: match.cells });
  }
  for (const m of W.spec.mountains) {
    const ridge = W.P.ridges.find(q => q.mid === m.id); if (!ridge) continue;
    const ri = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'].indexOf(ridge.region);
    const cx = ((ri % 3) + 0.5) * SIZE / 3, cy = (Math.floor(ri / 3) + 0.5) * SIZE / 3;
    const ang = (ridge.angle != null ? ridge.angle : ridge.orientation === 'NS' ? 90 : 0) * Math.PI / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang), half = SIZE / 3 * .66 * ({ short: .6, medium: 1, long: 1.55 })[ridge.length || 'medium'];
    const cells = [];
    for (let y = Math.max(0, Math.floor(cy - half - 50)); y < Math.min(SIZE, Math.ceil(cy + half + 50)); y++)
      for (let x = Math.max(0, Math.floor(cx - half - 50)); x < Math.min(SIZE, Math.ceil(cx + half + 50)); x++) {
        const along = (x - cx) * ca + (y - cy) * sa, across = -(x - cx) * sa + (y - cy) * ca;
        if (Math.abs(along) <= half * 1.35 && Math.abs(across) <= 50 && r.mountain[index(x, y)]) cells.push(index(x, y));
      }
    if (cells.length) r.mountainFeatures.push({ name: m.name, cells });
  }
  // Recover the longest upstream stem from the common directed graph. Picking the
  // branch with the largest catchment can shorten a river at a confluence.
  const incoming = new Map();
  for (const [a, b] of r.riverEdges) { if (!incoming.has(b)) incoming.set(b, []); incoming.get(b).push(a); }
  const stemLength = new Map();
  function longestUpstream(i, visiting = new Set()) {
    if (stemLength.has(i)) return stemLength.get(i);
    if (visiting.has(i)) return 0;
    visiting.add(i);
    let best = 0;
    for (const prev of incoming.get(i) || []) best = Math.max(best, longestUpstream(prev, visiting));
    visiting.delete(i);
    stemLength.set(i, best + 1);
    return best + 1;
  }
  for (const river of W.hy.rivers) {
    const path = [river.mouth], seen = new Set(path);
    while (true) {
      const prev = (incoming.get(path[0]) || []).filter(i => !seen.has(i))
        .sort((a, b) => longestUpstream(b) - longestUpstream(a) || W.hy.acc[b] - W.hy.acc[a])[0];
      if (prev == null) break; path.unshift(prev); seen.add(prev);
    }
    if (path.length >= 2) r.rivers.push({ name: river.name, path });
  }
  for (const s of W.spec.settlements) {
    const p = W.P.pos[s.id]; if (p) r.settlements.push({ name: s.name, type: s.type, x: p[0], y: p[1] });
  }
  return r;
}
function saveRep(file, r) {
  const obj = { ...r };
  for (const key of ['sea', 'lake', 'dryLand', 'mountain', 'biome', 'riverMask']) obj[key] = Buffer.from(r[key]).toString('base64');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(obj)));
}
function loadRep(file) {
  const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  for (const key of ['sea', 'lake', 'dryLand', 'mountain', 'biome', 'riverMask']) r[key] = Uint8Array.from(Buffer.from(r[key], 'base64'));
  return r;
}
module.exports = { SIZE, CELLS, BIOMES, index, xy, components, fromDirect, fromWorld, saveRep, loadRep };

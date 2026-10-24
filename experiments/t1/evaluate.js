// Independent evaluator: it sees only the common representation, never a generator World.
const { SIZE, CELLS, BIOMES, index, xy, components } = require('./representation');
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
const region = (x, y) => ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'][Math.min(2, Math.floor(y * 3 / SIZE)) * 3 + Math.min(2, Math.floor(x * 3 / SIZE))];
const border = i => { const x = i % SIZE, y = Math.floor(i / SIZE); return x === 0 || x === SIZE - 1 || y === 0 || y === SIZE - 1; };
const neighbors = i => {
  const x = i % SIZE, y = Math.floor(i / SIZE), out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
    if (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE) out.push([index(xx, yy), dx && dy ? Math.SQRT2 : 1]);
  }
  return out;
};
function distField(mask) {
  const d = new Float32Array(CELLS).fill(1e8);
  for (let i = 0; i < CELLS; i++) if (mask[i]) d[i] = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = index(x, y); if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
    if (y) { d[i] = Math.min(d[i], d[i - SIZE] + 1); if (x) d[i] = Math.min(d[i], d[i - SIZE - 1] + Math.SQRT2); if (x < SIZE - 1) d[i] = Math.min(d[i], d[i - SIZE + 1] + Math.SQRT2); }
  }
  for (let y = SIZE - 1; y >= 0; y--) for (let x = SIZE - 1; x >= 0; x--) {
    const i = index(x, y); if (x < SIZE - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
    if (y < SIZE - 1) { d[i] = Math.min(d[i], d[i + SIZE] + 1); if (x) d[i] = Math.min(d[i], d[i + SIZE - 1] + Math.SQRT2); if (x < SIZE - 1) d[i] = Math.min(d[i], d[i + SIZE + 1] + Math.SQRT2); }
  }
  return d;
}
function graph(rep) {
  const next = new Map(), outDegree = new Uint8Array(CELLS);
  for (const [a, b] of rep.riverEdges) {
    if (!next.has(a)) next.set(a, new Set());
    next.get(a).add(b);
  }
  for (const [a, set] of next) outDegree[a] = Math.min(255, set.size);
  return { next, outDegree };
}
function nearSea(rep, i) { return neighbors(i).some(([n]) => rep.sea[n]); }
function riverMouths(rep) {
  const mask = new Uint8Array(CELLS), { next } = graph(rep);
  for (const i of rep.riverMask.keys()) {
    if (!rep.riverMask[i] || !rep.dryLand[i]) continue;
    if (nearSea(rep, i) && ([...(next.get(i) || [])].some(n => rep.sea[n]) || !(next.get(i)?.size))) mask[i] = 1;
  }
  return mask;
}
function validOutlet(rep, i) { return rep.sea[i] || rep.lake[i] || border(i); }
function majorRivers(rep) {
  const { next } = graph(rep);
  return rep.rivers.filter(r => r.path.length >= 60 && (validOutlet(rep, r.path.at(-1)) ||
    [...(next.get(r.path.at(-1)) || [])].some(i => validOutlet(rep, i))));
}
function findEntity(rep, name, type, acceptedTypes = []) {
  const target = norm(name);
  const groups = [
    ...rep.settlements.map(e => ({ ...e, kind: 'settlement' })),
    ...rep.mountainFeatures.map(e => ({ ...e, type: 'mountain', kind: 'feature' })),
    ...rep.lakeFeatures.map(e => ({ ...e, type: 'lake', kind: 'feature' })),
    ...rep.rivers.map(e => ({ ...e, type: 'river', kind: 'feature' })),
  ];
  const matches = groups.filter(e => norm(e.name) === target);
  return { entity: matches.find(e => e.type === type || acceptedTypes.includes(e.type)) || null, nameFound: matches.length > 0,
    wrongType: matches.length > 0 && !matches.some(e => e.type === type || acceptedTypes.includes(e.type)) };
}
const population = e => e && Number.isFinite(e.x) && Number.isFinite(e.y);
function settlement(rep, name) { return rep.settlements.find(e => norm(e.name) === norm(name)); }
function maskFromCells(cells) { const m = new Uint8Array(CELLS); for (const i of cells) m[i] = 1; return m; }
function minDist(d, e) { return population(e) ? d[index(e.x, e.y)] : 1e8; }
const threshold = (rep, km, floor, strict) => Math.max(strict ? 1 : floor, km * (strict ? .5 : 1) / rep.kmPerCell);
function seaCheck(rep, wanted) {
  const total = rep.sea.reduce((a, b) => a + b, 0), share = total / CELLS;
  if (wanted === 'none') return { pass: total === 0, measured: { seaShare: share } };
  if (wanted === 'unspecified' || !wanted) return { pass: true, measured: { seaShare: share } };
  const dirs = wanted === 'all' ? ['N', 'E', 'S', 'W'] : [...wanted];
  const band = Math.ceil(SIZE * .1), bands = {};
  for (const dir of dirs) {
    let n = 0;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
      if ((dir === 'N' && y < band) || (dir === 'S' && y >= SIZE - band) || (dir === 'W' && x < band) || (dir === 'E' && x >= SIZE - band)) n += rep.sea[index(x, y)];
    bands[dir] = n / (band * SIZE);
  }
  return { pass: share >= .01 && Object.values(bands).every(v => v >= .01), measured: { seaShare: share, bands } };
}
function characterValue(rep, metric) {
  const land = CELLS - rep.sea.reduce((a, b) => a + b, 0), dry = Math.max(1, rep.dryLand.reduce((a, b) => a + b, 0));
  if (metric === 'land_share') return land / CELLS;
  if (metric === 'islands') { const landMask = new Uint8Array(CELLS); for (let i = 0; i < CELLS; i++) landMask[i] = !rep.sea[i] ? 1 : 0; return components(landMask, 1).length; }
  if (metric === 'lake_share') return rep.lake.reduce((a, b) => a + b, 0) / Math.max(1, land);
  if (metric === 'mountain_share') return rep.mountain.reduce((a, b) => a + b, 0) / dry;
  let count = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!rep.dryLand[i]) continue;
    const b = BIOMES[rep.biome[i]];
    if ((metric === 'desert_share' && b === 'desert') || (metric === 'grass_share' && b === 'grassland') ||
      (metric === 'forest_share' && b === 'forest') || (metric === 'cold_share' && ['tundra', 'ice'].includes(b)) ||
      (metric === 'wetland_share' && b === 'marsh')) count++;
  }
  return count / dry;
}
function charCheck(rep, c, strict) {
  const v = characterValue(rep, c.metric);
  if (c.metric === 'islands') return { pass: v >= (c.min ?? 0) && v <= (c.max ?? Infinity), measured: v };
  const bands = { none: [0, .02], low: [0, .15], moderate: [.10, .40], high: [.35, 1], dominant: [.55, 1] };
  const [lo, hi] = bands[c.level] || [0, 1], slack = strict ? .025 : .05;
  return { pass: v >= lo - slack && v <= hi + slack, measured: v };
}
class Heap {
  constructor() { this.a = []; }
  push(i, d) { const a = this.a; let n = a.length; a.push([i, d]); while (n) { const p = (n - 1) >> 1; if (a[p][1] <= d) break; a[n] = a[p]; n = p; } a[n] = [i, d]; }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { let n = 0; while (n * 2 + 1 < a.length) { let c = n * 2 + 1; if (c + 1 < a.length && a[c + 1][1] < a[c][1]) c++; if (a[c][1] >= last[1]) break; a[n] = a[c]; n = c; } a[n] = last; } return top; }
  get size() { return this.a.length; }
}
function travelDays(rep, a, b, limit = Infinity) {
  if (!population(a) || !population(b)) return Infinity;
  const start = index(a.x, a.y), target = index(b.x, b.y);
  if (!rep.dryLand[start] || !rep.dryLand[target]) return Infinity;
  const dist = new Float32Array(CELLS).fill(Infinity), heap = new Heap(); dist[start] = 0; heap.push(start, 0);
  const maxCells = limit * 32 / rep.kmPerCell;
  while (heap.size) {
    const [i, d] = heap.pop(); if (d > dist[i] || d > maxCells) continue;
    if (i === target) return d * rep.kmPerCell / 32;
    for (const [n, step] of neighbors(i)) {
      if (!rep.dryLand[n]) continue;
      const terrain = 1 + (rep.mountain[n] ? .8 : 0) + (BIOMES[rep.biome[n]] === 'marsh' ? .5 : 0);
      const nd = d + step * terrain;
      if (nd < dist[n] && nd <= maxCells) { dist[n] = nd; heap.push(n, nd); }
    }
  }
  return Infinity;
}
function downstream(rep, b, a) {
  if (!population(a) || !population(b)) return false;
  const radius = Math.ceil(Math.max(2, 16 / rep.kmPerCell)), nodes = e => {
    const out = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = e.x + dx, y = e.y + dy;
      if (x >= 0 && y >= 0 && x < SIZE && y < SIZE && dx * dx + dy * dy <= radius * radius && rep.riverMask[index(x, y)]) out.push(index(x, y));
    }
    return out;
  };
  const sources = nodes(b), goals = new Set(nodes(a)); if (!sources.length || !goals.size) return false;
  const { next } = graph(rep), seen = new Set(sources), q = [...sources];
  for (let k = 0; k < q.length; k++) {
    const i = q[k]; if (goals.has(i) && k > 0) return true;
    for (const n of next.get(i) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  return false;
}
function goldCheck(rep, gold, { strict = false } = {}) {
  const items = [], dSea = distField(rep.sea), dRiver = distField(rep.riverMask), dLake = distField(rep.lake), dMount = distField(rep.mountain);
  const dMouth = distField(riverMouths(rep));
  const add = (id, basis, category, pass, measured) => items.push({ id, basis: basis || 'explicit', category, status: pass ? 'pass' : 'fail', measured });
  if (gold.sea && gold.sea.value !== 'unspecified') { const z = seaCheck(rep, gold.sea.value); add(gold.sea.id || 'sea', gold.sea.basis, 'sea', z.pass, z.measured); }
  for (const e of gold.entities || []) {
    const f = findEntity(rep, e.name, e.type, e.accepted_types || []);
    add(e.id, e.basis, 'entity', !!f.entity, { name: e.name, type: e.type, nameFound: f.nameFound, wrongType: f.wrongType });
  }
  for (const c of gold.constraints || []) {
    const s = settlement(rep, c.subject), i = population(s) ? index(s.x, s.y) : -1, dry = i >= 0 && !!rep.dryLand[i];
    let pass = false, measured = null;
    switch (c.kind) {
      case 'coast': measured = minDist(dSea, s) * rep.kmPerCell; pass = dry && measured <= threshold(rep, 12, 2, strict) * rep.kmPerCell; break;
      case 'river_mouth': measured = minDist(dMouth, s) * rep.kmPerCell; pass = dry && measured <= threshold(rep, 16, 2, strict) * rep.kmPerCell; break;
      case 'on_river': measured = minDist(dRiver, s) * rep.kmPerCell; pass = dry && measured <= threshold(rep, 8, 1.5, strict) * rep.kmPerCell; break;
      case 'lakeside': measured = minDist(dLake, s) * rep.kmPerCell; pass = dry && measured <= threshold(rep, 12, 2, strict) * rep.kmPerCell; break;
      case 'near_mountain': measured = minDist(dMount, s) * rep.kmPerCell; pass = dry && !rep.mountain[i] && measured <= threshold(rep, 40, 2, strict) * rep.kmPerCell; break;
      case 'in_region': measured = s ? region(s.x, s.y) : null; pass = !!s && measured === c.region; break;
      case 'mountain_in_region': {
        const feature = findEntity(rep, c.subject, 'mountain').entity;
        const cells = feature?.cells || [], overlap = cells.filter(j => region(...xy(j)) === c.region).length;
        const area = rep.mountain.reduce((n, v, j) => n + (v && region(...xy(j)) === c.region ? 1 : 0), 0);
        measured = { overlap: overlap / Math.max(1, cells.length), regionMountainCells: area };
        pass = cells.length > 0 && measured.overlap >= .1 && area >= 145; break;
      }
      case 'min_major_rivers': measured = majorRivers(rep).length; pass = measured >= +c.value; break;
      case 'min_lakes': measured = components(rep.lake, Math.ceil(CELLS * .0003)).length; pass = measured >= +c.value; break;
      case 'downstream_of': measured = downstream(rep, settlement(rep, c.object), s); pass = measured; break;
      case 'within_days_of': measured = travelDays(rep, s, settlement(rep, c.object), +c.days); pass = measured <= +c.days; break;
      default: throw new Error(`Unknown gold constraint: ${c.kind}`);
    }
    add(c.id, c.basis, 'constraint', pass, measured);
  }
  for (const c of gold.character || []) { const z = charCheck(rep, c, strict); add(c.id, c.basis, 'character', z.pass, z.measured); }
  const explicit = items.filter(i => i.basis === 'explicit');
  const implied = items.filter(i => i.basis === 'implied');
  const ratio = xs => xs.length ? xs.filter(i => i.status === 'pass').length / xs.length : null;
  const entities = items.filter(i => i.category === 'entity');
  return { items, explicitPass: explicit.filter(i => i.status === 'pass').length, explicitN: explicit.length,
    explicitRate: ratio(explicit), impliedRate: ratio(implied), allSat: explicit.every(i => i.status === 'pass'),
    entityRecall: entities.length ? entities.filter(i => i.measured.nameFound).length / entities.length : null,
    entityTypeAcc: entities.some(i => i.measured.nameFound) ? entities.filter(i => i.status === 'pass').length / entities.filter(i => i.measured.nameFound).length : null,
    characterRate: ratio(items.filter(i => i.category === 'character')) };
}
function physicsCheck(rep) {
  const { next, outDegree } = graph(rep), counts = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 }, details = [];
  const canExit = start => {
    const seen = new Set(), q = [start];
    for (let k = 0; k < q.length; k++) {
      const i = q[k]; if (validOutlet(rep, i)) return true;
      for (const n of next.get(i) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
      if (q.length > CELLS) break;
    }
    return false;
  };
  for (const river of rep.rivers) if (river.path.length && !canExit(river.path.at(-1))) { counts.P1++; details.push({ code: 'P1', river: river.name }); }
  for (let i = 0; i < CELLS; i++) if (outDegree[i] >= 2) counts.P2++;
  for (const [a, b] of rep.riverEdges) {
    const [ax, ay] = xy(a), [bx, by] = xy(b);
    if (rep.sea[a] || (rep.sea[b] && outDegree[b]) || Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) counts.P3++;
  }
  for (const comp of components(rep.lake, 1)) {
    const inside = new Set(comp.cells), exit = [];
    for (const i of comp.cells) for (const n of next.get(i) || []) if (!inside.has(n)) exit.push(n);
    const clusters = [];
    for (const e of exit) if (!clusters.some(c => Math.hypot(...xy(c).map((v, j) => v - xy(e)[j])) <= 3)) clusters.push(e);
    if (clusters.length >= 2) counts.P4 += clusters.length - 1;
  }
  for (const s of rep.settlements) if (!rep.dryLand[index(s.x, s.y)]) counts.P5++;
  const km = rep.riverEdges.length * rep.kmPerCell;
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), perRiver: (counts.P1 + counts.P2 + counts.P3 + counts.P4) / Math.max(1, rep.rivers.length),
    per1000Km: (counts.P1 + counts.P2 + counts.P3 + counts.P4) * 1000 / Math.max(1, km), details };
}
module.exports = { norm, region, distField, seaCheck, majorRivers, goldCheck, physicsCheck, travelDays, downstream };

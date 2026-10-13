// ===================== ROADS & SETTLEMENT PLANS =====================
// Plan radius in map cells (1 cell = 2 km). Settlements are drawn larger than life, as on a fantasy map.
const PLAN_R = { city: 14, port: 12.5, town: 8.5, fortress: 6, village: 4.5 };
const ZONES = {
  core:   { zh: "商业区", en: "commercial", block: "#efc58f", bld: "#b87a45", h: [2.8, 7.5] },
  civic:  { zh: "行政文化区", en: "civic and cultural", block: "#dccbeb", bld: "#8a70ae", h: [2.2, 4] },
  res:    { zh: "住宅区（密集）", en: "dense housing", block: "#f1d6bb", bld: "#bd8865", h: [1.5, 3.2] },
  sub:    { zh: "住宅区（低密度）", en: "suburban housing", block: "#dfe8c6", bld: "#b39a80", h: [0.8, 1.3] },
  ind:    { zh: "工业区", en: "industrial", block: "#d3d1de", bld: "#7f7d8b", h: [1.3, 2.4] },
  harbor: { zh: "港区", en: "harbour", block: "#c9dbe6", bld: "#6f8ba0", h: [1.1, 1.9] },
  mil:    { zh: "军营", en: "barracks", block: "#d8cfb2", bld: "#716955", h: [1.1, 1.8] },
  park:   { zh: "公园绿地", en: "parks", ground: "#a6cd88" },
  cem:    { zh: "墓地", en: "cemetery", ground: "#b8cca8" },
  plaza:  { zh: "中心广场", en: "central plaza", ground: "#ece2cf" },
};
const STREET = "#dcd6ca", ROAD_FILL = "#fff3c9", ROAD_EDGE = "#b9a67f", WATER = "#86b6cc", WALL = "#6a6255";
const LANDMARK = {
  plaza: { zh: "中心广场", en: "central plaza", icon: "◇" }, cityhall: { zh: "市政厅", en: "city hall", icon: "▣" }, cathedral: { zh: "大教堂", en: "cathedral", icon: "✝" },
  church: { zh: "教堂", en: "church", icon: "✝" }, chapel: { zh: "礼拜堂", en: "chapel", icon: "✝" }, hospital: { zh: "医院", en: "hospital", icon: "✚" },
  clinic: { zh: "诊所", en: "clinic", icon: "✚" }, market: { zh: "市场", en: "market", icon: "◍" }, school: { zh: "学校", en: "school", icon: "✎" },
  station: { zh: "火车站", en: "railway station", icon: "⊟" }, factory: { zh: "工厂", en: "factory", icon: "⌂" }, lighthouse: { zh: "灯塔", en: "lighthouse", icon: "✦" },
  keep: { zh: "城堡主楼", en: "keep", icon: "♜" }, library: { zh: "图书馆", en: "library", icon: "▤" },
};

// ---------- style profile (proposed by the intent layer) -> city-planner knobs ----------
// street_pattern drives the road skeleton and what each district's block lattice lines up with.
// warp: how far the district Voronoi is noise-warped   wobble: how much a main road meanders
// mainF: multiplier on the number of radial mains      rings: ring-road radius fractions, per settlement type
// lot: what the block lattice follows                  jitter: extra rotation allowed in low-density suburbs
const PATTERN = {
  organic:  { warp: 0.10, wobble: 0.12, mainF: 1.0, lot: "road",    jitter: 0.25,
    rings: { city: [0.40, 0.76], port: [0.44], town: [0.52], fortress: [], village: [] } },
  grid:     { warp: 0.01, wobble: 0.00, mainF: 1.0, lot: "global",  jitter: 0.00,
    rings: { city: [], port: [], town: [], fortress: [], village: [] } },
  radial:   { warp: 0.04, wobble: 0.03, mainF: 1.8, lot: "radial",  jitter: 0.06,
    rings: { city: [0.52], port: [0.50], town: [0.55], fortress: [], village: [] } },
  ring:     { warp: 0.05, wobble: 0.04, mainF: 0.6, lot: "tangent", jitter: 0.06,
    rings: { city: [0.30, 0.52, 0.74], port: [0.34, 0.62], town: [0.40, 0.70], fortress: [0.6], village: [0.62] } },
  terraced: { warp: 0.07, wobble: 0.06, mainF: 0.8, lot: "contour", jitter: 0.10,
    rings: { city: [0.34, 0.56, 0.78], port: [0.38, 0.64], town: [0.45, 0.72], fortress: [], village: [0.60] } },
};
// the vocabulary each era can build, used when the spec does not list one of its own
const ERA_LANDMARKS = {
  medieval: ["plaza", "market", "cathedral", "church", "chapel", "cityhall", "keep", "lighthouse"],
  modern:   ["plaza", "market", "church", "cityhall", "hospital", "clinic", "school", "library", "station", "factory", "lighthouse"],
  future:   ["plaza", "market", "cityhall", "hospital", "clinic", "school", "library", "station", "factory", "lighthouse"],
  alien:    ["plaza", "market", "cityhall", "keep", "library", "factory", "station"],
};
// when the planner wants a landmark the vocabulary lacks, substitute one with the same function; no entry means drop it
const LM_ALT = { cathedral: ["church", "chapel"], church: ["chapel", "cathedral"], chapel: ["church"], cityhall: ["keep"], keep: ["cityhall"], hospital: ["clinic"], clinic: ["hospital"], library: ["school"], school: ["library"] };
// buildings drift towards an era colour; district (zoning) colours stay put so the legend keeps meaning the same thing
const ERA_ZH = { medieval: "中世纪", modern: "近现代", future: "未来", alien: "异星" };
const PATTERN_ZH = { organic: "有机街道", grid: "棋盘网格", radial: "放射状", ring: "环状", terraced: "等高线梯田" };
const ERA_TINT = { medieval: null, modern: ["#6f7a88", 0.52], future: ["#5fd0ea", 0.62], alien: ["#b476dc", 0.6] };
function mixHex(a, b, t) {
  const px = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = px(a), [r2, g2, b2] = px(b), q = v => Math.round(v).toString(16).padStart(2, "0");
  return "#" + q(r1 + (r2 - r1) * t) + q(g1 + (g2 - g1) * t) + q(b1 + (b2 - b1) * t);
}
function zoneBld(style, zone) {
  const base = ZONES[zone].bld, t = ERA_TINT[(style || STYLE_DEFAULT).era];
  return t ? mixHex(base, t[0], t[1]) : base;
}

// ---------- sampling helpers ----------
function bil(F, x, y) {
  x = clamp(x, 0, N - 1.001); y = clamp(y, 0, N - 1.001);
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, i = yi * N + xi;
  return (F[i] * (1 - tx) + F[i + 1] * tx) * (1 - ty) + (F[i + N] * (1 - tx) + F[i + N + 1] * tx) * ty;
}
function waterFields(W) {
  if (W._wf) return W._wf;
  const wet = new Float32Array(NN), rw = new Float32Array(NN);
  const thr = W.P.riverThr;
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i] || W.hy.lake[i]) wet[i] = 1;
    if (W.hy.channel[i] && !W.hy.lake[i]) rw[i] = clamp(0.12 + 0.085 * Math.log2(W.hy.acc[i] / thr), 0.12, 0.55);
  }
  W._wf = { wet, rw, nz: makePerlin(W.P.seed + 555) };
  return W._wf;
}
// distance from a point to the river network, measured to cell-to-downstream segments, minus the local river width
function riverGap(W, X, Y) {
  const wf = waterFields(W), xi = Math.floor(X), yi = Math.floor(Y);
  let best = 1e9;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = xi + dx, y = yi + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const i = y * N + x, w = wf.rw[i]; if (!w) continue;
    const dn = W.hy.down[i];
    const ax = x + 0.5, ay = y + 0.5;
    let bx = ax, by = ay;
    if (dn >= 0) { bx = dn % N + 0.5; by = Math.floor(dn / N) + 0.5; }
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    const t = L ? clamp(((X - ax) * vx + (Y - ay) * vy) / L, 0, 1) : 0;
    const g = Math.hypot(X - ax - t * vx, Y - ay - t * vy) - w;
    if (g < best) best = g;
  }
  return best;
}
// 0 land, 1 river, 2 sea or lake (X, Y in continuous map-cell coordinates)
function envAt(W, X, Y) {
  if (X < 0 || Y < 0 || X >= N || Y >= N) return 4;
  const wf = waterFields(W);
  if (bil(wf.wet, X - 0.5, Y - 0.5) > 0.5 + 0.22 * wf.nz(X * 0.9, Y * 0.9)) return 2;
  if (riverGap(W, X, Y) < 0) return 1;
  return 0;
}
function distToPolys(u, v, polys) {
  let best = 1e9;
  for (const p of polys) {
    const pts = p.pts;
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
      const t = clamp(((u - ax) * dx + (v - ay) * dy) / L, 0, 1);
      const d = Math.hypot(u - ax - t * dx, v - ay - t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}
function chaikin(pts, n) {
  for (let it = 0; it < n; it++) {
    if (pts.length < 3) return pts;
    const o = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      o.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    o.push(pts[pts.length - 1]);
    pts = o;
  }
  return pts;
}

// ---------- regional road network ----------
function buildRoads(W) {
  if (W._roads) return W._roads;
  const M = N >> 1, MM = M * M, cost = new Float32Array(MM);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const c = [2 * y * N + 2 * x, 2 * y * N + 2 * x + 1, (2 * y + 1) * N + 2 * x, (2 * y + 1) * N + 2 * x + 1];
    if (c.some(i => W.ocean[i] || W.hy.lake[i])) { cost[y * M + x] = Infinity; continue; }
    const i = c[0];
    const rel = W.h[i] - W.P.sea;
    cost[y * M + x] = 1 + 260 * SC * slopeAt(W, i) + (rel > MOUNTAIN_REL ? 3 : 0) + (c.some(j => W.hy.channel[j]) ? 5 : 0);
  }
  const S = W.spec.settlements;
  const cc = S.map(s => { const [px, py] = W.P.pos[s.id]; return [px >> 1, py >> 1]; });
  // Kruskal MST over straight-line distance, plus a second link for cities and ports
  const pairs = [];
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) pairs.push([Math.hypot(cc[a][0] - cc[b][0], cc[a][1] - cc[b][1]), a, b]);
  pairs.sort((p, q) => p[0] - q[0]);
  const par = S.map((_, k) => k), find = k => par[k] === k ? k : (par[k] = find(par[k]));
  const edges = [];
  for (const [, a, b] of pairs) if (find(a) !== find(b)) { par[find(a)] = find(b); edges.push([a, b]); }
  S.forEach((s, a) => {
    if (s.type !== "city" && s.type !== "port") return;
    const near = pairs.filter(p => p[1] === a || p[2] === a).slice(0, 3);
    for (const [, x, y] of near) if (!edges.some(e => (e[0] === x && e[1] === y) || (e[0] === y && e[1] === x))) { edges.push([x, y]); break; }
  });
  const onRoad = new Uint8Array(MM), list = [];
  const g = new Float32Array(MM), came = new Int32Array(MM), closed = new Uint8Array(MM);
  edges.sort((e, f) => Math.hypot(cc[e[0]][0] - cc[e[1]][0], cc[e[0]][1] - cc[e[1]][1]) - Math.hypot(cc[f[0]][0] - cc[f[1]][0], cc[f[0]][1] - cc[f[1]][1]));
  for (const [a, b] of edges) {
    g.fill(Infinity); closed.fill(0);
    const s0 = cc[a][1] * M + cc[a][0], t0 = cc[b][1] * M + cc[b][0], tx = cc[b][0], ty = cc[b][1];
    const heap = new Heap(4096); g[s0] = 0; came[s0] = -1; heap.push(s0, 0);
    let found = false;
    while (heap.n) {
      const c = heap.pop(); if (closed[c]) continue; closed[c] = 1;
      if (c === t0) { found = true; break; }
      const x = c % M, y = (c - x) / M;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= M || yy >= M) continue;
        const nb = yy * M + xx; if (closed[nb]) continue;
        let cst = cost[nb]; if (cst === Infinity && nb !== t0) continue; if (cst === Infinity) cst = 1;
        const ng = g[c] + DD8[k] * cst * (onRoad[nb] ? 0.35 : 1);
        if (ng < g[nb]) { g[nb] = ng; came[nb] = c; heap.push(nb, ng + 0.35 * Math.hypot(xx - tx, yy - ty)); }
      }
    }
    if (!found) continue;
    const cells = []; for (let c = t0; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    cells.forEach(c => onRoad[c] = 1);
    let pts = cells.map(c => [2 * (c % M) + 1, 2 * Math.floor(c / M) + 1]);
    pts[0] = [W.P.pos[S[a].id][0] + 0.5, W.P.pos[S[a].id][1] + 0.5];
    pts[pts.length - 1] = [W.P.pos[S[b].id][0] + 0.5, W.P.pos[S[b].id][1] + 0.5];
    pts = chaikin(pts.filter((p, k) => k === 0 || k === pts.length - 1 || k % 2 === 0), 2);
    const major = ["city", "port", "fortress"].includes(S[a].type) && ["city", "port", "fortress"].includes(S[b].type);
    list.push({ a: S[a].id, b: S[b].id, pts, major });
  }
  W._roads = list;
  return list;
}

// ---------- settlement plans ----------
function cityPlan(W, s) {
  W._plans = W._plans || {};
  if (W._plans[s.id]) return W._plans[s.id];
  const type = s.type, R = PLAN_R[type];
  const [px, py] = W.P.pos[s.id], CX = px + 0.5, CY = py + 0.5;
  const r = rng((hashStr(s.id + s.name) ^ (W.P.seed * 2654435761)) >>> 0);
  const nzP = makePerlin(hashStr(s.name) % 100000);
  // the intent layer's style profile: it decides how the town is laid out, never where it is
  const style = (W.spec && W.spec.style) || STYLE_DEFAULT;
  const pat = PATTERN[style.street_pattern] || PATTERN.organic;
  const vocab = new Set(["plaza", ...(style.landmarks && style.landmarks.length ? style.landmarks : ERA_LANDMARKS[style.era] || ERA_LANDMARKS.medieval)]);
  const BT = new Float32Array(721);
  for (let k = 0; k <= 720; k++) { const th = k / 720 * Math.PI * 2; BT[k] = R * clamp(0.82 + 0.26 * nzP(Math.cos(th) * 1.2 + 5.5, Math.sin(th) * 1.2 + 5.5), 0.64, 1.0); }
  const bound = th => { let k = Math.round((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2) * 720); return BT[k > 720 ? k - 720 : k]; };
  const EXT = R * 1.06, G = type === "city" || type === "port" ? 132 : 96, cg = 2 * EXT / G;
  const gu = gx => -EXT + (gx + 0.5) * cg;
  const gidx = (u, v) => { const gx = Math.floor((u + EXT) / cg), gy = Math.floor((v + EXT) / cg); return gx < 0 || gy < 0 || gx >= G || gy >= G ? -1 : gy * G + gx; };
  // environment raster: 0 buildable, 1 river, 2 sea/lake, 3 steep, 4 outside
  const env = new Int8Array(G * G);
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const u = gu(gx), v = gu(gy), X = CX + u, Y = CY + v;
    let e = envAt(W, X, Y);
    if (e === 0) {
      if (Math.hypot(u, v) > bound(Math.atan2(v, u))) e = 4;
      else if (slopeAt(W, Math.floor(Y) * N + Math.floor(X)) > 2.6 * SLOPE_MAX) e = 3;
    }
    env[gy * G + gx] = e;
  }
  // keep only land reachable from the centre without crossing open water
  const reach = new Uint8Array(G * G), q = [];
  let start = gidx(0, 0);
  if (env[start] !== 0) { let bd = 1e9; for (let k = 0; k < G * G; k++) if (env[k] === 0) { const d = Math.hypot(k % G - G / 2, Math.floor(k / G) - G / 2); if (d < bd) { bd = d; start = k; } } }
  if (env[start] === 0) { reach[start] = 1; q.push(start); }
  while (q.length) {
    const c = q.pop(), x = c % G, y = (c - x) / G;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
      const nb = yy * G + xx; if (reach[nb]) continue;
      if (env[nb] === 0 || env[nb] === 1 || env[nb] === 3) { reach[nb] = 1; q.push(nb); }
    }
  }
  for (let k = 0; k < G * G; k++) if (env[k] === 0 && !reach[k]) env[k] = 4;
  // distance (in cells) to sea and to river on the raster
  const chamfer = (d, S) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x; let v = d[k]; if (v === 0) continue;
      if (x > 0 && d[k - 1] + 1 < v) v = d[k - 1] + 1; if (y > 0) { if (d[k - S] + 1 < v) v = d[k - S] + 1; if (x > 0 && d[k - S - 1] + 1.414 < v) v = d[k - S - 1] + 1.414; if (x < S - 1 && d[k - S + 1] + 1.414 < v) v = d[k - S + 1] + 1.414; } d[k] = v; }
    for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) { const k = y * S + x; let v = d[k]; if (v === 0) continue;
      if (x < S - 1 && d[k + 1] + 1 < v) v = d[k + 1] + 1; if (y < S - 1) { if (d[k + S] + 1 < v) v = d[k + S] + 1; if (x < S - 1 && d[k + S + 1] + 1.414 < v) v = d[k + S + 1] + 1.414; if (x > 0 && d[k + S - 1] + 1.414 < v) v = d[k + S - 1] + 1.414; } d[k] = v; }
    return d;
  };
  const gdist = test => { const d = new Float32Array(G * G); for (let k = 0; k < G * G; k++) d[k] = test(env[k]) ? 0 : 1e9; chamfer(d, G); for (let k = 0; k < G * G; k++) d[k] *= cg; return d; };
  const dSea = gdist(e => e === 2), dRiv = gdist(e => e === 1);

  // main road directions: where regional roads leave the plan, plus evenly spaced extras
  const roads = buildRoads(W);
  const angles = [];
  for (const rd of roads) {
    if (rd.a !== s.id && rd.b !== s.id) continue;
    const pts = rd.a === s.id ? rd.pts : [...rd.pts].reverse();
    const p = pts.find(([x, y]) => Math.hypot(x - CX, y - CY) > R * 0.95) || pts[pts.length - 1];
    angles.push(Math.atan2(p[1] - CY, p[0] - CX));
  }
  const want = Math.max(2, Math.round({ city: 6, port: 5, town: 4, fortress: 2, village: 2 }[type] * pat.mainF));
  const landward = th => { for (const f of [0.35, 0.6, 0.85]) { const e = env[gidx(Math.cos(th) * R * f, Math.sin(th) * R * f)]; if (e === 2 || e === 4 && f < 0.7) return false; } return true; };
  for (let tries = 0; angles.length < want && tries < 60; tries++) {
    const th = r() * Math.PI * 2;
    const gap = Math.min(...angles.map(a => Math.abs(Math.atan2(Math.sin(th - a), Math.cos(th - a)))), 9);
    if (gap > (Math.PI * 2 / want) * 0.7 && landward(th)) angles.push(th);
  }
  const mains = [];
  const trace = (f, th0, rStart, rEnd, step) => {
    const pts = [], bridges = []; let th = th0;
    for (let d = rStart; d <= rEnd; d += step) {
      th = th0 + pat.wobble * nzP(d * 0.35 + th0 * 3, 1.7);
      const u = Math.cos(th) * d, v = Math.sin(th) * d, e = env[gidx(u, v)];
      if (e === 2 && d > rStart + 0.5) break;
      pts.push([u, v]); if (e === 1) bridges.push(pts.length - 1);
    }
    return { pts, bridges };
  };
  for (const th of angles) { const t = trace(0, th, 0, bound(th) * 1.02, 0.25); if (t.pts.length > 3) mains.push({ ...t, kind: "main", th }); }
  const th0 = mains.length ? mains[0].th : 0;
  // one ring at radius fraction f, broken wherever it would run into water or leave the plan
  const ringAt = (f, step = 3) => {
    const segs = []; let cur = [], bridges = [];
    for (let deg = 0; deg <= 360; deg += step) {
      const th = deg * Math.PI / 180, rr = f * bound(th) / 0.95, u = Math.cos(th) * rr, v = Math.sin(th) * rr, e = env[gidx(u, v)];
      if (e === 2 || e === 4) { if (cur.length > 3) segs.push({ pts: cur, bridges, kind: "ring", f }); cur = []; bridges = []; continue; }
      cur.push([u, v]); if (e === 1) bridges.push(cur.length - 1);
    }
    if (cur.length > 3) segs.push({ pts: cur, bridges, kind: "ring", f });
    return segs;
  };
  const rings = [];
  for (const f of pat.rings[type] || []) rings.push(...ringAt(f));
  const allRoads = [...mains, ...rings];
  // road distance raster (twice the district resolution), so each query is a lookup
  const G2 = G * 2, cg2 = cg / 2, rdist = new Float32Array(G2 * G2).fill(1e9);
  for (const p of allRoads) for (let k = 1; k < p.pts.length; k++) {
    const [ax, ay] = p.pts[k - 1], [bx, by] = p.pts[k], n = Math.ceil(Math.hypot(bx - ax, by - ay) / (cg2 * 0.5)) + 1;
    for (let t = 0; t <= n; t++) { const u = ax + (bx - ax) * t / n, v = ay + (by - ay) * t / n; const gx = Math.floor((u + EXT) / cg2), gy = Math.floor((v + EXT) / cg2); if (gx >= 0 && gy >= 0 && gx < G2 && gy < G2) rdist[gy * G2 + gx] = 0; }
  }
  chamfer(rdist, G2);
  const roadDist = (u, v) => { const gx = Math.floor((u + EXT) / cg2), gy = Math.floor((v + EXT) / cg2); return gx < 0 || gy < 0 || gx >= G2 || gy >= G2 ? 1e9 : rdist[gy * G2 + gx] * cg2 - cg2 * 0.5; };

  // districts: warped Voronoi around spiral seeds
  const K = { city: 48, port: 40, town: 22, fortress: 9, village: 6 }[type];
  const seeds = [];
  for (let k = 0; k < K; k++) {
    const rr = R * 0.95 * Math.sqrt((k + 0.5) / K), th = k * 2.39996 + r() * 0.4;
    const j = R / Math.sqrt(K) * 0.35;
    const u = Math.cos(th) * rr + (r() - 0.5) * j, v = Math.sin(th) * rr + (r() - 0.5) * j;
    const gi = gidx(u, v); if (gi >= 0 && env[gi] === 0) seeds.push({ i: seeds.length, u, v, n: 0, zone: null });
  }
  if (!seeds.length) { const k = start; seeds.push({ i: 0, u: gu(k % G), v: gu(Math.floor(k / G)), n: 0, zone: null }); }
  const dist = new Int16Array(G * G).fill(-1);
  for (let k = 0; k < G * G; k++) {
    if (env[k] !== 0) continue;
    let u = gu(k % G), v = gu(Math.floor(k / G));
    const wu = u + pat.warp * R * nzP(u / R * 2.5 + 20, v / R * 2.5), wv = v + pat.warp * R * nzP(u / R * 2.5, v / R * 2.5 + 20);
    let best = 0, bd = 1e9;
    for (const sd of seeds) { const d = (sd.u - wu) ** 2 + (sd.v - wv) ** 2; if (d < bd) { bd = d; best = sd.i; } }
    dist[k] = best; seeds[best].n++;
  }
  for (const sd of seeds) { const gi = gidx(sd.u, sd.v); sd.dn = Math.hypot(sd.u, sd.v) / R; sd.sea = dSea[gi]; sd.riv = dRiv[gi]; sd.ang = Math.atan2(sd.v, sd.u); }
  const free = () => seeds.filter(d => !d.zone && d.n > 0);
  const byDn = () => free().sort((a, b) => a.dn - b.dn);
  const plazaSeed = byDn()[0];
  plazaSeed.zone = { city: "core", port: "core", town: "core", village: "sub", fortress: "mil" }[type];
  if (type !== "fortress") {
    const nCivic = { city: 2, port: 1, town: 1, village: 0 }[type];
    byDn().slice(0, nCivic).forEach(d => d.zone = "civic");
    const coreT = { city: 0.38, port: 0.34, town: 0.3, village: 0 }[type];
    const core = free().filter(d => d.dn < coreT); (core.length ? core : type === "village" ? [] : byDn().slice(0, 1)).forEach(d => d.zone = "core");
    if (type === "port") free().filter(d => d.sea < R * 0.2).sort((a, b) => a.sea - b.sea).slice(0, 5).forEach(d => d.zone = "harbor");
    const nInd = { city: 3, port: 2, town: W.dRiver[py * N + px] < 4 ? 1 : 0, village: 0 }[type];
    free().filter(d => d.dn > 0.42).sort((a, b) => (Math.min(a.riv, a.sea) - 0.3 * R * a.dn) - (Math.min(b.riv, b.sea) - 0.3 * R * b.dn)).slice(0, nInd).forEach(d => d.zone = "ind");
    const nPark = { city: 3, port: 2, town: 1, village: 0 }[type];
    free().filter(d => d.dn > 0.22 && d.dn < 0.8).sort(() => r() - 0.5).slice(0, nPark).forEach(d => d.zone = "park");
    if (type !== "village" || seeds.length > 4) free().sort((a, b) => b.dn - a.dn).slice(0, 1).forEach(d => d.zone = "cem");
    const resT = { city: 0.66, port: 0.6, town: 0.48, village: 0 }[type];
    free().forEach(d => d.zone = d.dn < resT ? "res" : "sub");
  } else {
    free().forEach(d => d.zone = d.dn < 0.72 ? "mil" : "sub");
  }
  // lot orientation: the street pattern decides what each district's block lattice lines up with
  const contourTh = (u, v) => {
    const X = clamp(CX + u, 1, N - 2), Y = clamp(CY + v, 1, N - 2), i = Math.floor(Y) * N + Math.floor(X);
    const gx = W.h[i + 1] - W.h[i - 1], gy = W.h[i + N] - W.h[i - N];
    return Math.hypot(gx, gy) < 1e-5 ? null : Math.atan2(gy, gx) + Math.PI / 2;   // perpendicular to the gradient = along the contour
  };
  for (const sd of seeds) {
    let th = th0;
    if (pat.lot === "road") { let bd = 9; for (const m of mains) { const g2 = Math.abs(Math.atan2(Math.sin(sd.ang - m.th), Math.cos(sd.ang - m.th))); if (g2 < bd) { bd = g2; th = m.th; } } }
    else if (pat.lot === "radial") th = sd.ang;
    else if (pat.lot === "tangent") th = sd.ang + Math.PI / 2;
    else if (pat.lot === "contour") { const c2 = contourTh(sd.u, sd.v); if (c2 != null) th = c2; }
    sd.theta = th + (sd.zone === "sub" ? (r() - 0.5) * pat.jitter : 0);
    sd.off = pat.lot === "global" ? [0, 0] : [r(), r()];   // a shared offset is what makes a grid run through the whole town
  }

  // landmarks
  const landmarks = [];
  const okAt = (u, v) => { const gi = gidx(u, v); return gi >= 0 && env[gi] === 0; };
  // The era (or the spec's own list) fixes the vocabulary; anything outside it is substituted or dropped.
  // Several kinds can fall back onto the same one (three schools all resolve to "library" in an era with no
  // schools), so a substitution is capped — otherwise a town ends up with four identical landmarks in a row.
  // An exact vocabulary hit is never capped: a real city may well have three churches.
  const lmCount = {};
  const resolveLM = k => {
    if (vocab.has(k)) return k;
    for (const alt of LM_ALT[k] || []) if (vocab.has(alt) && (lmCount[alt] || 0) < 2) return alt;
    return null;
  };
  const place = (kind, u, v, w, h, rot, extra = {}) => {
    const k2 = resolveLM(kind); if (!k2) return null;
    for (let t = 0; t < 12 && !okAt(u, v); t++) { u *= 0.85; v *= 0.85; }
    if (!okAt(u, v)) return null;
    lmCount[k2] = (lmCount[k2] || 0) + 1;
    const L = { kind: k2, u, v, w, h, rot, ...extra }; landmarks.push(L); return L;
  };
  const PS = { city: 1.3, port: 1.1, town: 0.9, village: 0.7, fortress: 1.1 }[type];
  const plaza = place("plaza", plazaSeed.u, plazaSeed.v, PS, PS, th0);
  const around = (L, side, gap) => { const a = L.rot + side * Math.PI / 2; return [L.u + Math.cos(a) * (L.w / 2 + gap), L.v + Math.sin(a) * (L.w / 2 + gap)]; };
  const seedOf = z => seeds.filter(d => d.zone === z && d.n > 3);
  if (plaza) {
    if (type === "fortress") place("keep", ...around(plaza, 0, 0.75), 1.1, 1.1, th0);
    else {
      if (type !== "village") place("cityhall", ...around(plaza, 0, 0.42), 0.62, 0.46, th0);
      place(type === "city" ? "cathedral" : type === "village" ? "chapel" : "church", ...around(plaza, 2, type === "city" ? 0.55 : 0.38), type === "city" ? 0.95 : type === "village" ? 0.42 : 0.6, type === "city" ? 0.5 : 0.3, th0);
      if (type !== "village") place("market", ...around(plaza, 1, 0.5), type === "city" ? 0.8 : 0.6, 0.55, th0);
      if (type === "city") place("library", ...around(plaza, 3, 0.45), 0.55, 0.4, th0);
    }
    if (type === "fortress") place("chapel", ...around(plaza, 2, 0.4), 0.4, 0.24, th0);
  }
  const pick = (list, n) => list.sort((a, b) => a.i * 7919 % 13 - b.i * 7919 % 13).slice(0, n);
  if (type === "city" || type === "port") {
    const hs = seeds.filter(d => (d.zone === "res" || d.zone === "civic") && d.dn > 0.3).sort((a, b) => Math.abs(a.dn - 0.45) - Math.abs(b.dn - 0.45))[0];
    if (hs) place("hospital", hs.u, hs.v, 0.85, 0.6, hs.theta);
    pick(seedOf("res").concat(seedOf("sub")), type === "city" ? 3 : 1).forEach(d => place("school", d.u, d.v, 0.55, 0.45, d.theta));
    pick(seedOf("res"), type === "city" ? 2 : 1).forEach(d => place("church", d.u + 0.3, d.v, 0.5, 0.26, d.theta));
    // railway station on the main road towards the biggest neighbour
    const mm = mains.slice().sort((a, b) => b.pts.length - a.pts.length)[0];
    if (mm) { const p = mm.pts[Math.floor(mm.pts.length * 0.72)]; const a = mm.th + Math.PI / 2; const st = place("station", p[0] + Math.cos(a) * 0.55, p[1] + Math.sin(a) * 0.55, 1.1, 0.3, mm.th); if (st) st.railTh = mm.th; }
  } else if (type === "town") {
    const hs = seedOf("res").concat(seedOf("sub"))[0]; if (hs) place("clinic", hs.u, hs.v, 0.5, 0.36, hs.theta);
    const sc2 = seedOf("sub")[0] || seedOf("res")[1]; if (sc2) place("school", sc2.u, sc2.v, 0.45, 0.38, sc2.theta);
  }
  seedOf("ind").forEach(d => place("factory", d.u, d.v, 0.95, 0.6, d.theta));
  if (type === "port") {
    let best = null, bd = -1;
    for (let k = 0; k < G * G; k++) { if (env[k] !== 0 || dSea[k] > cg * 1.5) continue; const u = gu(k % G), v = gu(Math.floor(k / G)), d = Math.hypot(u, v); if (d > bd && d < R) { bd = d; best = [u, v]; } }
    if (best) place("lighthouse", best[0], best[1], 0.3, 0.3, 0);
  }
  const lmHit = (u, v, pad) => landmarks.some(L => {
    const c = Math.cos(-L.rot), s2 = Math.sin(-L.rot), du = u - L.u, dv = v - L.v;
    const x = du * c - dv * s2, y = du * s2 + dv * c;
    const extra = L.kind === "school" ? 0.35 : L.kind === "plaza" ? 0.05 : 0.08;
    return Math.abs(x) < L.w / 2 + pad + extra && Math.abs(y) < L.h / 2 + pad + extra + (L.kind === "school" ? 0.2 : 0);
  });

  // blocks and buildings
  const SP = { core: 0.44, civic: 0.52, res: 0.5, sub: 0.64, ind: 0.9, harbor: 0.78, mil: 0.6 };
  const ST = { core: 0.09, civic: 0.1, res: 0.09, sub: 0.08, ind: 0.15, harbor: 0.15, mil: 0.11 };
  const blocks = [], buildings = [];
  const roadHalf = type === "city" ? 0.13 : 0.1;
  const bbox = seeds.map(() => [1e9, 1e9, -1e9, -1e9]);
  for (let k = 0; k < G * G; k++) { const d = dist[k]; if (d < 0) continue; const u = gu(k % G), v = gu(Math.floor(k / G)), b = bbox[d]; b[0] = Math.min(b[0], u); b[1] = Math.min(b[1], v); b[2] = Math.max(b[2], u); b[3] = Math.max(b[3], v); }
  for (const sd of seeds) {
    const z = ZONES[sd.zone]; if (!z || !z.block) continue;
    const sp = SP[sd.zone] * (type === "town" || type === "village" ? 1.08 : 1) * style.block_scale, st = ST[sd.zone];
    const c = Math.cos(sd.theta), s2 = Math.sin(sd.theta);
    const b = bbox[sd.i]; if (b[0] > b[2]) continue;
    const corners = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([u, v]) => [u * c + v * s2, -u * s2 + v * c]);
    const a0 = Math.min(...corners.map(p => p[0])), a1 = Math.max(...corners.map(p => p[0]));
    const b0 = Math.min(...corners.map(p => p[1])), b1 = Math.max(...corners.map(p => p[1]));
    for (let i = Math.floor(a0 / sp) - 1; i <= Math.ceil(a1 / sp); i++) for (let j = Math.floor(b0 / sp) - 1; j <= Math.ceil(b1 / sp); j++) {
      const la = (i + sd.off[0]) * sp, lb = (j + sd.off[1]) * sp;
      const u = la * c - lb * s2, v = la * s2 + lb * c;
      const gi = gidx(u, v); if (gi < 0 || dist[gi] !== sd.i) continue;
      const bw = sp - st, hw = bw / 2;
      let ok = true;
      for (const [du, dv] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) { const g2 = gidx(u + du * c - dv * s2, v + du * s2 + dv * c); if (g2 < 0 || env[g2] !== 0) { ok = false; break; } }
      if (!ok) continue;
      const rd = roadDist(u, v);
      if (rd < roadHalf + hw * 0.4) continue;
      const small = rd < roadHalf + hw * 0.95;   // shrink blocks that front a main road instead of dropping them
      if (lmHit(u, v, hw * 0.7)) continue;
      const blk = { u, v, w: small ? bw * 0.55 : bw, h: small ? bw * 0.55 : bw, rot: sd.theta, zone: sd.zone };
      blocks.push(blk);
      // lots
      const dn = Math.hypot(u, v) / R;
      const [hmin, hmax] = z.h;
      const hgt = () => (hmin + (hmax - hmin) * r() * (sd.zone === "core" ? (1 - 0.7 * dn) : 1)) * style.building_height;
      const lots = small ? [[0, 0]] : sd.zone === "core" || sd.zone === "res" || sd.zone === "sub" ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[0, 0]];
      for (const [lx, ly] of lots) {
        if (sd.zone === "sub" && r() < 0.35) continue;
        const lw = (lots.length > 1 ? bw / 2 : bw) * (small ? 0.55 : 1);
        const cu = lx * lw / 2, cv = ly * lw / 2;
        let w, d;
        if (sd.zone === "sub") { w = lw * (0.42 + r() * 0.12); d = lw * (0.36 + r() * 0.1); }
        else if (sd.zone === "ind") { w = lw * (0.62 + r() * 0.25); d = lw * (0.45 + r() * 0.25); }
        else if (sd.zone === "harbor" || sd.zone === "mil") { w = lw * 0.82; d = lw * 0.3; }
        else { w = lw * (0.8 + r() * 0.14); d = lw * (0.8 + r() * 0.14); }
        const pu = u + cu * c - cv * s2, pv = v + cu * s2 + cv * c;
        buildings.push({ u: pu, v: pv, w, d, rot: sd.theta, h: hgt(), zone: sd.zone });
        if (sd.zone === "harbor" || sd.zone === "mil") { const o = lw * 0.24; buildings[buildings.length - 1].u += -o * s2; buildings[buildings.length - 1].v += o * c; buildings.push({ u: pu + o * s2, v: pv - o * c, w, d, rot: sd.theta, h: hgt(), zone: sd.zone }); }
      }
    }
  }
  // trees in parks and on steep ground inside the town, stones in cemeteries
  const trees = [], stones = [];
  for (let k = 0; k < G * G; k++) {
    const u = gu(k % G), v = gu(Math.floor(k / G));
    const zn = dist[k] >= 0 ? seeds[dist[k]].zone : null;
    if ((zn === "park" && r() < 0.28) || (env[k] === 3 && Math.hypot(u, v) < R && r() < 0.35)) {
      const tu = u + (r() - 0.5) * cg, tv = v + (r() - 0.5) * cg;
      if (!lmHit(tu, tv, 0.05) && roadDist(tu, tv) > roadHalf + 0.05) trees.push([tu, tv, 0.18 + r() * 0.12]);
    }
    if (zn === "cem" && (k % G) % 2 === 0 && Math.floor(k / G) % 2 === 0) stones.push([u, v]);
  }
  // piers for ports
  const piers = [];
  if (type === "port") for (const sd of seeds.filter(d => d.zone === "harbor")) {
    // walk from the district towards the nearest sea cell
    let bestK = -1, bd = 1e9; for (let k = 0; k < G * G; k++) if (env[k] === 2) { const d = (gu(k % G) - sd.u) ** 2 + (gu(Math.floor(k / G)) - sd.v) ** 2; if (d < bd) { bd = d; bestK = k; } }
    if (bestK < 0 || Math.sqrt(bd) > R * 0.3) continue;
    const a = Math.atan2(gu(Math.floor(bestK / G)) - sd.v, gu(bestK % G) - sd.u);
    for (const off of [-0.5, 0, 0.5]) {
      const bu = gu(bestK % G) + Math.cos(a + Math.PI / 2) * off - Math.cos(a) * 0.15, bv = gu(Math.floor(bestK / G)) + Math.sin(a + Math.PI / 2) * off - Math.sin(a) * 0.15;
      piers.push({ u: bu + Math.cos(a) * 0.35, v: bv + Math.sin(a) * 0.35, w: 0.8, d: 0.09, rot: a });
    }
  }
  // walls: "auto" gives every fortress a curtain wall, and a town wall only to eras that still build them
  const walled = style.walls === "always" ? true : style.walls === "never" ? false
    : type === "fortress" || (type === "city" && (style.era === "medieval" || style.era === "alien"));
  const walls = [];
  if (walled) {
    const wf = type === "fortress" ? 0.63 : type === "village" ? 0.78 : type === "town" ? 0.60 : 0.40;
    for (const seg of ringAt(wf, type === "fortress" ? 6 : 3)) if (seg.pts.length > 6) walls.push({ pts: seg.pts, gates: mains.map(m => m.th) });
  }
  // farmland: a rotated patchwork of parcels around the settlement (drawn on the regional map)
  const fields = [];
  const fr = rng(hashStr(s.id) + 7);
  const crops = ["#d8c983", "#b7c886", "#cbb285", "#a4bd79", "#ddd49a", "#c4c98f"];
  const fth = (mains[0] ? mains[0].th : 0) + 0.2, fc = Math.cos(fth), fs = Math.sin(fth);
  const FR = R * ({ city: 1.85, port: 1.8, town: 1.9, fortress: 1.6, village: 2.3 }[type]);
  const fsz = type === "village" ? 0.75 : 0.95;
  for (let i = -Math.ceil(FR / fsz); i <= Math.ceil(FR / fsz); i++) for (let j = -Math.ceil(FR / fsz); j <= Math.ceil(FR / fsz); j++) {
    const la = (i + 0.5) * fsz, lb = (j + 0.5) * fsz * 0.8;
    const u = la * fc - lb * fs, v = la * fs + lb * fc, d = Math.hypot(u, v);
    if (d < R * 0.92 || d > FR * (0.8 + 0.25 * nzP(u * 0.3 + 40, v * 0.3))) continue;
    if (fr() < 0.18) continue;
    const X = CX + u, Y = CY + v; if (envAt(W, X, Y) !== 0) continue;
    const ii = Math.floor(Y) * N + Math.floor(X);
    if (slopeAt(W, ii) > 2 * SLOPE_MAX || W.h[ii] - W.P.sea > MOUNTAIN_REL - 0.04) continue;
    if (roadDist(u, v) < 0.25) continue;
    const split = fr() < 0.4;
    for (const o of split ? [-0.25, 0.25] : [0]) fields.push({ u: u + o * fsz * fc, v: v + o * fsz * fs, w: fsz * (split ? 0.46 : 0.92), d: fsz * 0.72, rot: fth, c: crops[Math.floor(fr() * crops.length)] });
  }
  const zoneCells = {};
  for (let k = 0; k < G * G; k++) if (dist[k] >= 0) { const z = seeds[dist[k]].zone; zoneCells[z] = (zoneCells[z] || 0) + 1; }
  const plan = { id: s.id, name: s.name, type, style, R, CX, CY, EXT, G, cg, env, dist, seeds, mains, rings, blocks, buildings, landmarks, trees, stones, piers, walls, fields, zoneCells, bridges: [] };
  W._plans[s.id] = plan;
  return plan;
}

// ---------- drawing ----------
function planGroundCanvas(W, P) {
  if (P._ground) return P._ground;
  const { G, env, dist, seeds } = P;
  const c = document.createElement("canvas"); c.width = c.height = G;
  const ctx = c.getContext("2d"), img = ctx.createImageData(G, G), d = img.data;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const cols = {}; for (const [k, z] of Object.entries(ZONES)) cols[k] = hex(z.ground || STREET);
  const steep = hex("#a7c592");
  for (let k = 0; k < G * G; k++) {
    let col = null;
    if (dist[k] >= 0) col = cols[seeds[dist[k]].zone];
    else if (env[k] === 3) { const u = -P.EXT + (k % G + 0.5) * P.cg, v = -P.EXT + (Math.floor(k / G) + 0.5) * P.cg; if (Math.hypot(u, v) < P.R) col = steep; }
    if (!col) continue;
    const o = k * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  P._ground = c; return c;
}
function planWaterCanvas(W, P, res) {
  P._water = P._water || {};
  if (P._water[res]) return P._water[res];
  const c = document.createElement("canvas"); c.width = c.height = res;
  const ctx = c.getContext("2d"), img = ctx.createImageData(res, res), d = img.data, step = 2 * P.EXT / res;
  const wc = [134, 182, 204];
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = -P.EXT + (x + 0.5) * step, v = -P.EXT + (y + 0.5) * step;
    if (u * u + v * v > P.R * P.R * 1.12) continue;
    if (envAt(W, P.CX + u, P.CY + v) !== 1) continue;
    const o = (y * res + x) * 4; d[o] = wc[0]; d[o + 1] = wc[1]; d[o + 2] = wc[2]; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  P._water[res] = c; return c;
}
// crisp water (sea, lakes, rivers) for an arbitrary square view, in map-cell coordinates
function viewWaterCanvas(W, X0, Y0, size, res) {
  const c = document.createElement("canvas"); c.width = c.height = res;
  const ctx = c.getContext("2d"), img = ctx.createImageData(res, res), d = img.data, step = size / res;
  const wf = waterFields(W);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const X = X0 + (x + 0.5) * step, Y = Y0 + (y + 0.5) * step;
    const e = envAt(W, X, Y); if (e !== 1 && e !== 2) continue;
    const o = (y * res + x) * 4;
    if (e === 2) { const deep = clamp((W.P.sea - bil(W.h, X - 0.5, Y - 0.5)) / 0.25, 0, 1); const lake = W.hy.lake[Math.floor(Y) * N + Math.floor(X)];
      d[o] = lake ? 122 : 140 - 60 * deep; d[o + 1] = lake ? 170 : 186 - 50 * deep; d[o + 2] = lake ? 190 : 204 - 30 * deep; }
    else { d[o] = 134; d[o + 1] = 182; d[o + 2] = 204; }
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function rrect(ctx, u, v, w, h, rot) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hh = h / 2;
  ctx.moveTo(u + (-hw) * c - (-hh) * s, v + (-hw) * s + (-hh) * c);
  ctx.lineTo(u + hw * c - (-hh) * s, v + hw * s + (-hh) * c);
  ctx.lineTo(u + hw * c - hh * s, v + hw * s + hh * c);
  ctx.lineTo(u + (-hw) * c - hh * s, v + (-hw) * s + hh * c);
  ctx.closePath();
}
function strokePolys(ctx, polys, width, color) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  for (const p of polys) { p.pts.forEach(([u, v], k) => k ? ctx.lineTo(u, v) : ctx.moveTo(u, v)); }
  ctx.stroke();
}
// Draw a plan in plan units. The caller sets the transform so 1 unit = 1 map cell and the origin is the plan centre.
// opt: { unitPx, detail, labels, hlZone }
function drawPlan(ctx, W, P, opt) {
  const px = opt.unitPx; // pixels per cell, to keep line widths readable
  const lw = v => Math.max(v, 0.6 / px);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(planGroundCanvas(W, P), -P.EXT, -P.EXT, 2 * P.EXT, 2 * P.EXT);
  if (px >= 6) ctx.drawImage(planWaterCanvas(W, P, Math.min(512, Math.ceil(2 * P.EXT * px / 2))), -P.EXT, -P.EXT, 2 * P.EXT, 2 * P.EXT);
  // blocks
  const fills = {};
  for (const b of P.blocks) (fills[b.zone] = fills[b.zone] || []).push(b);
  for (const [z, list] of Object.entries(fills)) {
    ctx.globalAlpha = opt.hlZone && opt.hlZone !== z ? 0.35 : 1;
    ctx.fillStyle = ZONES[z].block; ctx.beginPath(); for (const b of list) rrect(ctx, b.u, b.v, b.w, b.h, b.rot); ctx.fill();
  }
  if (px >= 5) {
    const bl = {};
    for (const b of P.buildings) (bl[b.zone] = bl[b.zone] || []).push(b);
    for (const [z, list] of Object.entries(bl)) {
      ctx.globalAlpha = opt.hlZone && opt.hlZone !== z ? 0.35 : 1;
      ctx.fillStyle = zoneBld(P.style, z); ctx.beginPath(); for (const b of list) rrect(ctx, b.u, b.v, b.w, b.d, b.rot); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // cemetery stones and park trees
  if (px >= 8) {
    ctx.fillStyle = "#8f9a88"; ctx.beginPath(); for (const [u, v] of P.stones) { ctx.rect(u - 0.03, v - 0.02, 0.06, 0.04); } ctx.fill();
    ctx.fillStyle = "#6f9a5e"; ctx.beginPath(); for (const [u, v, rr] of P.trees) { ctx.moveTo(u + rr * 0.6, v); ctx.arc(u, v, rr * 0.6, 0, 7); } ctx.fill();
  }
  // roads
  const roads = [...P.mains, ...P.rings];
  const rw = P.type === "city" ? 0.2 : 0.16;
  strokePolys(ctx, roads, lw(rw + 0.07), ROAD_EDGE);
  // bridges: darker casing over water
  ctx.strokeStyle = "#6c5f4f"; ctx.lineWidth = lw(rw + 0.16); ctx.beginPath();
  for (const p of roads) for (const k of p.bridges) { const a = p.pts[Math.max(0, k - 1)], b = p.pts[Math.min(p.pts.length - 1, k + 1)]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  strokePolys(ctx, roads, lw(rw), ROAD_FILL);
  // piers
  ctx.fillStyle = "#8a6e4f"; ctx.beginPath(); for (const p of P.piers) rrect(ctx, p.u, p.v, p.w, p.d, p.rot); ctx.fill();
  // walls
  for (const w of P.walls) {
    ctx.strokeStyle = WALL; ctx.lineWidth = lw(0.12); ctx.lineCap = "butt"; ctx.beginPath();
    w.pts.forEach(([u, v], k) => {
      const th = Math.atan2(v, u);
      const gate = w.gates.some(g => Math.abs(Math.atan2(Math.sin(th - g), Math.cos(th - g))) < 0.07);
      if (k && !gate) ctx.lineTo(u, v); else ctx.moveTo(u, v);
    });
    ctx.stroke();
    if (px >= 6) { ctx.fillStyle = WALL; ctx.beginPath(); w.pts.forEach(([u, v], k) => { if (k % 5 === 0) { ctx.moveTo(u + 0.11, v); ctx.arc(u, v, 0.11, 0, 7); } }); ctx.fill(); }
  }
  // landmarks
  for (const L of P.landmarks) drawLandmark(ctx, L, px, opt.hlZone);
  ctx.restore();
}
function drawLandmark(ctx, L, px, hl) {
  const { u, v, w, h, rot } = L;
  const dim = hl && hl !== "landmark" ? 0.4 : 1;
  ctx.save(); ctx.globalAlpha = dim;
  ctx.translate(u, v); ctx.rotate(rot);
  const box = (x, y, bw, bh, fill, stroke) => { ctx.beginPath(); ctx.rect(x - bw / 2, y - bh / 2, bw, bh); ctx.fillStyle = fill; ctx.fill(); if (stroke && px >= 6) { ctx.strokeStyle = stroke; ctx.lineWidth = 1 / px; ctx.stroke(); } };
  switch (L.kind) {
    case "plaza":
      box(0, 0, w, h, "#e7d7ba", "#b9a67f");
      if (px >= 8) { ctx.strokeStyle = "rgba(160,140,110,0.5)"; ctx.lineWidth = 1 / px; ctx.beginPath(); for (let t = -w / 2; t <= w / 2; t += w / 8) { ctx.moveTo(t, -h / 2); ctx.lineTo(t, h / 2); ctx.moveTo(-w / 2, t); ctx.lineTo(w / 2, t); } ctx.stroke(); }
      ctx.fillStyle = "#6fa8c4"; ctx.beginPath(); ctx.arc(0, 0, w * 0.12, 0, 7); ctx.fill();
      break;
    case "cityhall": box(0, 0, w, h, "#9a83b8", "#5e4d78"); box(0, 0, w * 0.45, h * 0.4, "#e6daf0"); break;
    case "library": box(0, 0, w, h, "#a893c4", "#5e4d78"); break;
    case "cathedral": case "church": case "chapel": {
      ctx.fillStyle = "#7b5f9e"; ctx.beginPath();
      ctx.rect(-w / 2, -h * 0.28, w, h * 0.56);          // nave
      ctx.rect(w * 0.08, -h / 2, h * 0.5, h);             // transept
      ctx.fill();
      ctx.fillStyle = "#5b4478"; ctx.beginPath(); ctx.arc(-w / 2 + h * 0.2, 0, h * 0.26, 0, 7); ctx.fill(); // tower
      break;
    }
    case "hospital":
    case "clinic": {
      ctx.fillStyle = "#fbfbfb"; ctx.strokeStyle = "#c23a3a"; ctx.lineWidth = Math.max(1.2 / px, 0.03);
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w * 0.28, h); ctx.rect(w / 2 - w * 0.28, -h / 2, w * 0.28, h); ctx.rect(-w / 2, -h * 0.15, w, h * 0.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d23a3a"; const c = Math.min(w, h) * 0.32; ctx.fillRect(-c / 2, -c * 0.15, c, c * 0.3); ctx.fillRect(-c * 0.15, -c / 2, c * 0.3, c);
      break;
    }
    case "market":
      box(0, 0, w, h, "#e3a458", "#9b6a2c");
      if (px >= 8) { ctx.strokeStyle = "#fff1dc"; ctx.lineWidth = 1 / px; ctx.beginPath(); for (let t = -w / 2 + w / 5; t < w / 2; t += w / 5) { ctx.moveTo(t, -h / 2); ctx.lineTo(t, h / 2); } ctx.stroke(); }
      break;
    case "school":
      ctx.fillStyle = "#d8b447"; ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h * 0.35); ctx.rect(-w / 2, -h / 2, w * 0.3, h); ctx.fill();
      ctx.fillStyle = "#9cc98a"; ctx.beginPath(); ctx.ellipse(w * 0.2, h * 0.35, w * 0.32, h * 0.3, 0, 0, 7); ctx.fill();
      if (px >= 8) { ctx.strokeStyle = "#f4f1e6"; ctx.lineWidth = 1 / px; ctx.stroke(); }
      break;
    case "station":
      if (px >= 4) { ctx.strokeStyle = "#5d5348"; ctx.lineWidth = Math.max(1 / px, 0.04); ctx.setLineDash([0.12, 0.08]); ctx.beginPath(); ctx.moveTo(-w * 2.5, h * 0.9); ctx.lineTo(w * 2.5, h * 0.9); ctx.stroke(); ctx.setLineDash([]); }
      box(0, 0, w, h, "#8b7a68", "#4f4439");
      break;
    case "factory":
      box(0, 0, w, h, "#8e8c98", "#55535e"); box(w * 0.25, h * 0.1, w * 0.3, h * 0.45, "#76747f");
      ctx.fillStyle = "#3f3d44"; ctx.beginPath(); ctx.arc(-w * 0.3, -h * 0.25, h * 0.12, 0, 7); ctx.fill();
      break;
    case "lighthouse":
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#c23a3a"; ctx.lineWidth = Math.max(1.5 / px, 0.05); ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, 7); ctx.fill(); ctx.stroke();
      break;
    case "keep":
      box(0, 0, w, h, "#7a7266", "#403a31");
      ctx.fillStyle = "#5a5348"; ctx.beginPath(); for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(x * w / 2 + w * 0.14, y * h / 2); ctx.arc(x * w / 2, y * h / 2, w * 0.14, 0, 7); } ctx.fill();
      break;
  }
  ctx.restore();
}
// A small rendering of a plan, used for the regional map and the 3D terrain texture
function planOverview(W, P) {
  if (P._ov) return P._ov;
  const px = 10, size = Math.ceil(2 * P.EXT * px);
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.setTransform(px, 0, 0, px, size / 2, size / 2);
  drawPlan(ctx, W, P, { unitPx: px });
  P._ov = c; return c;
}
function drawFields(ctx, P) {
  ctx.save();
  ctx.globalAlpha = 0.62;
  for (const f of P.fields) { ctx.fillStyle = f.c; ctx.beginPath(); rrect(ctx, f.u, f.v, f.w, f.d, f.rot); ctx.fill(); }
  ctx.restore();
}
// regional roads and farmland on a map canvas where 1 cell = k px
function drawRegionalOverlay(ctx, W, k, opts = {}) {
  const S = W.spec.settlements;
  const plans = S.map(s => cityPlan(W, s));
  ctx.save(); ctx.scale(k, k);
  for (const P of plans) { ctx.save(); ctx.translate(P.CX, P.CY); drawFields(ctx, P); ctx.restore(); }
  // roads, clipped away from town centres
  const roads = buildRoads(W);
  const pieces = [];
  for (const rd of roads) {
    let cur = [];
    for (const [x, y] of rd.pts) {
      const inside = plans.some(P => Math.hypot(x - P.CX, y - P.CY) < P.R * 0.85);
      if (inside) { if (cur.length > 1) pieces.push({ pts: cur, major: rd.major }); cur = []; } else cur.push([x, y]);
    }
    if (cur.length > 1) pieces.push({ pts: cur, major: rd.major });
  }
  const scale = opts.widthScale || 1;
  for (const pass of [0, 1]) for (const p of pieces) {
    const w = (p.major ? 0.34 : 0.22) * scale;
    ctx.strokeStyle = pass ? (p.major ? "#f7e7a8" : "#f4efe2") : "rgba(90,70,40,0.55)";
    ctx.lineWidth = Math.max(pass ? w : w + 0.16 * scale, (pass ? 1.2 : 2.2) / k);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); p.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
  }
  // bridges
  ctx.fillStyle = "#6c5f4f";
  for (const rd of roads) for (const [x, y] of rd.pts) { const i = Math.floor(y) * N + Math.floor(x); if (W.hy.channel[i] && !W.hy.lake[i] && !plans.some(P => Math.hypot(x - P.CX, y - P.CY) < P.R * 0.85)) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.28 * scale, 1.5 / k), 0, 7); ctx.fill(); } }
  // town plans
  for (const P of plans) {
    const ov = planOverview(W, P);
    ctx.drawImage(ov, P.CX - P.EXT, P.CY - P.EXT, 2 * P.EXT, 2 * P.EXT);
  }
  ctx.restore();
}

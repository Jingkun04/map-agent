// ===================== CORE: generation, verification, tools =====================
const N = 512, NN = N * N, SC = N / 256;
const KM_PER_CELL = 2, KM_PER_DAY = 32;
// World scale: the grid stays 512 x 512, so a larger scale means more km per cell (and finer features per km).
const SCALES = { region: { km: 2, fq: 1 }, kingdom: { km: 4, fq: 1.6 }, continent: { km: 8, fq: 2.4 } };
const kmOf = W => (SCALES[W.spec.scale] || SCALES.region).km;
const MOUNTAIN_REL = 0.36;      // elevation above sea level that counts as mountain
const SLOPE_MAX = 0.016;        // settlements need flatter ground than this
const LAKE_DEPTH = 0.024, LAKE_MIN = 160;
const MAJOR_LEN = 60;           // cells of main stem for a "major" river
const MOUNTAIN_MIN_CELLS = 1400;
const ACCESS_T = 0.88, ACCESS_SOFT = 0.80, DEF_T = 0.22;   // corridor / defensible-site thresholds, set from measured percentiles
const REGIONS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"];
// ---------- language ----------
// LANG picks the language of every string the program writes. The *_ZH tables below are the live name tables: the
// page swaps their contents to English (setLang in ui.js), so lookups like REGION_ZH[r] follow the switch.
let LANG = "zh";
const L = (zh, en) => LANG === "en" ? en : zh;
const RG = r => L(`${REGION_ZH[r] || ""}部`, `the ${REGION_ZH[r] || r}`);          // "西北部" / "the northwest"
const NAMES_EN = {
  REGION_ZH: { NW: "northwest", N: "north", NE: "northeast", W: "west", C: "centre", E: "east", SW: "southwest", S: "south", SE: "southeast" },
  TYPE_ZH: { port: "port", city: "city", town: "town", village: "village", fortress: "fortress" },
  REQ_ZH: { coast: "on the coast", river_mouth: "at a river mouth", on_river: "on a river", lakeside: "by a lake", near_mountain: "near mountains", accessible: "accessible", defensible: "defensible" },
  REL_ZH: { downstream_of: "downstream of", within_days_of: "within" },
  BIOME_ZH: { ocean: "ocean", lake: "lake", snow: "snowfield", rock: "bare rock", tundra: "tundra", taiga: "taiga", steppe: "steppe", desert: "desert", grassland: "grassland", forest: "temperate forest", marsh: "marsh", rainforest: "temperate rainforest", ice: "ice sheet", savanna: "savanna", jungle: "jungle", playa: "salt flat" },
  RIVER_NAMES: ["Greywater", "Willow Brook", "Blackstone", "Silverband", "Mistrun", "Redmud", "Heron River", "Coldspring", "Whitesand", "Reedwither", "Longmere", "Singing Brook"],
  LAKE_NAMES: ["Mirror Lake", "Sunken Bell", "Reedpond", "Coldtarn", "Crescent Mere", "Greyeye Lake", "Bottomless Tarn", "Crane Lake"],
  DIRS8: ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"],
  LANDFORM_ZH: { coast: "coast", continent: "continent", archipelago: "archipelago", islands: "large islands", peninsula: "peninsula", isthmus: "isthmus", inland_sea: "inland sea", fjords: "fjord coast", volcanic_island: "volcanic island", shattered: "shattered land", lakeland: "lakeland", highland: "rift highland", plains: "inland plains", basin: "mountain-ringed basin", bay: "gulf coast", two_coasts: "two-sea coast" },
  CHAR_METRICS: { land_share: "land share of map", lake_share: "lakes, share of land", mountain_share: "mountains, share of land", desert_share: "desert and salt flat, share of land", grass_share: "grassland, share of land", forest_share: "forest, share of land", cold_share: "ice and tundra, share of land", wetland_share: "marsh, share of land", islands: "landmasses" },
  CHAR_LEVEL_ZH: { none: "almost none", low: "low", moderate: "moderate", high: "high", dominant: "dominant" },
};
const REGION_ZH = { NW: "西北", N: "北", NE: "东北", W: "西", C: "中", E: "东", SW: "西南", S: "南", SE: "东南" };
const TYPE_ZH = { port: "港口", city: "城市", town: "城镇", village: "村庄", fortress: "要塞" };
const REQ_ZH = { coast: "临海", river_mouth: "位于河口", on_river: "临河", lakeside: "临湖", near_mountain: "靠近山脉", accessible: "交通通达", defensible: "易守难攻" };
const REL_ZH = { downstream_of: "位于其下游", within_days_of: "路程不超过" };
const BIOME_ZH = { ocean: "海洋", lake: "湖泊", snow: "雪峰", rock: "裸岩山地", tundra: "苔原", taiga: "针叶林", steppe: "干草原", desert: "荒漠", grassland: "草地", forest: "温带森林", marsh: "沼泽", rainforest: "温带雨林",
  ice: "冰原", savanna: "稀树草原", jungle: "热带雨林", playa: "盐碱滩" };   // the last three only appear under a climate_zone
const RIVER_NAMES = ["灰水河", "柳溪", "黑石河", "银带河", "雾川", "赤泥河", "鹭河", "冷泉河", "白沙河", "枯苇河", "长汀", "鸣石溪"];
const LAKE_NAMES = ["镜湖", "沉钟湖", "苇塘", "寒潭", "月牙泊", "灰眼湖", "无底潭", "鹤汀湖"];
const DIRS8 = ["东", "东南", "南", "西南", "西", "西北", "北", "东北"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function clampInt(v, a, b, d) { v = Math.round(+v); return Number.isFinite(v) ? clamp(v, a, b) : d; }
function regionOf(x, y) { const cx = Math.min(2, Math.floor(x / (N / 3))), cy = Math.min(2, Math.floor(y / (N / 3))); return REGIONS[cy * 3 + cx]; }
function regionCenter(r) { const i = REGIONS.indexOf(r); return [((i % 3) + 0.5) * N / 3, (Math.floor(i / 3) + 0.5) * N / 3]; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const deep = o => JSON.parse(JSON.stringify(o));
const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1], DY8 = [-1, -1, -1, 0, 0, 1, 1, 1], DD8 = [1.414, 1, 1.414, 1, 1, 1.414, 1, 1.414];

function makePerlin(seed) {
  const r = rng(seed), perm = [...Array(256).keys()], p = new Uint8Array(512);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1.41, 0], [-1.41, 0], [0, 1.41], [0, -1.41]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xf = Math.floor(x), yf = Math.floor(y), X = xf & 255, Y = yf & 255; x -= xf; y -= yf;
    const g = (hh, dx, dy) => { const q = G[hh & 7]; return q[0] * dx + q[1] * dy; };
    const u = fade(x), v = fade(y);
    const n00 = g(p[p[X] + Y], x, y), n10 = g(p[p[X + 1] + Y], x - 1, y);
    const n01 = g(p[p[X] + Y + 1], x, y - 1), n11 = g(p[p[X + 1] + Y + 1], x - 1, y - 1);
    const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  };
}
function fbm(nz, x, y, oct) { let s = 0, a = 0.5, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += a * nz(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; } return s / norm; }

// ---------- WorldSpec ----------
function normalizeSpec(raw) {
  const s = raw && typeof raw === "object" ? deep(raw) : {};
  const out = {};
  out.name = String(s.name || L("未命名区域", "Unnamed region")).slice(0, 40);
  out.seed = Number.isFinite(+s.seed) ? (Math.abs(+s.seed | 0) % 100000) : hashStr(out.name) % 100000;
  // Optional fields below (landform, scale, climate_zone, names, hamlets) are left out when absent, so a spec
  // without them derives exactly the world it always did — the benchmark specs depend on that.
  if (LANDFORMS.includes(s.landform)) out.landform = s.landform;
  out.ocean_side = OCEAN_SIDES.includes(s.ocean_side) ? s.ocean_side
    : out.landform ? (LANDFORM_SIDE[out.landform] || "E") : "E";
  // two seas can only be drawn by the two-coast template; without a landform the old one-sided shapes would drop them
  if (out.ocean_side.length === 2 && !out.landform) out.landform = "two_coasts";
  if (SCALES[s.scale] && s.scale !== "region") out.scale = s.scale;
  if (s.climate_zone && typeof s.climate_zone === "object") {
    const t = CLIMATE_T[s.climate_zone.temperature] != null ? s.climate_zone.temperature : "temperate";
    const w = CLIMATE_W[s.climate_zone.humidity] ? s.climate_zone.humidity : "normal";
    if (t !== "temperate" || w !== "normal") out.climate_zone = { temperature: t, humidity: w };
  }
  if (s.names && typeof s.names === "object") {
    const pool = (a, n) => (Array.isArray(a) ? a : []).map(x => String(x || "").trim().slice(0, 12)).filter(Boolean).slice(0, n);
    const nm = { rivers: pool(s.names.rivers, 16), lakes: pool(s.names.lakes, 10), places: pool(s.names.places, 60) };
    if (nm.rivers.length || nm.lakes.length || nm.places.length) out.names = nm;
  }
  if (HAMLETS[s.hamlets]) out.hamlets = s.hamlets;
  const ch = normalizeCharacter(s.character);
  if (ch.length) out.character = ch.map((c, i) => ({ id: "C" + (i + 1), ...c }));
  out.wind_from = ["E", "W", "N", "S"].includes(s.wind_from) ? s.wind_from : "W";
  out.mountains = (Array.isArray(s.mountains) ? s.mountains : []).slice(0, 8).map((m, i) => {
    const o = { id: "M" + (i + 1), name: String(m.name || L("无名山脉", "Nameless Range")).slice(0, 20),
      region: REGIONS.includes(m.region) ? m.region : "N",
      orientation: m.orientation === "NS" ? "NS" : "EW" };
    // angle (degrees, 0 = runs east-west, 90 = north-south) and length are optional refinements of orientation
    if (m.angle != null && m.angle !== "" && Number.isFinite(+m.angle)) { o.angle = ((Math.round(+m.angle) % 180) + 180) % 180; o.orientation = o.angle > 45 && o.angle < 135 ? "NS" : "EW"; }
    if (RIDGE_LEN[m.length]) o.length = m.length;
    if (m.invented) o.invented = true;
    return o;
  });
  out.min_major_rivers = clampInt(s.min_major_rivers, 0, 6, 1);
  out.min_lakes = clampInt(s.min_lakes, 0, 4, 0);
  const REQ = Object.keys(REQ_ZH);
  out.settlements = (Array.isArray(s.settlements) ? s.settlements : []).slice(0, 20).map((t, i) => {
    const type = TYPE_ZH[t.type] ? t.type : "town";
    let req = (Array.isArray(t.requires) ? t.requires : []).filter(r => REQ.includes(r));
    if (type === "port" && !req.includes("coast")) req.unshift("coast");
    if (req.includes("river_mouth") && !req.includes("coast")) req.unshift("coast");
    // an invented settlement (the planner filled it in, the author never wrote it) owns nothing explicit:
    // every requirement it carries is a proposal, so a conflict gives it up before anything the author said
    const prop = t.invented ? req.slice() : (Array.isArray(t.proposed) ? t.proposed : []).filter(q => req.includes(q));
    const o = { id: "S" + (i + 1), name: String(t.name || (L("聚落", "Settlement ") + (i + 1))).slice(0, 20), type, region: REGIONS.includes(t.region) ? t.region : null, requires: [...new Set(req)], proposed: [...new Set(prop)], rationale: String(t.rationale || "").slice(0, 120) };
    if (t.invented) o.invented = true;
    return o;
  });
  const ids = new Set(out.settlements.map(q => q.id));
  out.relations = (Array.isArray(s.relations) ? s.relations : []).slice(0, 10)
    .filter(rl => rl && REL_ZH[rl.type] && ids.has(rl.a) && ids.has(rl.b) && rl.a !== rl.b)
    .map((rl, i) => ({ id: "L" + (i + 1), type: rl.type, a: rl.a, b: rl.b, days: clamp(+rl.days || 5, 0.5, 40), source: rl.source === "proposed" ? "proposed" : "explicit", rationale: String(rl.rationale || "").slice(0, 120) }));
  out.style = normalizeStyle(s.style);
  return out;
}
// Style profile: proposed by the intent layer, ignored by the structure layer, read by the city planner.
// Each era carries a layout signature, so naming an era is enough to change how a town is drawn. An explicit
// street_pattern / block_scale / building_height still wins — the era only fills in what the spec left out.
const ERA_DEFAULT = {
  medieval: { street_pattern: "organic",  block_scale: 1.0, building_height: 1.0 },   // tight organic lanes, low roofs
  modern:   { street_pattern: "grid",     block_scale: 1.2, building_height: 1.8 },   // surveyed blocks, mid-rise
  future:   { street_pattern: "radial",   block_scale: 1.5, building_height: 3.2 },   // few big superblocks, towers
  alien:    { street_pattern: "terraced", block_scale: 0.8, building_height: 2.2 },   // fine terraces following the ground
};
const STYLE_DEFAULT = { era: "medieval", ...ERA_DEFAULT.medieval, walls: "auto", landmarks: null };
function normalizeStyle(st) {
  if (!st || typeof st !== "object") st = {};
  const era = ["medieval", "modern", "future", "alien"].includes(st.era) ? st.era : "medieval";
  const d = ERA_DEFAULT[era];
  const o = { era, ...d, walls: "auto", landmarks: null };
  if (["organic", "grid", "radial", "ring", "terraced"].includes(st.street_pattern)) o.street_pattern = st.street_pattern;
  if (Number.isFinite(+st.block_scale)) o.block_scale = clamp(+st.block_scale, 0.5, 2);
  if (Number.isFinite(+st.building_height)) o.building_height = clamp(+st.building_height, 0.5, 4);
  if (["always", "never", "auto"].includes(st.walls)) o.walls = st.walls;
  if (Array.isArray(st.landmarks)) o.landmarks = st.landmarks.filter(k => typeof k === "string").slice(0, 16);
  return o;
}
function initParams(spec) {
  return {
    seed: spec.seed, sea: 0.40, hydro: "naive", climate: "noise", riverThr: 260,
    ridges: spec.mountains.map((m, k) => Object.assign({ mid: m.id, region: m.region, orientation: m.orientation, amp: 0.14, k },
      m.angle != null ? { angle: m.angle } : {}, m.length ? { length: m.length } : {})),
    basins: [], unsat: [], relaxed: [], pos: null,
  };
}

// ---------- landforms ----------
// A landform is a seeded recipe of primitives that shape where land and sea go. Each recipe draws its own sizes and
// positions from the seed, so two worlds with the same landform still differ. Land primitives (blob, side, fill) give a
// "sea distance" d measured in map widths, with the coastline at COAST_D: a small island and a continent fall to the
// sea over the same distance, so both get the gentle, buildable shore the original one-sided coast had.
// Sea primitives (sea, channel) push d up. Relief primitives (pit, peak, rift, lift) add to the elevation afterwards.
const COAST_D = 0.72;
const LANDFORMS = ["coast", "continent", "archipelago", "islands", "peninsula", "isthmus", "inland_sea", "fjords", "volcanic_island", "shattered", "lakeland", "highland", "plains", "basin", "bay", "two_coasts"];
const LANDFORM_ZH = { coast: "海岸", continent: "大陆", archipelago: "群岛", islands: "数座大岛", peninsula: "半岛", isthmus: "地峡", inland_sea: "内海", fjords: "峡湾海岸", volcanic_island: "火山岛", shattered: "破碎大陆", lakeland: "千湖内陆", highland: "高原裂谷", plains: "内陆平原", basin: "群山盆地", bay: "大海湾", two_coasts: "两面临海" };
// one sea side, two (a corner such as NE, or opposite sides NS / EW), sea all round, or none
const OCEAN_SIDES = ["E", "W", "N", "S", "NE", "NW", "SE", "SW", "NS", "EW", "all", "none"];
const LANDFORM_SIDE = { coast: "E", fjords: "W", peninsula: "S", continent: "all", archipelago: "all", islands: "all", isthmus: "all", inland_sea: "all", volcanic_island: "all", shattered: "all", lakeland: "none", highland: "none", plains: "none", basin: "none", bay: "E", two_coasts: "NE" };
const CLIMATE_T = { polar: -0.36, cold: -0.18, temperate: 0, warm: 0.16, hot: 0.32 };
const CLIMATE_W = { arid: [0.24, 0], dry: [0.55, 0], normal: [1, 0], humid: [1, 0.16] };
const RIDGE_LEN = { short: 0.6, medium: 1, long: 1.55 };
const HAMLETS = { none: 0, sparse: 14, normal: 30, dense: 55 };
// ---------- character: what the world is like as a whole ----------
// The planner states a few expectations about the whole map (mostly desert, many islands, few lakes...). Each names
// a measurable share and a level; the verifier measures it like any other check, and these checks outrank every
// site constraint: a repair round that breaks one is rolled back.
const CHAR_METRICS = {
  land_share: "陆地占全图", lake_share: "湖面占陆地", mountain_share: "山地占陆地", desert_share: "荒漠与盐碱滩占陆地",
  grass_share: "草原占陆地", forest_share: "森林占陆地", cold_share: "冰雪苔原占陆地", wetland_share: "沼泽占陆地", islands: "陆块数量",
};
const CHAR_LEVELS = { none: [0, 0.02], low: [0, 0.15], moderate: [0.1, 0.4], high: [0.35, 1], dominant: [0.55, 1] };
const CHAR_LEVEL_ZH = { none: "几乎没有", low: "少", moderate: "中等", high: "多", dominant: "占主导" };
const BIOME_GROUP = { desert: "desert_share", playa: "desert_share", grassland: "grass_share", steppe: "grass_share", savanna: "grass_share",
  forest: "forest_share", taiga: "forest_share", rainforest: "forest_share", jungle: "forest_share", tundra: "cold_share", ice: "cold_share", snow: "cold_share", marsh: "wetland_share" };
function mapStats(W) {
  if (W._stats) return W._stats;
  const o = { land_share: 0, lake_share: 0, mountain_share: 0, desert_share: 0, grass_share: 0, forest_share: 0, cold_share: 0, wetland_share: 0, islands: 0 };
  let land = 0;
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i]) continue; land++;
    if (W.hy.lake[i]) { o.lake_share++; continue; }
    if (W.h[i] - W.P.sea > MOUNTAIN_REL) o.mountain_share++;
    const g = BIOME_GROUP[W.biome[i]]; if (g) o[g]++;
  }
  for (const k of Object.keys(o)) if (k !== "land_share" && k !== "islands") o[k] = +(o[k] / Math.max(1, land)).toFixed(3);
  o.land_share = +(land / NN).toFixed(3);
  // landmasses of at least ~1600 km² at region scale (400 cells), counted by flood fill
  const seen = new Uint8Array(NN), q = new Int32Array(NN);
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i] || seen[i]) continue;
    let qt = 0, qh = 0; q[qt++] = i; seen[i] = 1;
    while (qh < qt) { const c = q[qh++], x = c % N; for (const nb of [x > 0 ? c - 1 : -1, x < N - 1 ? c + 1 : -1, c - N, c + N]) if (nb >= 0 && nb < NN && !seen[nb] && !W.ocean[nb]) { seen[nb] = 1; q[qt++] = nb; } }
    if (qt >= 400) o.islands++;
  }
  o.rivers = W.hy.rivers.length; o.lakes = W.hy.lakes.length;
  W._stats = o;
  return o;
}
function normalizeCharacter(list, source) {
  return (Array.isArray(list) ? list : []).filter(c => c && CHAR_METRICS[c.metric]).slice(0, 6).map(c => {
    const o = { metric: c.metric, why: String(c.why || "").slice(0, 120), source: c.source === "critic" || source === "critic" ? "critic" : "planner" };
    if (c.metric === "islands") { o.min = clampInt(c.min, 0, 40, 0); o.max = clampInt(c.max, o.min, 99, 99); }
    else o.level = CHAR_LEVELS[c.level] ? c.level : "moderate";
    return o;
  });
}
function charLabel(c) {
  if (c.metric === "islands") return `${CHAR_METRICS.islands}${L("：", ": ")}${c.max >= 99 ? `≥ ${c.min}` : `${c.min}–${c.max}`}`;
  return `${CHAR_METRICS[c.metric]}${L("：", ": ")}${CHAR_LEVEL_ZH[c.level]}`;
}
// Character checks pass with some slack around the stated range. They describe how a world reads, and nobody can tell
// 15% tundra from 18% at a glance; a hard line would roll back repair rounds over a difference no reader sees and teach
// the model to treat the levels as exact targets. Shares get 5 points either way ("none" 2); a landmass count gets
// room above for the islets every island coast throws off, and a little below once it asks for many.
const CHAR_TOL = 0.05;
function charBounds(c) {
  if (c.metric === "islands") return [c.min - Math.floor(c.min * 0.2), c.max >= 99 ? Infinity : c.max + Math.max(3, Math.ceil(c.max * 0.5))];
  const [lo, hi] = CHAR_LEVELS[c.level], t = c.level === "none" ? 0.02 : CHAR_TOL;
  return [lo > 0 ? lo - t : 0, hi < 1 ? hi + t : 1];
}
function charCheck(W, c) {
  const v = mapStats(W)[c.metric], [blo, bhi] = charBounds(c);
  const strict = c.metric === "islands" ? v >= c.min && v <= c.max : v >= CHAR_LEVELS[c.level][0] && v <= CHAR_LEVELS[c.level][1];
  const pass = v >= blo && v <= bhi, slack = pass && !strict ? L("，在容差内", ", within tolerance") : "";
  // dev: how far outside the tolerated band, in percentage points (a landmass counts 5); margin: how far inside it
  const k = c.metric === "islands" ? 5 : 100, dev = pass ? 0 : +(k * (v < blo ? blo - v : v - bhi)).toFixed(1);
  const margin = !pass ? 0 : +(k * Math.min(blo > 0 ? v - blo : Infinity, bhi < (c.metric === "islands" ? Infinity : 1) ? bhi - v : Infinity)).toFixed(1);
  if (c.metric === "islands") { const want = c.max >= 99 ? "≥ " + c.min : c.min + "–" + c.max; return { pass, dev, margin, measured: L(`实测 ${v} 块（预期 ${want}${slack}）`, `measured ${v} (expected ${want}${slack})`) }; }
  const [lo, hi] = CHAR_LEVELS[c.level];
  const pct = x => `${Math.round(x * 100)}%`;
  const want = lo > 0 && hi >= 1 ? `≥ ${pct(lo)}` : lo > 0 ? `${pct(lo)}–${pct(hi)}` : `≤ ${pct(hi)}`;
  return { pass, dev, margin, measured: L(`实测 ${pct(v)}（预期 ${want}${slack}）`, `measured ${pct(v)} (expected ${want}${slack})`) };
}

// evaporation per lake cell under a climate_zone, relative to inflow (acc); LAKE_K scales inflow to lake cells
const EVAP_W = { arid: 4, dry: 1.6, normal: 0.55, humid: 0.3 }, EVAP_T = { polar: 0.4, cold: 0.6, temperate: 1, warm: 1.4, hot: 1.9 }, LAKE_K = 0.35;

function landformRecipe(spec, seed) {
  const r = rng(seed * 31 + 4242), R = (a, b) => a + r() * (b - a), I = (a, b) => Math.floor(R(a, b + 1));
  const sides = OCEAN_SIDES.includes(spec.ocean_side) && spec.ocean_side.length <= 2 ? spec.ocean_side.split("") : [];
  const side = sides.length ? sides[0] : ["E", "W", "N", "S"][I(0, 3)];
  const L = [], S = [], Z = [];          // land, sea, relief
  const blob = (x, y, rx, ry, a = R(0, Math.PI)) => L.push({ t: "blob", x, y, rx, ry, a });
  const sea = (x, y, rx, ry, a = R(0, Math.PI)) => S.push({ t: "sea", x, y, rx, ry, a });
  const chan = (x1, y1, x2, y2, w, dep = 0.08) => S.push({ t: "chan", x1, y1, x2, y2, w, dep });
  // a channel that bends and narrows towards its far end, built from short straight pieces
  const wiggle = (x1, y1, x2, y2, w0, w1, n = 4, j = 0.08, dep = 0.08) => {
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, px = -dy / l, py = dx / l;
    let ax = x1, ay = y1;
    for (let k = 1; k <= n; k++) {
      const t = k / n, o = k < n ? R(-j, j) * l : 0, bx = x1 + dx * t + px * o, by = y1 + dy * t + py * o;
      chan(ax, ay, bx, by, w0 + (w1 - w0) * (k - 0.5) / n, dep); ax = bx; ay = by;
    }
  };
  // a point on the edge facing the sea, and the inward normal
  const edgeOf = (sd, t) => sd === "E" ? [1, t, -1, 0] : sd === "W" ? [0, t, 1, 0] : sd === "N" ? [t, 0, 0, 1] : [t, 1, 0, -1];
  const edge = (t) => edgeOf(side, t);
  const ring = (cx, cy, rad, n, rmin, rmax) => { const a0 = R(0, 6.3); for (let k = 0; k < n; k++) { const a = a0 + k / n * 6.28 + R(-0.3, 0.3), d = rad * R(0.85, 1.15); blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R(rmin, rmax), R(rmin, rmax)); } };
  switch (spec.landform) {
    case "coast": {
      L.push({ t: "side", side });
      for (let k = I(2, 3); k--;) { const [ex, ey, nx, ny] = edge(R(0.15, 0.85)), dep = R(0.12, 0.22); sea(ex + nx * dep, ey + ny * dep, R(0.05, 0.1), R(0.05, 0.1)); }
      for (let k = I(1, 3); k--;) { const [ex, ey, nx, ny] = edge(R(0.1, 0.9)), off = R(0.06, 0.12); blob(ex + nx * off, ey + ny * off, R(0.025, 0.06), R(0.025, 0.06)); }
      if (r() < 0.7) { const [ex, ey, nx, ny] = edge(R(0.25, 0.75)); blob(ex + nx * 0.2, ey + ny * 0.2, Math.abs(nx) * 0.13 + 0.04, Math.abs(ny) * 0.13 + 0.04, 0); }
      break;
    }
    case "continent": {
      const cx = R(0.45, 0.55), cy = R(0.45, 0.55);
      blob(cx, cy, R(0.31, 0.36), R(0.27, 0.32));
      ring(cx, cy, 0.31, I(3, 5), 0.06, 0.12);
      for (let k = I(1, 3); k--;) { const a = R(0, 6.3); sea(cx + Math.cos(a) * 0.33, cy + Math.sin(a) * 0.3, R(0.06, 0.11), R(0.06, 0.11)); }
      for (let k = I(2, 4); k--;) { const a = R(0, 6.3); blob(cx + Math.cos(a) * 0.43, cy + Math.sin(a) * 0.41, R(0.02, 0.05), R(0.02, 0.05)); }
      break;
    }
    case "archipelago": {
      const pts = [];
      const want = I(8, 12);
      for (let t = 0; t < 600 && pts.length < want; t++) {
        const x = R(0.12, 0.88), y = R(0.12, 0.88), rad = pts.length < 3 ? R(0.09, 0.14) : R(0.035, 0.085);
        if (pts.some(p => Math.hypot(p[0] - x, p[1] - y) < (p[2] + rad) * 1.25 + 0.03)) continue;
        pts.push([x, y, rad]); blob(x, y, rad, rad * R(0.55, 1));
      }
      break;
    }
    case "islands": {
      // two or three big islands round the centre, each small enough to leave a sea gap to its neighbours, and a deep
      // strait between every pair: the coordinate warp and the smooth union of blobs would otherwise fuse them
      const n = I(2, 3), a0 = R(0, 6.3), rho = R(0.25, 0.29);
      const rmax = (2 * rho * Math.sin(Math.PI / n) - 0.1) / 2, cs = [];
      for (let k = 0; k < n; k++) {
        const a = a0 + k / n * 6.28, rx = Math.min(R(0.16, 0.21), rmax);
        cs.push([0.5 + Math.cos(a) * rho, 0.5 + Math.sin(a) * rho]); blob(cs[k][0], cs[k][1], rx, rx * R(0.7, 0.9));
      }
      for (let k = I(3, 6); k--;) blob(R(0.12, 0.88), R(0.12, 0.88), R(0.015, 0.04), R(0.015, 0.04));
      if (n === 2) { const px = -(cs[1][1] - cs[0][1]) / (2 * rho), py = (cs[1][0] - cs[0][0]) / (2 * rho); chan(0.5 - px * 0.6, 0.5 - py * 0.6, 0.5 + px * 0.6, 0.5 + py * 0.6, 0.03, 0.2); }
      // with three, each strait runs from the centre out between its pair, away from the third island
      else for (let k = 0; k < 3; k++) { const m = [(cs[k][0] + cs[(k + 1) % 3][0]) / 2, (cs[k][1] + cs[(k + 1) % 3][1]) / 2], l = Math.hypot(m[0] - 0.5, m[1] - 0.5); chan(0.5, 0.5, 0.5 + (m[0] - 0.5) / l * 0.6, 0.5 + (m[1] - 0.5) / l * 0.6, 0.03, 0.2); }
      break;
    }
    case "peninsula": {
      const [ex, ey, nx, ny] = edge(R(0.35, 0.65));
      L.push({ t: "side", side: { E: "W", W: "E", N: "S", S: "N" }[side], reach: R(0.18, 0.28) });   // mainland along the far edge
      const len = R(0.5, 0.62), wid = R(0.09, 0.13), ang = Math.atan2(ny, nx);
      // spine runs from the far edge out into the sea
      const fx = ex + nx * 1, fy = ey + ny * 1;
      for (let k = 0; k < 4; k++) { const t = 0.2 + k * len / 4; blob(fx - nx * t, fy - ny * t, 0.16, wid * R(0.8, 1.2) * (1 - k * 0.12), ang); }
      for (let k = I(2, 4); k--;) blob(R(0.15, 0.85), R(0.15, 0.85), R(0.02, 0.05), R(0.02, 0.05));
      break;
    }
    case "isthmus": {
      const a = R(0, 6.3), dx = Math.cos(a), dy = Math.sin(a);
      blob(0.5 - dx * 0.29, 0.5 - dy * 0.29, R(0.19, 0.23), R(0.17, 0.21));
      blob(0.5 + dx * 0.29, 0.5 + dy * 0.29, R(0.19, 0.23), R(0.17, 0.21));
      blob(0.5, 0.5, 0.2, R(0.022, 0.03), a);
      break;
    }
    case "inland_sea": {
      L.push({ t: "fill", d: 0.35 });
      const cx = R(0.42, 0.58), cy = R(0.42, 0.58);
      sea(cx, cy, R(0.2, 0.27), R(0.12, 0.18));
      // the strait runs on past the map edge (the coordinates are warped by up to ~0.09, so one that stopped at the
      // edge could end short of it) and is cut deep enough that terrain noise cannot dam it; otherwise the sea is left
      // cut off as a dry hollow below sea level
      const [ex, ey, nx, ny] = edge(R(0.3, 0.7)); chan(cx, cy, ex - nx * 0.15, ey - ny * 0.15, R(0.03, 0.045), 0.2);
      for (let k = I(1, 3); k--;) blob(cx + R(-0.12, 0.12), cy + R(-0.06, 0.06), R(0.02, 0.05), R(0.02, 0.04));
      break;
    }
    case "fjords": {
      L.push({ t: "side", side });
      for (let k = I(6, 10); k--;) {
        const [ex, ey, nx, ny] = edge(R(0.06, 0.94)), len = R(0.18, 0.34), bend = R(-0.12, 0.12);
        const x0 = ex + nx * 0.12, y0 = ey + ny * 0.12, x1 = x0 + nx * len + ny * bend, y1 = y0 + ny * len + nx * bend;
        wiggle(x0, y0, x1, y1, R(0.02, 0.028), 0.008, 5, 0.12);
      }
      for (let k = I(5, 9); k--;) { const [ex, ey, nx, ny] = edge(R(0.05, 0.95)), off = R(0.08, 0.15); blob(ex + nx * off, ey + ny * off, R(0.01, 0.025), R(0.01, 0.025)); }
      break;
    }
    case "volcanic_island": {
      const cx = R(0.46, 0.54), cy = R(0.46, 0.54);
      blob(cx, cy, R(0.25, 0.3), R(0.23, 0.27));
      ring(cx, cy, R(0.38, 0.42), I(4, 8), 0.012, 0.03);
      Z.push({ t: "peak", x: cx + R(-0.04, 0.04), y: cy + R(-0.04, 0.04), r: 0.075, h: 0.26 });
      Z.push({ t: "pit", x: 0, y: 0, r: 0.016, h: 0.1, on: 0 });     // crater, placed on the peak below
      Z[1].x = Z[0].x; Z[1].y = Z[0].y;
      break;
    }
    case "shattered": {
      blob(0.5, 0.5, R(0.36, 0.4), R(0.33, 0.38));
      for (let k = I(4, 6); k--;) { const a = R(0, 3.14), c = [R(0.3, 0.7), R(0.3, 0.7)], l = R(0.3, 0.5), w = R(0.01, 0.02); wiggle(c[0] - Math.cos(a) * l, c[1] - Math.sin(a) * l, c[0] + Math.cos(a) * l, c[1] + Math.sin(a) * l, w, w, 6, 0.1); }
      for (let k = I(3, 6); k--;) blob(R(0.1, 0.9), R(0.1, 0.9), R(0.02, 0.05), R(0.02, 0.05));
      break;
    }
    case "lakeland": {
      L.push({ t: "fill", d: 0.2 });
      for (let k = I(6, 10); k--;) Z.push({ t: "pit", x: R(0.12, 0.88), y: R(0.12, 0.88), r: R(0.025, 0.06), h: R(0.07, 0.13) });
      break;
    }
    case "plains": {
      // as low as a landlocked map can sit without the edges dropping below sea level, so it stays warm, open and flat
      L.push({ t: "fill", d: 0.58 });
      for (let k = I(1, 3); k--;) Z.push({ t: "pit", x: R(0.2, 0.8), y: R(0.2, 0.8), r: R(0.05, 0.09), h: R(0.02, 0.04) });
      break;
    }
    case "basin": {
      // a lowland ringed by mountains that drains out through one gorge (Sichuan, Tarim, the Carpathian basin)
      L.push({ t: "fill", d: 0.5 });
      const cx = R(0.45, 0.55), cy = R(0.45, 0.55), rx = R(0.3, 0.36), ry = R(0.26, 0.32);
      const a = R(0, Math.PI), gap = R(-Math.PI, Math.PI);
      Z.push({ t: "ring", x: cx, y: cy, rx, ry, a, w: R(0.05, 0.07), h: R(0.17, 0.22), gap, gw: R(0.25, 0.4) });
      // a valley from the middle out through the gorge, so the floor drains instead of filling into one great lake
      const gx = Math.cos(gap) * rx * 1.5, gy = Math.sin(gap) * ry * 1.5;
      Z.push({ t: "rift", x1: cx, y1: cy, x2: cx + gx * Math.cos(a) - gy * Math.sin(a), y2: cy + gx * Math.sin(a) + gy * Math.cos(a), w: 0.06, h: 0.08 });
      break;
    }
    case "bay": {
      // a mainland coast with one large gulf reaching deep inland through a narrower mouth (Bohai, the Gulf of Bothnia)
      L.push({ t: "side", side });
      const [ex, ey, nx, ny] = edge(R(0.3, 0.7)), dep = R(0.42, 0.55), w = R(0.1, 0.15), bx = ex + nx * dep, by = ey + ny * dep;
      sea(bx, by, w * R(1.1, 1.6), w, Math.atan2(ny, nx) + Math.PI / 2 + R(-0.5, 0.5));     // the gulf, lying across the way in
      wiggle(bx, by, ex - nx * 0.1, ey - ny * 0.1, R(0.035, 0.055), R(0.05, 0.08), 3, 0.06, 0.2);   // and its mouth
      if (r() < 0.6) blob(bx + R(-0.05, 0.05), by + R(-0.05, 0.05), R(0.015, 0.03), R(0.015, 0.03));
      for (let k = I(1, 2); k--;) { const [ex2, ey2, nx2, ny2] = edge(R(0.1, 0.9)), d2 = R(0.12, 0.2); sea(ex2 + nx2 * d2, ey2 + ny2 * d2, R(0.04, 0.07), R(0.04, 0.07)); }
      break;
    }
    case "two_coasts": {
      // sea on two sides: a corner of land (NE, SW...) or a strip of land between two seas (NS, EW)
      const opp = { E: "W", W: "E", N: "S", S: "N" }, adj = { E: ["N", "S"], W: ["N", "S"], N: ["E", "W"], S: ["E", "W"] };
      const pair = sides.length === 2 ? sides : [side, r() < 0.65 ? adj[side][I(0, 1)] : opp[side]];
      const across = pair[1] === opp[pair[0]];       // a strip between two seas keeps less sea on each side
      L.push({ t: "sides", sides: pair.map(sd => ({ sd, off: across ? R(0.06, 0.14) : R(0.02, 0.1) })) });
      for (const sd of pair) {
        for (let k = I(1, 2); k--;) { const [ex, ey, nx, ny] = edgeOf(sd, R(0.2, 0.8)), dep = R(0.12, 0.2); sea(ex + nx * dep, ey + ny * dep, R(0.05, 0.09), R(0.05, 0.09)); }
        for (let k = I(0, 2); k--;) { const [ex, ey, nx, ny] = edgeOf(sd, R(0.1, 0.9)), off = R(0.06, 0.12); blob(ex + nx * off, ey + ny * off, R(0.025, 0.05), R(0.025, 0.05)); }
      }
      break;
    }
    case "highland": {
      L.push({ t: "fill", d: 0.0 });
      Z.push({ t: "lift", h: 0.035 });
      const a = R(0, 3.14), l = R(0.32, 0.42);
      Z.push({ t: "rift", x1: 0.5 - Math.cos(a) * l, y1: 0.5 - Math.sin(a) * l, x2: 0.5 + Math.cos(a) * l, y2: 0.5 + Math.sin(a) * l, w: R(0.035, 0.05), h: 0.12 });
      for (let k = I(2, 4); k--;) { const t = R(0.2, 0.8); Z.push({ t: "pit", x: 0.5 + Math.cos(a) * l * (2 * t - 1), y: 0.5 + Math.sin(a) * l * (2 * t - 1), r: R(0.025, 0.04), h: 0.08 }); }
      break;
    }
  }
  return { L, S, Z };
}
const segDist = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1e-9; const t = clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };
const ellDist = (p, u, v) => { const c = Math.cos(p.a), s = Math.sin(p.a), dx = u - p.x, dy = v - p.y; return Math.hypot((dx * c + dy * s) / p.rx, (-dx * s + dy * c) / p.ry); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
function seaDistance(rec, u, v) {
  let d = 1.6;
  for (const p of rec.L) {
    let e;
    if (p.t === "blob") e = COAST_D + (ellDist(p, u, v) - 1) * Math.min(p.rx, p.ry);
    else if (p.t === "fill") e = p.d;
    // land must be far from every listed sea: a smooth max of the one-sided distances rounds the corner
    else if (p.t === "sides") e = p.sides.reduce((m, q) => -smin(-m, -((q.sd === "E" ? u : q.sd === "W" ? 1 - u : q.sd === "N" ? 1 - v : v) - q.off), 0.06), -9);
    else { const t = p.side === "E" ? u : p.side === "W" ? 1 - u : p.side === "N" ? 1 - v : v; e = p.reach ? COAST_D + (1 - t) - p.reach : t; }
    d = smin(d, e, 0.03);
  }
  for (const p of rec.S) {
    const e = p.t === "sea" ? ellDist(p, u, v) : segDist(u, v, p.x1, p.y1, p.x2, p.y2) / p.w;
    if (e < 1) d = Math.max(d, COAST_D + (1 - e) * (p.t === "sea" ? Math.max(0.08, Math.min(p.rx, p.ry)) : p.dep));
  }
  return d;
}
function reliefAt(rec, u, v) {
  let z = 0;
  for (const p of rec.Z) {
    if (p.t === "lift") z += p.h;
    else if (p.t === "rift") { const e = segDist(u, v, p.x1, p.y1, p.x2, p.y2) / p.w; z -= p.h * Math.exp(-e * e); }
    else if (p.t === "ring") {
      // a mountain wall along an ellipse, nearly gone in a gorge at angle p.gap so the basin can drain
      const c = Math.cos(p.a), s = Math.sin(p.a), dx = u - p.x, dy = v - p.y, lx = (dx * c + dy * s) / p.rx, ly = (-dx * s + dy * c) / p.ry;
      const e = (Math.hypot(lx, ly) - 1) * Math.min(p.rx, p.ry) / p.w, da = Math.atan2(ly, lx) - p.gap, dg = Math.atan2(Math.sin(da), Math.cos(da)) / p.gw;
      z += p.h * Math.exp(-e * e) * (1 - 0.95 * Math.exp(-dg * dg));
    }
    else { const e = Math.hypot(u - p.x, v - p.y) / p.r; z += (p.t === "peak" ? 1 : -1) * p.h * Math.exp(-e * e); }
  }
  return z;
}

// ---------- terrain ----------
function landShape(side, u, v, n) {
  const w = n * 0.10;
  // land tilts down towards the sea so the main rivers drain into it
  switch (side) {
    case "E": return 0.02 + 0.16 * (1 - u) - 0.62 * smooth(0.70, 0.98, u + w);
    case "W": return 0.02 + 0.16 * u - 0.62 * smooth(0.70, 0.98, 1 - u + w);
    case "N": return 0.02 + 0.16 * v - 0.62 * smooth(0.70, 0.98, 1 - v + w);
    case "S": return 0.02 + 0.16 * (1 - v) - 0.62 * smooth(0.70, 0.98, v + w);
    case "all": { const d = Math.hypot(u - 0.5, v - 0.5) * 2; return 0.03 + 0.16 * (1 - d) - 0.62 * smooth(0.62, 0.98, d + w); }
    default: return 0.13;
  }
}
function applyRidge(h, r, nz, fq = 1) {
  const [cx, cy] = regionCenter(r.region), half = N / 3 * 0.66 * (RIDGE_LEN[r.length] || 1), sig = N * 0.024 / Math.sqrt(fq);
  const ew = r.orientation !== "NS", rot = r.angle != null, ca = Math.cos((r.angle || 0) * Math.PI / 180), sa = Math.sin((r.angle || 0) * Math.PI / 180);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const along = rot ? (x - cx) * ca + (y - cy) * sa : ew ? x - cx : y - cy, across = rot ? -(x - cx) * sa + (y - cy) * ca : ew ? y - cy : x - cx;
    if (Math.abs(along) > half * 1.35) continue;
    const wig = nz(along * 0.018 / SC + 11 * (r.k + 1), 7.7) * N * 0.045 + 0.4 * nz(along * 0.05 + 3 * r.k, 1.1) * sig;
    const d = across - wig;
    if (Math.abs(d) > sig * 4) continue;
    const taper = 1 - smooth(half * 0.75, half * 1.35, Math.abs(along));
    const g = Math.exp(-d * d / (2 * sig * sig));
    const peaks = 0.5 + 0.5 * Math.abs(nz(x * 0.045 + 3, y * 0.045 + 5)) * 2.2 + 0.25 * Math.abs(nz(x * 0.12 + 9, y * 0.12 + 1));
    // side spurs: a wider, ridged-noise shoulder so the range branches instead of forming a smooth wall
    const rg = 1 - Math.abs(nz(x * 0.028 + 17, y * 0.028 + 4)); const spur = Math.exp(-d * d / (2 * (sig * 2.6) ** 2)) * rg * rg * rg;
    h[y * N + x] += r.amp * taper * (g * Math.min(1.25, peaks) + 0.55 * spur);
  }
}
function applyBasin(h, b, sea) {
  if (b.cx == null) {
    const [cx, cy] = regionCenter(b.region); let best = -1, bs = -1e9;
    for (let y = Math.floor(cy - N / 6) + 24; y < cy + N / 6 - 24; y++) for (let x = Math.floor(cx - N / 6) + 24; x < cx + N / 6 - 24; x++) {
      const e = h[y * N + x]; if (e < sea + 0.08 || e > sea + MOUNTAIN_REL - 0.05) continue;
      const s = -Math.hypot(x - cx, y - cy) * 0.004 - Math.abs(e - sea - 0.16);
      if (s > bs) { bs = s; best = y * N + x; }
    }
    if (best < 0) best = Math.floor(cy) * N + Math.floor(cx);
    b.cx = best % N; b.cy = Math.floor(best / N);
  }
  const R = 22;
  for (let y = Math.max(0, b.cy - R * 2); y < Math.min(N, b.cy + R * 2); y++) for (let x = Math.max(0, b.cx - R * 2); x < Math.min(N, b.cx + R * 2); x++) {
    const d = Math.hypot(x - b.cx, y - b.cy); h[y * N + x] -= b.depth * Math.exp(-d * d / (2 * (R / 1.6) ** 2));
  }
}
function thermal(h, iters) {
  const T = 0.010, k = 0.25, delta = new Float32Array(NN);
  for (let it = 0; it < iters; it++) {
    delta.fill(0);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x; let md = 0, j = -1;
      for (const nb of [i - 1, i + 1, i - N, i + N]) { const d = h[i] - h[nb]; if (d > md) { md = d; j = nb; } }
      if (md > T) { const m = k * (md - T) / 2; delta[i] -= m; delta[j] += m; }
    }
    for (let i = 0; i < NN; i++) h[i] += delta[i];
  }
}
function boxBlurCore(src, r) {
  const t = new Float32Array(NN), o = new Float32Array(NN);
  for (let y = 0; y < N; y++) { let acc = 0, c = 0; for (let x = -r; x < N + r; x++) { const a = x + r, b = x - r - 1; if (a >= 0 && a < N) { acc += src[y * N + a]; c++; } if (b >= 0 && b < N) { acc -= src[y * N + b]; c--; } if (x >= 0 && x < N) t[y * N + x] = acc / c; } }
  for (let x = 0; x < N; x++) { let acc = 0, c = 0; for (let y = -r; y < N + r; y++) { const a = y + r, b = y - r - 1; if (a >= 0 && a < N) { acc += t[a * N + x]; c++; } if (b >= 0 && b < N) { acc -= t[b * N + x]; c--; } if (y >= 0 && y < N) o[y * N + x] = acc / c; } }
  return o;
}
// cut dendritic valleys along the drainage network (a cheap stand-in for fluvial erosion)
function carveValleys(h, sea) {
  const ocean = oceanMask(h, sea), surf = priorityFlood(h, ocean);
  const idx = []; for (let i = 0; i < NN; i++) if (!ocean[i]) idx.push(i);
  const order = Int32Array.from(idx); order.sort((a, b) => surf[b] - surf[a]);
  const acc = new Float32Array(NN).fill(1), down = new Int32Array(NN).fill(-1);
  for (const i of order) {
    const x = i % N, y = (i - x) / N; let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const nb = yy * N + xx, sl = (surf[i] - surf[nb]) / DD8[k]; if (sl > bs) { bs = sl; best = nb; } }
    down[i] = best; if (best >= 0) acc[best] += acc[i];
  }
  const carve = new Float32Array(NN);
  const L0 = Math.log(3 * SC * SC), L1 = Math.log(9000 * SC * SC);
  for (const i of order) { const t = smooth(L0, L1, Math.log(acc[i])); carve[i] = Math.sqrt(t); }
  const wide = boxBlurCore(carve, Math.round(3 * SC)), narrow = boxBlurCore(carve, 1);
  for (const i of order) {
    const rel = h[i] - sea;
    const depth = 0.028 + 0.05 * smooth(0.05, 0.35, rel);    // deeper gorges in the uplands
    h[i] -= depth * (0.45 * narrow[i] + 0.9 * wide[i]);
  }
}
function buildTerrain(spec, P) {
  const nz = makePerlin(P.seed), nz2 = makePerlin(P.seed * 7 + 13), nz3 = makePerlin(P.seed * 3 + 101);
  const h = new Float32Array(NN);
  const fq = (SCALES[spec.scale] || SCALES.region).fq;           // 1 at region scale: the expressions below reduce to the original ones
  // the repair agent can swap the landform (P.landform); otherwise the planner's choice stands
  const lf = P.landform !== undefined ? P.landform : spec.landform;
  const rec = lf ? landformRecipe(lf === spec.landform ? spec : { ...spec, landform: lf }, P.seed) : null;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const wx = u + 0.07 * nz2(u * 2 + 5.2, v * 2 + 1.3) + 0.015 * nz3(u * 9, v * 9), wy = v + 0.07 * nz2(u * 2 + 9.7, v * 2 + 3.1) + 0.015 * nz3(u * 9 + 50, v * 9 + 50);
    const base = fbm(nz, wx * 4.6 * fq, wy * 4.6 * fq, 7);
    // ridged multifractal hills where the base terrain is already high
    let rid = 0, amp = 0.5, f = 6.5 * fq;
    for (let o = 0; o < 4; o++) { const r = 1 - Math.abs(nz3(wx * f + o * 13, wy * f + o * 7)); rid += amp * r * r; amp *= 0.5; f *= 2.1; }
    const upl = smooth(0.0, 0.32, base + 0.1 * nz2(u * 3 + 60, v * 3));
    const coastN = nz2(u * 4 * fq + 20, v * 4 * fq + 20) + 0.45 * nz3(u * 12 * fq + 3, v * 12 * fq + 9) + 0.2 * nz3(u * 30 * fq + 7, v * 30 * fq + 1);
    let shape;
    if (!rec) shape = landShape(spec.ocean_side, u, v, coastN);
    else {
      // landforms read the warped coordinates, so their coastlines wander instead of tracing ellipses
      const d = seaDistance(rec, wx, wy);
      shape = 0.03 + 0.16 * (1 - Math.min(d, 1)) - 0.62 * smooth(0.62, 0.98, d + coastN * 0.035) + reliefAt(rec, wx, wy);
    }
    h[y * N + x] = 0.5 + 0.22 * base + 0.08 * upl * (rid - 0.45) + 0.05 * fbm(nz2, u * 1.3 + 40, v * 1.3 + 40, 2) + shape;
  }
  P.ridges.forEach(r => applyRidge(h, r, nz2, fq));
  carveValleys(h, P.sea);
  P.basins.forEach(b => applyBasin(h, b, P.sea));
  thermal(h, 3);
  return h;
}

// ---------- climate ----------
function oceanMask(h, sea) {
  const o = new Uint8Array(NN), q = new Int32Array(NN); let qt = 0, qh = 0;
  for (let i = 0; i < N; i++) for (const c of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (h[c] < sea && !o[c]) { o[c] = 1; q[qt++] = c; }
  while (qh < qt) {
    const c = q[qh++], x = c % N;
    const nbs = [x > 0 ? c - 1 : -1, x < N - 1 ? c + 1 : -1, c - N, c + N];
    for (const nb of nbs) if (nb >= 0 && nb < NN && !o[nb] && h[nb] < sea) { o[nb] = 1; q[qt++] = nb; }
  }
  return o;
}
function buildMoisture(spec, P, h, ocean) {
  const m = new Float32Array(NN);
  const nz = makePerlin(P.seed + 77);
  if (P.climate === "noise") {
    const fq = (SCALES[spec.scale] || SCALES.region).fq;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[y * N + x] = clamp(0.48 + 0.9 * fbm(nz, x / N * 2.6 * fq, y / N * 2.6 * fq, 4), 0.05, 0.95);
    return m;
  }
  const w = spec.wind_from;
  const lines = N, steps = N;
  for (let l = 0; l < lines; l++) {
    let vap = 1.0, prev = null;
    for (let s = 0; s < steps; s++) {
      let x, y;
      if (w === "W") { x = s; y = l; } else if (w === "E") { x = N - 1 - s; y = l; } else if (w === "N") { x = l; y = s; } else { x = l; y = N - 1 - s; }
      const i = y * N + x;
      if (ocean[i]) { vap = Math.min(1, vap + 0.06 / SC); m[i] = 0.6; prev = h[i]; continue; }
      const e = h[i], dh = prev == null ? 0 : Math.max(0, e - prev);
      const rain = Math.min(vap, vap * (0.010 / SC + dh * 7));
      vap = Math.min(1, vap - rain + 0.004 / SC);
      m[i] = rain * 34 * SC;
      prev = e;
    }
  }
  // blur along both axes to smooth streaks, add a little noise
  const t = new Float32Array(NN);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let d = -5; d <= 5; d++) { const xx = pass ? x : x + d, yy = pass ? y + d : y; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; s += m[yy * N + xx]; c++; }
      t[y * N + x] = s / c;
    }
    m.set(t);
  }
  // sea breeze: coasts stay humid even in the lee of a range
  const dO = distField(i => ocean[i]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; m[i] = clamp(m[i] + 0.32 * Math.exp(-dO[i] / (26 * SC)) + 0.12 * fbm(nz, x / N * 3, y / N * 3, 3), 0.03, 0.97); }
  return m;
}

// ---------- hydrology ----------
class Heap {
  constructor(cap) { this.i = new Int32Array(cap); this.k = new Float32Array(cap); this.n = 0; this.key = 0; }
  grow() { const i = new Int32Array(this.i.length * 2), k = new Float32Array(this.k.length * 2); i.set(this.i); k.set(this.k); this.i = i; this.k = k; }
  push(idx, key) { if (this.n >= this.i.length) this.grow(); let c = this.n++; while (c > 0) { const p = (c - 1) >> 1; if (this.k[p] <= key) break; this.i[c] = this.i[p]; this.k[c] = this.k[p]; c = p; } this.i[c] = idx; this.k[c] = key; }
  pop() {
    const top = this.i[0]; this.key = this.k[0]; const li = this.i[--this.n], lk = this.k[this.n]; let c = 0;
    while (true) { let ch = 2 * c + 1; if (ch >= this.n) break; if (ch + 1 < this.n && this.k[ch + 1] < this.k[ch]) ch++; if (this.k[ch] >= lk) break; this.i[c] = this.i[ch]; this.k[c] = this.k[ch]; c = ch; }
    this.i[c] = li; this.k[c] = lk; return top;
  }
}
const SHARED_HEAP = new Heap(1 << 20);
function nbrs8(i) {
  const x = i % N, y = (i - x) / N, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < N && yy < N) out.push(yy * N + xx);
  }
  return out;
}
const isBorder = i => { const x = i % N, y = (i - x) / N; return x === 0 || y === 0 || x === N - 1 || y === N - 1; };
function priorityFlood(h, ocean) {
  const surf = Float32Array.from(h), closed = new Uint8Array(NN), heap = SHARED_HEAP; heap.n = 0;
  for (let i = 0; i < NN; i++) if (ocean[i] || isBorder(i)) { closed[i] = 1; heap.push(i, surf[i]); }
  while (heap.n) {
    const c = heap.pop(), x = c % N, y = (c - x) / N, sc = surf[c];
    for (let k = 0; k < 8; k++) {
      const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const nb = yy * N + xx; if (closed[nb]) continue; closed[nb] = 1;
      if (surf[nb] <= sc + 1e-5) surf[nb] = sc + 1e-5;
      heap.push(nb, surf[nb]);
    }
  }
  return surf;
}
function buildHydro(P, h, moist, ocean, names, km = KM_PER_CELL, evap = 0) {
  const RN = names && names.rivers && names.rivers.length ? names.rivers : RIVER_NAMES, LN = names && names.lakes && names.lakes.length ? names.lakes : LAKE_NAMES;
  const surf = P.hydro === "filled" ? priorityFlood(h, ocean) : Float32Array.from(h);
  const down = new Int32Array(NN).fill(-1);
  const land = [];
  for (let i = 0; i < NN; i++) {
    if (ocean[i]) continue; land.push(i);
    let best = -1, bs = 0; const x = i % N, y = (i - x) / N;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const nb = yy * N + xx, s = (surf[i] - surf[nb]) / DD8[k]; if (s > bs) { bs = s; best = nb; }
    }
    down[i] = best >= 0 ? best : (isBorder(i) ? -1 : -2);
  }
  { // sort land cells by surface, highest first (packed float keys: much faster than a comparator sort)
    const keys = new Float64Array(land.length); for (let k = 0; k < land.length; k++) keys[k] = Math.floor(-surf[land[k]] * 1e7) * 1048576 + land[k];
    keys.sort(); for (let k = 0; k < land.length; k++) { const v = keys[k]; land[k] = v - Math.floor(v / 1048576) * 1048576; } }
  const acc = new Float32Array(NN);
  for (const i of land) acc[i] += 0.3 + moist[i];
  for (const i of land) { const d = down[i]; if (d >= 0 && !ocean[d]) acc[d] += acc[i]; }
  // lakes
  const lake = new Uint8Array(NN), lakes = [], playa = new Uint8Array(NN);
  if (P.hydro === "filled") {
    const cand = new Uint8Array(NN);
    for (const i of land) if (surf[i] - h[i] > LAKE_DEPTH) cand[i] = 1;
    const seen = new Uint8Array(NN);
    for (const i of land) {
      if (!cand[i] || seen[i]) continue;
      const comp = [i]; seen[i] = 1;
      for (let q = 0; q < comp.length; q++) { const c = comp[q], x = c % N, y = (c - x) / N; for (let k = 0; k < 8; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const nb = yy * N + xx; if (cand[nb] && !seen[nb]) { seen[nb] = 1; comp.push(nb); } } }
      let wet = comp;
      if (evap && comp.length >= LAKE_MIN) {
        // water balance (only under a climate_zone): a basin holds a lake only as wide as its inflow can keep wet
        // against evaporation; the water pools in the deepest cells and the rest dries to a salt flat
        let inflow = 0; for (const c of comp) inflow = Math.max(inflow, acc[c]);
        const keep = Math.floor(inflow * LAKE_K / evap);
        if (keep < comp.length) {
          const byDepth = comp.slice().sort((a, b) => h[a] - h[b]);
          wet = byDepth.slice(0, keep);
          for (let q = keep; q < byDepth.length; q++) playa[byDepth[q]] = 1;
        }
        if (wet.length < LAKE_MIN) { for (const c of wet) playa[c] = 1; wet = []; }
      }
      if (wet.length >= LAKE_MIN) {
        let sx = 0, sy = 0; for (const c of wet) { lake[c] = 1; sx += c % N; sy += Math.floor(c / N); }
        lakes.push({ cells: wet.length, cx: sx / wet.length, cy: sy / wet.length });
      }
    }
    lakes.sort((a, b) => b.cells - a.cells);
    lakes.forEach((l, k) => { l.id = "L" + (k + 1); l.name = LN[k % LN.length]; l.region = regionOf(l.cx, l.cy); });
  }
  const channel = new Uint8Array(NN), len = new Float32Array(NN);
  for (const i of land) if (acc[i] >= P.riverThr) channel[i] = 1;
  for (const i of land) {
    if (!channel[i]) continue; if (len[i] < 1) len[i] = 1;
    const d = down[i]; if (d >= 0 && channel[d]) len[d] = Math.max(len[d], len[i] + 1);
  }
  const mouths = [], sinks = [];
  for (const i of land) {
    if (!channel[i]) continue; const d = down[i];
    if (d === -2) sinks.push({ i, acc: acc[i] });
    else if (d === -1 || ocean[d]) mouths.push({ i, len: len[i], acc: acc[i], kind: d === -1 ? "edge" : "sea" });
  }
  sinks.sort((a, b) => b.acc - a.acc);
  mouths.sort((a, b) => b.acc - a.acc);
  const sys = new Int32Array(NN).fill(-1);
  const mouthIdx = new Map(); mouths.forEach((m, k) => mouthIdx.set(m.i, k));
  for (let k = land.length - 1; k >= 0; k--) {
    const i = land[k]; if (!channel[i]) continue;
    if (mouthIdx.has(i)) { sys[i] = mouthIdx.get(i); continue; }
    const d = down[i]; if (d >= 0 && channel[d]) sys[i] = sys[d];
  }
  const rivers = []; const riverOfSys = new Map();
  mouths.forEach((m, k) => {
    if (m.len < MAJOR_LEN) return;
    const r = { id: "R" + (rivers.length + 1), name: RN[rivers.length % RN.length], mouth: m.i, kind: m.kind, lengthKm: Math.round(m.len * km * 1.2), mouthRegion: regionOf(m.i % N, Math.floor(m.i / N)) };
    rivers.push(r); riverOfSys.set(k, r);
  });
  // regions each river passes
  const regs = new Map();
  for (const i of land) if (channel[i] && sys[i] >= 0 && riverOfSys.has(sys[i]) && !lake[i]) {
    const r = riverOfSys.get(sys[i]); if (!regs.has(r.id)) regs.set(r.id, new Set()); regs.get(r.id).add(regionOf(i % N, Math.floor(i / N)));
  }
  rivers.forEach(r => r.regions = [...(regs.get(r.id) || [])]);
  return { surf, down, acc, lake, lakes, playa, channel, sys, mouths, sinks, rivers, riverOfSys, land };
}

// ---------- distance fields ----------
function distField(mask) {
  const d = new Float32Array(NN), INF = 1e9, D = 1.4142;
  for (let i = 0; i < NN; i++) d[i] = mask(i) ? 0 : INF;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x; let v = d[i];
      if (v === 0) continue;
      if (x > 0) { const t = d[i - 1] + 1; if (t < v) v = t; }
      if (y > 0) {
        let t = d[i - N] + 1; if (t < v) v = t;
        if (x > 0) { t = d[i - N - 1] + D; if (t < v) v = t; }
        if (x < N - 1) { t = d[i - N + 1] + D; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    const row = y * N;
    for (let x = N - 1; x >= 0; x--) {
      const i = row + x; let v = d[i];
      if (v === 0) continue;
      if (x < N - 1) { const t = d[i + 1] + 1; if (t < v) v = t; }
      if (y < N - 1) {
        let t = d[i + N] + 1; if (t < v) v = t;
        if (x < N - 1) { t = d[i + N + 1] + D; if (t < v) v = t; }
        if (x > 0) { t = d[i + N - 1] + D; if (t < v) v = t; }
      }
      d[i] = v;
    }
  }
  return d;
}

// ---------- biomes ----------
function biomeOf(e, sea, m, v) {
  const rel = e - sea;
  const temp = 0.40 + 0.40 * v - rel * 1.1;
  if (rel > MOUNTAIN_REL + 0.06) return temp < 0.12 ? "snow" : "rock";
  if (temp < 0.10) return "tundra";
  if (temp < 0.22) return m > 0.40 ? "taiga" : "tundra";
  if (m < 0.16) return "desert";
  if (m < 0.30) return "steppe";
  if (m < 0.46) return "grassland";
  if (rel < 0.08 && m > 0.62) return "marsh";
  if (m < 0.68) return "forest";
  return "rainforest";
}

// the same bands shifted by a climate zone, with the hot and frozen biomes that a temperate world never reaches
function biomeZoned(e, sea, m, v, dt) {
  const rel = e - sea;
  const temp = 0.40 + 0.40 * v - rel * 1.1 + dt;
  if (rel > MOUNTAIN_REL + 0.06) return temp < 0.12 ? "snow" : "rock";
  if (temp < -0.02) return "ice";
  if (temp < 0.10) return "tundra";
  if (temp < 0.22) return m > 0.40 ? "taiga" : "tundra";
  if (m < 0.16) return "desert";
  if (temp > 0.72) {
    if (m < 0.34) return "savanna";
    if (rel < 0.08 && m > 0.62) return "marsh";
    if (m < 0.5) return "grassland";
    return "jungle";
  }
  if (m < 0.30) return "steppe";
  if (m < 0.46) return "grassland";
  if (rel < 0.08 && m > 0.62) return "marsh";
  if (m < 0.68) return "forest";
  return "rainforest";
}

// ---------- geography: how a site relates to the rest of the region ----------
// Cell-level fields (cheap, used by placement predicates) and settlement-level measures
// (richer, computed on the road graph and used for facts and explanations).
function geoFields(W) {
  if (W._geo) return W._geo;
  const { h, P } = W;
  const perm = new Float32Array(NN);            // terrain permeability: how easily traffic crosses this cell
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i] || W.hy.lake[i]) { perm[i] = 0; continue; }
    const rel = h[i] - P.sea;
    perm[i] = clamp(1 - slopeAt(W, i) / (SLOPE_MAX * 2.5), 0, 1) * (rel > MOUNTAIN_REL ? 0.25 : 1);
  }
  const access = boxBlurCore(perm, Math.round(8 * SC));     // a corridor is permeable over a whole neighbourhood
  const hBlur = boxBlurCore(h, Math.round(9 * SC));
  const permBlur = boxBlurCore(perm, Math.round(4 * SC));
  const def = new Float32Array(NN);             // defensibility: locally high ground, or a choke point
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i] || W.hy.lake[i]) continue;
    const command = clamp((h[i] - hBlur[i]) / 0.06, 0, 1);            // stands above its surroundings
    const choke = clamp((0.55 - permBlur[i]) / 0.45, 0, 1) * clamp(perm[i] / 0.5, 0, 1); // passable spot in hard country
    def[i] = clamp(0.65 * command + 0.5 * choke, 0, 1);
  }
  W._geo = { perm, access, def };
  return W._geo;
}
// how much land a site can reach within a day's travel, in cells
function hinterland(W, sid, days = 1.5) {
  travelDays(W, sid, sid);
  const dist = W.travel.get(sid), budget = days * KM_PER_DAY / kmOf(W);
  let n = 0; for (let i = 0; i < NN; i++) if (dist[i] <= budget) n++;
  return n;
}
// betweenness on the road graph: how much through-traffic a settlement carries
function roadCentrality(W) {
  if (W._cent) return W._cent;
  const S = W.spec.settlements, idx = {}; S.forEach((s, k) => idx[s.id] = k);
  const n = S.length, INF = 1e9;
  const d = Array.from({ length: n }, () => new Float64Array(n).fill(INF));
  const via = Array.from({ length: n }, () => new Int32Array(n).fill(-1));
  for (let k = 0; k < n; k++) d[k][k] = 0;
  for (const rd of buildRoads(W)) {
    const a = idx[rd.a], b = idx[rd.b]; if (a == null || b == null) continue;
    let len = 0; for (let k = 1; k < rd.pts.length; k++) len += Math.hypot(rd.pts[k][0] - rd.pts[k - 1][0], rd.pts[k][1] - rd.pts[k - 1][1]);
    if (len < d[a][b]) { d[a][b] = d[b][a] = len; via[a][b] = via[b][a] = -1; }
  }
  for (let m = 0; m < n; m++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++)
    if (d[a][m] + d[m][b] < d[a][b]) { d[a][b] = d[a][m] + d[m][b]; via[a][b] = m; }
  const cnt = new Float64Array(n);
  const walk = (a, b) => { const m = via[a][b]; if (m < 0) return; cnt[m]++; walk(a, m); walk(m, b); };
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (d[a][b] < INF) walk(a, b);
  const pairs = Math.max(1, n * (n - 1) / 2);
  W._cent = Object.fromEntries(S.map((s, k) => [s.id, +(cnt[k] / pairs).toFixed(3)]));
  return W._cent;
}
// does water flowing past a upstream reach b? (a controls b's water)
function dominatesDownstream(W, a, b) { return upstreamOf(W, a, b); }
function geoProfile(W, sid) {
  const g = geoFields(W), i = posIdx(W, sid);
  const ports = W.spec.settlements.filter(s => s.type === "port" && s.id !== sid);
  let portDays = null;
  for (const p of ports) { const d = travelDays(W, sid, p.id); if (d != null && (portDays == null || d < portDays)) portDays = d; }
  return {
    accessibility: +g.access[i].toFixed(2),
    defensibility: +g.def[i].toFixed(2),
    road_centrality: roadCentrality(W)[sid] ?? 0,
    hinterland_cells: hinterland(W, sid),
    days_to_nearest_port: portDays,
  };
}

// ---------- derive a whole world ----------
function derive(spec, P) {
  P = deep(P);
  const h = buildTerrain(spec, P);
  const ocean = oceanMask(h, P.sea);
  const moist = buildMoisture(spec, P, h, ocean);
  const cz = P.cz !== undefined ? P.cz : spec.climate_zone;        // P.cz: climate set by the repair agent (null = temperate)
  if (cz) { const [mul, add] = CLIMATE_W[cz.humidity]; for (let i = 0; i < NN; i++) moist[i] = clamp(moist[i] * mul + add, 0.02, 0.98); }
  const hy = buildHydro(P, h, moist, ocean, spec.names, (SCALES[spec.scale] || SCALES.region).km, cz ? EVAP_W[cz.humidity] * EVAP_T[cz.temperature] : 0);
  const biome = new Array(NN);
  const dt = cz ? CLIMATE_T[cz.temperature] : null;
  // riparian green: in a dry climate the banks of rivers and lakes stay wet enough for grass and trees — the oases
  // and river-valley belts of a desert. Only under a dry climate_zone, so temperate worlds derive as before.
  let bm = moist;
  if (cz && (cz.humidity === "arid" || cz.humidity === "dry")) {
    const dR = distField(i => hy.channel[i] && !hy.lake[i] && hy.acc[i] >= P.riverThr * 2), dL = distField(i => hy.lake[i]);
    bm = new Float32Array(NN);
    for (let i = 0; i < NN; i++) bm[i] = clamp(moist[i] + 0.5 * Math.exp(-dR[i] / (1.1 * SC)) + 0.6 * Math.exp(-dL[i] / (2.2 * SC)), 0, 0.95);
  }
  for (let i = 0; i < NN; i++) biome[i] = ocean[i] ? "ocean" : hy.lake[i] ? "lake" : hy.playa[i] ? "playa" : dt == null ? biomeOf(h[i], P.sea, moist[i], Math.floor(i / N) / N) : biomeZoned(h[i], P.sea, bm[i], Math.floor(i / N) / N, dt);
  const riverCell = i => hy.channel[i] && !hy.lake[i];
  const seaMouths = new Uint8Array(NN); hy.rivers.forEach(r => { if (r.kind === "sea") seaMouths[r.mouth] = 1; });
  const W = {
    spec, P, h, ocean, moist, hy, biome,
    dOcean: distField(i => ocean[i]),
    dRiver: distField(riverCell),
    dLake: distField(i => hy.lake[i]),
    dMount: distField(i => !ocean[i] && h[i] - P.sea > MOUNTAIN_REL),
    dMouth: distField(i => seaMouths[i]),
    get access() { return geoFields(this).access; },
    get def() { return geoFields(this).def; },
    travel: new Map(),
  };
  if (!W.P.pos) placeInitial(W);
  return W;
}
const cellXY = i => [i % N, Math.floor(i / N)];
function slopeAt(W, i) {
  const x = i % N, h = W.h; let m = 0;
  for (const nb of [x > 0 ? i - 1 : i, x < N - 1 ? i + 1 : i, i >= N ? i - N : i, i < NN - N ? i + N : i]) m = Math.max(m, Math.abs(h[i] - h[nb]));
  return m;
}
const isDry = (W, i) => !W.ocean[i] && !W.hy.lake[i];
const REQ_TEST = {
  coast: (W, i) => W.dOcean[i] <= 1.5,
  river_mouth: (W, i) => W.dMouth[i] <= 4.5,
  on_river: (W, i) => W.dRiver[i] <= 1.5,
  lakeside: (W, i) => W.dLake[i] <= 2.5,
  near_mountain: (W, i) => W.dMount[i] <= 14 && W.h[i] - W.P.sea < MOUNTAIN_REL - 0.04,
  accessible: (W, i) => W.access[i] >= ACCESS_T,
  defensible: (W, i) => W.def[i] >= DEF_T,
};
function placeInitial(W) {
  const r = rng(W.P.seed + 999); W.P.pos = {};
  const taken = [];
  for (const s of W.spec.settlements) {
    let best = -1, bs = -1e9;
    const [cx, cy] = s.region ? regionCenter(s.region) : [N / 2, N / 2];
    const span = s.region ? N / 3 : N;
    for (let k = 0; k < 900; k++) {
      const x = Math.floor(cx - span / 2 + r() * span), y = Math.floor(cy - span / 2 + r() * span);
      if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
      const i = y * N + x; if (!isDry(W, i)) continue;
      if (taken.some(t => Math.hypot(t[0] - x, t[1] - y) < 28)) continue;
      const sc = -slopeAt(W, i) * 25 + (W.dRiver[i] < 3 ? 0.2 : 0) + r() * 0.6;
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) { let bd = 1e9; for (let i = 0; i < NN; i++) if (isDry(W, i)) { const [x, y] = cellXY(i), d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = i; } } }
    if (best < 0) best = Math.floor(cy) * N + Math.floor(cx);
    W.P.pos[s.id] = cellXY(best); taken.push(cellXY(best));
  }
}
const posIdx = (W, id) => { const p = W.P.pos[id]; return p[1] * N + p[0]; };

// ---------- background settlements ----------
// Hamlets fill the map between the settlements the spec names. They carry no requirements and are never verified:
// they exist so a map reads as inhabited country rather than a dozen dots. Placement prefers the sites people
// actually settle (river banks, coasts, lake shores, open farmland), and names come from the spec's pool when the
// planner supplied one, otherwise from a small generator.
const HAMLET_A = "青白石松柳桃杏梨枫桑槐竹苇芦荷泉溪沙岭坡岗峪塘河川野田禾麦稻栗枣榆杨梅兰金银铜铁赤黄乌红东西南北上下前后大小新旧高长清云雁鹤鹿";
const HAMLET_B = "村庄集寨屯铺坪湾口桥店坊营坳渡";
const NAME_EN_A = ["Ash", "Black", "Bright", "Cold", "Elm", "Fern", "Grey", "High", "Iron", "Long", "Mill", "Oak", "Red", "Salt", "Stone", "Thorn", "West", "White", "Wolf", "Raven", "Bram", "Lark", "Moss", "Pike", "Rook", "Sedge", "Tarn", "Willow", "Hollow", "Amber", "Copper", "Frost", "Heron", "Marsh", "Gold", "Silver"];
const NAME_EN_B = ["ford", "stead", "wick", "ton", "by", "holm", "mere", "dale", "bridge", "field", "well", "cross", "moor", "burn", "thorpe", "haven", "gate", "wood", "combe", "ley"];
function hamletName(r, used) {
  if (LANG === "en") {
    for (let t = 0; t < 50; t++) { const nm = NAME_EN_A[Math.floor(r() * NAME_EN_A.length)] + NAME_EN_B[Math.floor(r() * NAME_EN_B.length)]; if (!used.has(nm)) { used.add(nm); return nm; } }
    return "Nameless";
  }
  for (let t = 0; t < 50; t++) {
    const a = HAMLET_A[Math.floor(r() * HAMLET_A.length)], b = HAMLET_A[Math.floor(r() * HAMLET_A.length)], c = HAMLET_B[Math.floor(r() * HAMLET_B.length)];
    const nm = r() < 0.65 && a !== b ? a + b + c : a + c;
    if (!used.has(nm)) { used.add(nm); return nm; }
  }
  return L("无名村", "Nameless");
}
const HAMLET_BIOME = { grassland: 0.5, forest: 0.25, steppe: 0.3, savanna: 0.3, marsh: -0.2, rainforest: 0, jungle: -0.1, taiga: -0.1, desert: -0.7, tundra: -0.6, ice: -2, snow: -2, rock: -1 };
function hamlets(W) {
  if (W._hamlets) return W._hamlets;
  const want0 = HAMLETS[W.spec.hamlets] || 0, out = [];
  W._hamlets = out;
  if (!want0) return out;
  let land = 0; for (let i = 0; i < NN; i++) if (!W.ocean[i]) land++;
  const want = Math.round(want0 * clamp(land / NN / 0.6, 0.35, 1.3));
  const r = rng(W.P.seed + 7777), cand = [];
  for (let t = 0; t < 9000; t++) {
    const x = 3 + Math.floor(r() * (N - 6)), y = 3 + Math.floor(r() * (N - 6)), i = y * N + x;
    if (!isDry(W, i) || slopeAt(W, i) > SLOPE_MAX * 1.3 || W.h[i] - W.P.sea > MOUNTAIN_REL - 0.04) continue;
    const sc = (W.dRiver[i] <= 2 ? 1 : 0) + (W.dOcean[i] <= 2 ? 0.7 : 0) + (W.dLake[i] <= 3 ? 0.6 : 0) + (HAMLET_BIOME[W.biome[i]] ?? 0) + r() * 0.9;
    cand.push([sc, x, y]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  const towns = W.spec.settlements.map(s => W.P.pos[s.id]);
  const pool = ((W.spec.names && W.spec.names.places) || []).filter(n => !W.spec.settlements.some(s => s.name === n));
  const used = new Set(W.spec.settlements.map(s => s.name)), nr = rng(W.P.seed + 4321);
  const gap = 15 * Math.sqrt(30 / Math.max(want, 10));
  for (const [, x, y] of cand) {
    if (out.length >= want) break;
    if (towns.some(p => Math.hypot(p[0] - x, p[1] - y) < 22) || out.some(h => Math.hypot(h.x - x, h.y - y) < gap)) continue;
    const name = out.length < pool.length ? pool[out.length] : hamletName(nr, used);
    out.push({ id: "H" + (out.length + 1), name, x, y });
  }
  return out;
}

// ---------- claims (narrative ↔ map) ----------
function mountainMask(W, mid) {
  const m = W.spec.mountains.find(q => q.id === mid); if (!m) return null;
  const [cx, cy] = regionCenter(m.region), R = N / 3;
  return i => { const [x, y] = cellXY(i); return !W.ocean[i] && W.h[i] - W.P.sea > MOUNTAIN_REL && Math.abs(x - cx) < R && Math.abs(y - cy) < R; };
}
function riverAt(W, i) {
  const [x0, y0] = cellXY(i); let best = null, bd = 9;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const j = y * N + x; if (!W.hy.channel[j] || W.hy.lake[j]) continue;
    const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; }
  }
  if (best == null || bd > 2.1) return null;
  const r = W.hy.riverOfSys.get(W.hy.sys[best]);
  return { cell: best, river: r ? r.id : null };
}
function travelDays(W, aId, bId) {
  if (!W.travel.has(aId)) {
    const dist = new Float32Array(NN).fill(1e9), heap = SHARED_HEAP, s = posIdx(W, aId), h = W.h, lim = W.P.sea + MOUNTAIN_REL;
    heap.n = 0; dist[s] = 0; heap.push(s, 0);
    while (heap.n) {
      const c = heap.pop(), dc = heap.key; if (dc > dist[c]) continue;
      const x = c % N, y = (c - x) / N;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const nb = yy * N + xx; if (W.ocean[nb] || W.hy.lake[nb]) continue;
        const nd = dc + DD8[k] * (1 + 30 * Math.abs(h[nb] - h[c]) + (h[nb] > lim ? 0.6 : 0));
        if (nd < dist[nb]) { dist[nb] = nd; heap.push(nb, nd); }
      }
    }
    W.travel.set(aId, dist);
  }
  const d = W.travel.get(aId)[posIdx(W, bId)];
  return d >= 1e8 ? null : Math.round(d * kmOf(W) / KM_PER_DAY * 10) / 10;
}
// directions are stored in whichever language the claim was written in, so compare them by index
const DIRS8_ZH = ["东", "东南", "南", "西南", "西", "西北", "北", "东北"];
const dirIdx = d => { const k = DIRS8_ZH.indexOf(d); return k >= 0 ? k : NAMES_EN.DIRS8.indexOf(String(d).toLowerCase()); };
function dirOf(W, a, b) {
  const [ax, ay] = W.P.pos[a], [bx, by] = W.P.pos[b];
  const ang = Math.atan2(ay - by, ax - bx);
  return DIRS8[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}
function crossesMountain(W, a, b, mid) {
  const mask = mountainMask(W, mid); if (!mask) return false;
  const [ax, ay] = W.P.pos[a], [bx, by] = W.P.pos[b]; const n = Math.ceil(Math.hypot(ax - bx, ay - by)); let c = 0;
  for (let k = 0; k <= n; k++) { const x = Math.round(ax + (bx - ax) * k / n), y = Math.round(ay + (by - ay) * k / n); if (mask(y * N + x)) c++; }
  return c >= 2;
}
function upstreamOf(W, a, b) {
  const ra = riverAt(W, posIdx(W, a)); if (!ra) return false;
  const [bx, by] = W.P.pos[b]; let c = ra.cell;
  for (let k = 0; k < 3000 && c >= 0; k++) { const [x, y] = cellXY(c); if (k > 3 && Math.hypot(x - bx, y - by) <= 3) return true; c = W.hy.down[c]; if (c >= 0 && W.ocean[c]) break; }
  return false;
}
const nameOf = (W, id) => {
  const s = W.spec.settlements.find(q => q.id === id); if (s) return s.name;
  const m = W.spec.mountains.find(q => q.id === id); if (m) return m.name;
  const r = W.hy.rivers.find(q => q.id === id); if (r) return r.name;
  const l = W.hy.lakes.find(q => q.id === id); if (l) return l.name;
  return id;
};
function checkClaim(W, c) {
  const has = id => W.P.pos && W.P.pos[id];
  const N_ = id => nameOf(W, id);
  try {
    switch (c.type) {
      case "in_region": { if (!has(c.s)) break; const r = regionOf(...W.P.pos[c.s]); return { ok: r === c.region, label: L(`${N_(c.s)}位于${RG(c.region)}`, `${N_(c.s)} is in ${RG(c.region)}`), measured: L(`实际在${RG(r)}`, `actually in ${RG(r)}`) }; }
      case "coastal": { if (!has(c.s)) break; const ok = REQ_TEST.coast(W, posIdx(W, c.s)); return { ok, label: L(`${N_(c.s)}临海`, `${N_(c.s)} is on the coast`), measured: ok ? L("临海", "on the coast") : L(`距海 ${Math.round(W.dOcean[posIdx(W, c.s)] * kmOf(W))} km`, `${Math.round(W.dOcean[posIdx(W, c.s)] * kmOf(W))} km from the sea`) }; }
      case "on_river": {
        if (!has(c.s)) break; const r = riverAt(W, posIdx(W, c.s));
        const ok = !!r && (!c.river || r.river === c.river);
        return { ok, label: c.river ? L(`${N_(c.s)}在${N_(c.river)}畔`, `${N_(c.s)} stands on the ${N_(c.river)}`) : L(`${N_(c.s)}临河`, `${N_(c.s)} is on a river`), measured: r ? (r.river ? L(`旁边是${N_(r.river)}`, `next to the ${N_(r.river)}`) : L("旁边只有无名小河", "only a nameless stream nearby")) : L(`距最近河道 ${Math.round(W.dRiver[posIdx(W, c.s)] * kmOf(W))} km`, `${Math.round(W.dRiver[posIdx(W, c.s)] * kmOf(W))} km from the nearest river`) };
      }
      case "lakeside": { if (!has(c.s)) break; const ok = REQ_TEST.lakeside(W, posIdx(W, c.s)); return { ok, label: L(`${N_(c.s)}临湖`, `${N_(c.s)} is by a lake`), measured: ok ? L("临湖", "by a lake") : L("附近没有湖", "no lake nearby") }; }
      case "near_mountain": {
        if (!has(c.s)) break; const mask = c.mountain ? mountainMask(W, c.mountain) : null; const i = posIdx(W, c.s); let ok;
        if (mask) { const [x0, y0] = W.P.pos[c.s]; ok = false; for (let dy = -14; dy <= 14 && !ok; dy++) for (let dx = -14; dx <= 14; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= N || y >= N || dx * dx + dy * dy > 196) continue; if (mask(y * N + x)) { ok = true; break; } } }
        else ok = W.dMount[i] <= 14;
        return { ok, label: L(`${N_(c.s)}背靠${c.mountain ? N_(c.mountain) : "山脉"}`, `${N_(c.s)} lies under ${c.mountain ? N_(c.mountain) : "the mountains"}`), measured: ok ? L(`距山脉 ≤ ${14 * kmOf(W)} km`, `≤ ${14 * kmOf(W)} km from mountains`) : L(`距山脉 ${Math.round(W.dMount[i] * kmOf(W))} km`, `${Math.round(W.dMount[i] * kmOf(W))} km from mountains`) };
      }
      case "biome": { if (!has(c.s)) break; const b = W.biome[posIdx(W, c.s)]; return { ok: b === c.biome, label: L(`${N_(c.s)}周边是${BIOME_ZH[c.biome] || c.biome}`, `${N_(c.s)} is surrounded by ${BIOME_ZH[c.biome] || c.biome}`), measured: L(`实际为${BIOME_ZH[b]}`, `actually ${BIOME_ZH[b]}`) }; }
      case "direction": { if (!has(c.a) || !has(c.b)) break; const d = dirOf(W, c.a, c.b); return { ok: dirIdx(d) === dirIdx(c.dir), label: L(`${N_(c.a)}在${N_(c.b)}的${DIRS8[dirIdx(c.dir)] ?? c.dir}方`, `${N_(c.a)} lies ${DIRS8[dirIdx(c.dir)] ?? c.dir} of ${N_(c.b)}`), measured: L(`实际在${d}方`, `actually ${d}`) }; }
      case "travel_days": {
        if (!has(c.a) || !has(c.b)) break; const d = travelDays(W, c.a, c.b); const cl = +c.days;
        const ok = d != null && Math.abs(cl - d) <= Math.max(0.5, 0.15 * d);
        return { ok, label: L(`${N_(c.a)}到${N_(c.b)}约 ${cl} 天路程`, `${N_(c.a)} is about ${cl} days from ${N_(c.b)}`), measured: d == null ? L("陆路不可达", "unreachable overland") : L(`路径工具测得 ${d} 天`, `route tool measures ${d} days`) };
      }
      case "separated_by": { if (!has(c.a) || !has(c.b)) break; const ok = crossesMountain(W, c.a, c.b, c.mountain); return { ok, label: L(`${N_(c.a)}与${N_(c.b)}之间隔着${N_(c.mountain)}`, `${N_(c.mountain)} lies between ${N_(c.a)} and ${N_(c.b)}`), measured: ok ? L("连线穿过山脉", "the line between them crosses the range") : L("连线不经过该山脉", "the line between them misses the range") }; }
      case "upstream_of": { if (!has(c.a) || !has(c.b)) break; const ok = upstreamOf(W, c.a, c.b); return { ok, label: L(`${N_(c.a)}在${N_(c.b)}的上游`, `${N_(c.a)} is upstream of ${N_(c.b)}`), measured: ok ? L("顺流可达", "reachable downstream") : L("顺流到不了", "not reachable downstream") }; }
    }
  } catch (e) { /* fall through */ }
  return { ok: false, label: L(`无法核查的声明（${c.type}）`, `uncheckable claim (${c.type})`), measured: L("引用了不存在的实体或未知类型", "refers to an unknown entity or claim type") };
}

// ---------- conflict analysis (which constraints are jointly unsatisfiable) ----------
// A requirement is "reachable" if some cell could satisfy it after the terrain tools have done their best:
// carve_basin can make a lake anywhere on land, raise_ridge can make mountains, a lower river threshold
// extends the channel network, but nothing can put an ocean where the spec says there is none.
const REACHABLE = {
  coast: (W, i) => W.dOcean[i] <= 4,
  river_mouth: (W, i) => W.dOcean[i] <= 4,
  on_river: (W, i) => W.dRiver[i] <= 12 * SC,
  lakeside: () => true,
  near_mountain: () => true,                        // raise_ridge can put mountains next to a site
  accessible: (W, i) => W.access[i] >= ACCESS_SOFT, // no tool can carve a corridor through a massif
  defensible: () => true,
};
// The world's character outranks site constraints, so it also limits what the terrain tools may do for a site: when an
// expectation keeps lakes (or mountains) scarce, digging a lake (raising a ridge) for one town is off the table, and the
// requirement can only use what the map already has. A requirement that then has nowhere to go shows up in a minimal
// core like any other conflict, and goes to the negotiator.
const CHAR_CAPS = { lakeside: ["lake_share"], near_mountain: ["mountain_share"], defensible: ["mountain_share"] };
function charCap(W, q) {
  const ms = CHAR_CAPS[q]; if (!ms || !W.spec.character) return null;
  return W.spec.character.find(c => ms.includes(c.metric) && (c.level === "none" || c.level === "low") && !W.P.unsat.includes("char." + c.id)) || null;
}
const reachOf = (W, q) => charCap(W, q) ? REQ_TEST[q] : REACHABLE[q];
function feasibleCount(W, items, relaxed) {
  let n = 0, sample = -1;
  const region = items.find(t => t.startsWith("region:"));
  const masks = items.filter(t => t.startsWith("downstream:") || t.startsWith("near:")).map(t => {
    if (t.startsWith("downstream:")) { const o = t.slice(11); return W.P.pos[o] ? downstreamMask(W, o) : null; }
    const [o, d] = t.slice(5).split("@"); return W.P.pos[o] ? withinDaysMask(W, o, +d || 5) : null;
  }).filter(Boolean);
  const reqs = items.filter(t => !t.startsWith("region:") && !t.startsWith("downstream:") && !t.startsWith("near:"));
  const tests = reqs.map(q => relaxed ? reachOf(W, q) : REQ_TEST[q]);
  for (let i = 0; i < NN; i++) {
    if (!isDry(W, i)) continue;
    if (slopeAt(W, i) > SLOPE_MAX * (relaxed ? 1.2 : 0.8)) continue;
    if (region) { const [x, y] = cellXY(i); if (regionOf(x, y) !== region.slice(7)) continue; }
    let ok = true;
    for (let k = 0; k < reqs.length; k++) { const f = tests[k]; if (f && !f(W, i)) { ok = false; break; } }
    if (!ok) continue;
    if (masks.some(m => !m[i])) continue;
    n++; if (sample < 0) sample = i;
  }
  return { n, sample };
}
// deletion-based minimal unsatisfiable subset: feasibility is monotone, so dropping items can only help
function minimalCore(W, items) {
  if (feasibleCount(W, items, true).n > 0) return null;
  let core = items.slice();
  for (const t of items) {
    const without = core.filter(x => x !== t);
    if (without.length && feasibleCount(W, without, true).n === 0) core = without;
  }
  return core;
}
const ITEM_ZH = t => {
  if (t.startsWith("region:")) return L(`位于${RG(t.slice(7))}`, `in ${RG(t.slice(7))}`);
  if (t.startsWith("downstream:")) return L(`位于某地下游`, `downstream of another place`);
  if (t.startsWith("near:")) { const [, d] = t.slice(5).split("@"); return L(`路程不超过 ${d} 天`, `within ${d} days`); }
  return REQ_ZH[t] || t;
};
function analyseConflict(W, s) {
  const items = effItems(W.P, W.spec, s);      // constraints already traded away are not part of the conflict
  if (!items.length) return null;
  const core = minimalCore(W, items);
  if (!core) return null;
  const alts = [];
  if (core.some(t => t.startsWith("region:"))) {
    const rest = core.filter(t => !t.startsWith("region:"));
    const ok = REGIONS.filter(r => feasibleCount(W, ["region:" + r, ...rest], true).n > 0);
    if (ok.length) alts.push(L(`改到${ok.slice(0, 3).map(r => REGION_ZH[r]).join("、")}部`, `move to ${ok.slice(0, 3).map(r => RG(r)).join(", ")}`));
  }
  const proposed = new Set(s.proposed || []);
  const ordered = [...core].sort((a, b) => (proposed.has(b) ? 1 : 0) - (proposed.has(a) ? 1 : 0)); // proposed constraints yield first
  for (const t of ordered) {
    if (t.startsWith("region:")) continue;
    const rest = core.filter(x => x !== t);
    if (feasibleCount(W, rest, true).n > 0) alts.push(L(`放弃「${ITEM_ZH(t)}」${proposed.has(t) ? "（提议约束，可优先让步）" : t === "coast" || t === "river_mouth" ? "（改为内河港）" : ""}`,
      `drop "${ITEM_ZH(t)}"${proposed.has(t) ? " (a proposal, can yield first)" : t === "coast" || t === "river_mouth" ? " (becomes a river port)" : ""}`));
  }
  const capped = core.map(t => ({ item: t, c: charCap(W, t) })).filter(x => x.c);
  const why = !capped.length ? "" : L(`（整体特征${capped.map(x => `「${charLabel(x.c)}」`).join("、")}不允许为它新造${capped.map(x => CHAR_CAPS[x.item][0] === "lake_share" ? "湖泊" : "山地").join("、")}）`,
    ` (the world's character ${capped.map(x => `"${charLabel(x.c)}"`).join(", ")} rules out building ${capped.map(x => CHAR_CAPS[x.item][0] === "lake_share" ? "a lake" : "mountains").join(", ")} for it)`);
  return { core, reason: L(`${core.map(ITEM_ZH).join(" + ")} 无法同时满足${why}`, `${core.map(ITEM_ZH).join(" + ")} cannot all hold${why}`), alternatives: alts,
    character: capped.map(x => ({ item: x.item, by: "char." + x.c.id, label: charLabel(x.c), why: x.c.why })) };
}

// ---------- relaxation: what a constraint may be traded for ----------
// A relaxation either drops a constraint or swaps it for a weaker one of the same kind. Nothing here can
// strengthen a constraint, and applyActions refuses a trade on any item the conflict analysis did not put in a
// minimal core — so a constraint is only ever given up against a proof that it cannot be kept.
const RELAX_TO = {
  river_mouth: ["coast", "on_river"],   // an estuary port falls back to any coast, or to an inland river port
  coast: ["on_river", "lakeside"],      // a sea port becomes a river or lake port
  near_mountain: ["defensible"],        // "by the mountains" usually stands in for "commands the ground"
  lakeside: ["on_river"],               // a town that needed a lake for water can take its water from a river instead
  on_river: [], accessible: [], defensible: [],
};
function relaxTargets(item) {
  if (item.startsWith("region:")) return REGIONS.filter(r => r !== item.slice(7)).map(r => "region:" + r);
  if (item.startsWith("near:")) { const [o, d] = item.slice(5).split("@"); return [2, 3].map(k => `near:${o}@${Math.min(40, Math.round(+d * k))}`); }
  if (item.startsWith("downstream:")) return [];       // a water-system dependency either holds or it does not
  return RELAX_TO[item] || [];
}
const relaxOf = (P, sid) => (P.relaxed || []).filter(r => r.sid === sid);
const relaxFind = (P, sid, item) => relaxOf(P, sid).find(r => r.item === item) || null;
// every constraint a settlement owns, written the way the conflict core writes them
function ownedItems(spec, s) {
  return [...(s.region ? ["region:" + s.region] : []), ...s.requires,
    ...(spec.relations || []).filter(r => r.a === s.id).map(r => r.type === "downstream_of" ? "downstream:" + r.b : "near:" + r.b + "@" + r.days)];
}
// the same list after relaxations: a swapped item shows its replacement, a dropped one disappears
function effItems(P, spec, s) {
  return ownedItems(spec, s).map(t => { const r = relaxFind(P, s.id, t); return r ? r.to : t; }).filter(Boolean);
}
function effRegion(P, s) {
  if (!s.region) return null;
  const r = relaxFind(P, s.id, "region:" + s.region);
  return r ? (r.to ? r.to.slice(7) : null) : s.region;
}
// what one core item could become, and how many cells each option would leave open
function relaxOptions(W, core, t) {
  const rest = core.filter(x => x !== t);
  const count = items => ({ cells_now: feasibleCount(W, items, false).n, cells_after_tools: feasibleCount(W, items, true).n });
  const opts = [{ to: null, label: L("放弃", "drop"), ...count(rest) }];
  for (const to of relaxTargets(t)) {
    if (core.includes(to)) continue;
    opts.push({ to, label: ITEM_ZH(to), ...count([...rest, to]) });
  }
  return opts.filter(o => o.cells_after_tools > 0);
}
// One brief per settlement whose constraints are jointly unsatisfiable. This is the whole input the negotiator
// reasons over: what conflicts, where each item came from, why the intent layer proposed it, and what each way
// out would cost. Everything here is structured — nothing is left for a policy to parse back out of prose.
function conflictBriefs(W, rep) {
  const out = [], seen = new Set();
  for (const c of rep.fails) {
    if (!c.conflict || seen.has(c.target)) continue;
    const s = W.spec.settlements.find(q => q.id === c.target); if (!s) continue;
    seen.add(c.target);
    const proposed = new Set(s.proposed || []);
    const relByItem = {};
    for (const rl of W.spec.relations || []) if (rl.a === s.id) relByItem[rl.type === "downstream_of" ? "downstream:" + rl.b : "near:" + rl.b + "@" + rl.days] = rl;
    out.push({
      key: c.target + "|" + c.conflict.core.slice().sort().join("+"),
      target: s.id, name: s.name, type: TYPE_ZH[s.type], reason: c.conflict.reason,
      checks: rep.fails.filter(f => f.target === s.id && f.conflict).map(f => f.id),
      core: c.conflict.core.map(t => {
        const rl = relByItem[t];
        return {
          item: t, label: ITEM_ZH(t),
          source: rl ? rl.source : s.invented || proposed.has(t) ? "proposed" : "explicit",    // an invented settlement owns nothing explicit
          rationale: rl ? rl.rationale || "" : s.invented ? L(`（规划器补全的聚落）${s.rationale || ""}`, `(a settlement the planner invented) ${s.rationale || ""}`) : proposed.has(t) ? s.rationale || "" : "",
          can_become: relaxOptions(W, c.conflict.core, t),
          blocked_by_character: (c.conflict.character || []).find(x => x.item === t) || undefined,
        };
      }),
    });
  }
  return out;
}
// Offline stand-in for the negotiator: yield the first proposed item that has a way out, otherwise declare.
// It has no access to the description, so it can only rank by provenance — which is exactly the baseline the
// LLM stage is supposed to beat.
function scriptedNegotiate(W, briefs) {
  const actions = [], notes = [];
  for (const b of briefs) {
    const ordered = [...b.core].sort((x, y) => (y.source === "proposed" ? 1 : 0) - (x.source === "proposed" ? 1 : 0));
    const pick = ordered.find(c => c.can_become.length);
    if (!pick) {
      b.checks.forEach(id => actions.push({ tool: "declare_unsatisfiable", args: { check_id: id, reason: b.reason } }));
      notes.push(L(`${b.name}：${b.reason}，没有可替代的约束 → 声明无法满足`, `${b.name}: ${b.reason}, nothing to trade → declared unsatisfiable`));
      continue;
    }
    // keep as much of the constraint as possible: prefer a swap over a drop, then one that already has room
    const swaps = pick.can_become.filter(o => o.to);
    const best = (swaps.length ? swaps : pick.can_become).slice()
      .sort((x, y) => (y.cells_now - x.cells_now) || (y.cells_after_tools - x.cells_after_tools))[0];
    actions.push({ tool: "relax_constraint", args: { target: b.target, item: pick.item, to: best.to, reason: L(`规则基线：${pick.source === "proposed" ? "提议约束优先让步" : "冲突核中唯一可让的约束"}`, `rule baseline: ${pick.source === "proposed" ? "a proposal yields first" : "the only item in the core that can yield"}`) } });
    notes.push(`${b.name}：${ITEM_ZH(pick.item)} → ${best.label}`);
  }
  return { analysis: notes.length ? notes.join(L("；", "; ")) + L("。", ".") : L("没有可让步的约束。", "Nothing can yield."), actions };
}

// ---------- verifier ----------
function rainShadow(W, m) {
  const r = W.P.ridges.find(q => q.mid === m.id); if (!r) return null;
  const w = W.spec.wind_from, ew = m.orientation === "EW";
  const applicable = ew ? (w === "N" || w === "S") : (w === "E" || w === "W");
  if (!applicable) return { applicable: false };
  const [cx, cy] = regionCenter(m.region);
  const upSign = (w === "W" || w === "N") ? -1 : 1; // upwind side is towards where wind comes from
  let ws = 0, wc = 0, ls = 0, lc = 0;
  for (let along = -N / 5; along <= N / 5; along += 3) for (let off = 22; off <= 80; off += 3) {
    for (const side of [1, -1]) {
      const x = Math.round(ew ? cx + along : cx + side * off), y = Math.round(ew ? cy + side * off : cy + along);
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x; if (!isDry(W, i)) continue;
      if (side === upSign) { ws += W.moist[i]; wc++; } else { ls += W.moist[i]; lc++; }
    }
  }
  if (wc < 20 || lc < 20) return { applicable: false };
  return { applicable: true, windward: ws / wc, leeward: ls / lc, at: [Math.round(ew ? cx : cx - upSign * 50), Math.round(ew ? cy - upSign * 50 : cy)] };
}
function verify(W, lore) {
  const { spec, P, hy } = W; const C = [];
  const add = o => {
    if (o.relaxedOff) o.status = "relaxed";                                  // traded away on purpose, with a reason
    else if (P.unsat.includes(o.id) && !o.pass) o.status = "declared";       // given up as impossible
    else o.status = o.pass ? "pass" : "fail";
    C.push(o);
  };
  const hasOcean = W.ocean.some(v => v);
  // character: the world as a whole, listed first because it outranks everything below
  for (const c of spec.character || []) {
    const r = charCheck(W, c);
    add({ id: `char.${c.id}`, cat: L("特征", "character"), code: "character", target: c.id, metric: c.metric, source: c.source,
      label: L(`整体特征：${charLabel(c)}${c.source === "critic" ? "（审阅补充）" : ""}`, `Character: ${charLabel(c)}${c.source === "critic" ? " (added in review)" : ""}`), pass: r.pass, measured: r.measured, why: c.why, dev: r.dev, margin: r.margin, at: [] });
  }
  // whether the world touches the sea at all is the author's call, and a reader sees it before anything else
  const wantSea = spec.ocean_side !== "none";
  add({ id: "char.sea", cat: L("特征", "character"), code: "world_sea", label: wantSea ? L("整体特征：临海", "Character: has a sea") : L("整体特征：内陆，全图无海", "Character: landlocked, no sea anywhere"),
    pass: hasOcean === wantSea, measured: hasOcean ? L("图上有海", "the map has sea") : L("图上没有海", "the map has no sea"), at: [] });
  // physical
  add({ id: "phys.sinks", cat: L("物理", "physics"), code: "river_sink", label: L("河流必须汇入海洋、湖泊或流出图幅", "Rivers must reach the sea, a lake or the map edge"), pass: hy.sinks.length === 0, measured: hy.sinks.length ? L(`${hy.sinks.length} 处河道终止于无出口洼地`, `${hy.sinks.length} channels end in closed basins`) : L("所有河道都有出口", "every channel has an outlet"), at: hy.sinks.slice(0, 6).map(s => cellXY(s.i)) });
  for (const m of spec.mountains) {
    const rs = rainShadow(W, m); if (!rs || !rs.applicable) continue;
    add({ id: `phys.shadow.${m.id}`, cat: L("物理", "physics"), code: "rain_shadow", target: m.id, region: m.region, label: L(`${m.name}背风坡应比迎风坡干燥`, `The lee of ${m.name} should be drier than its windward side`), pass: rs.leeward < rs.windward * 0.85, measured: L(`迎风坡湿度 ${rs.windward.toFixed(2)}，背风坡 ${rs.leeward.toFixed(2)}`, `windward moisture ${rs.windward.toFixed(2)}, lee ${rs.leeward.toFixed(2)}`), at: [rs.at] });
  }
  for (const s of spec.settlements) {
    const i = posIdx(W, s.id);
    add({ id: `phys.dry.${s.id}`, cat: L("物理", "physics"), code: "underwater", target: s.id, label: L(`${s.name}不能建在水里`, `${s.name} cannot stand in water`), pass: isDry(W, i), measured: isDry(W, i) ? L("在陆地上", "on land") : L("位于水域", "in water"), at: [W.P.pos[s.id]] });
    const sl = slopeAt(W, i);
    add({ id: `phys.slope.${s.id}`, cat: L("物理", "physics"), code: "steep", target: s.id, label: L(`${s.name}不能建在陡坡上`, `${s.name} cannot stand on a steep slope`), pass: sl <= SLOPE_MAX, measured: L(`坡度 ${(sl * 1000).toFixed(0)}（上限 ${SLOPE_MAX * 1000}）`, `slope ${(sl * 1000).toFixed(0)} (limit ${SLOPE_MAX * 1000})`), at: [W.P.pos[s.id]] });
  }
  // vegetation must fit the climate: rainforest and jungle need rain, so a dry or arid world keeps them to a trace
  const czV = P.cz !== undefined ? P.cz : spec.climate_zone;
  if (czV && (czV.humidity === "dry" || czV.humidity === "arid")) {
    let land = 0, wet = 0; for (let i = 0; i < NN; i++) if (!W.ocean[i]) { land++; if (W.biome[i] === "rainforest" || W.biome[i] === "jungle") wet++; }
    const sh = wet / Math.max(1, land), lim = 0.01;
    add({ id: "phys.biome.wet", cat: L("物理", "physics"), code: "biome_climate", label: L("偏干的气候里不该有成片雨林或丛林", "A dry climate should not grow rainforest or jungle"),
      pass: sh <= lim, dev: sh > lim ? +((sh - lim) * 100).toFixed(1) : 0,
      measured: L(`雨林与丛林占陆地 ${(sh * 100).toFixed(1)}%（上限 ${lim * 100}%）`, `rainforest and jungle ${(sh * 100).toFixed(1)}% of land (limit ${lim * 100}%)`), at: [] });
  }
  // spec
  for (const m of spec.mountains) {
    const [cx, cy] = regionCenter(m.region); let cnt = 0, peak = 0;
    for (let y = Math.floor(cy - N / 6); y < cy + N / 6; y++) for (let x = Math.floor(cx - N / 6); x < cx + N / 6; x++) { const i = y * N + x; if (W.ocean[i]) continue; const rel = W.h[i] - P.sea; peak = Math.max(peak, rel); if (rel > MOUNTAIN_REL) cnt++; }
    add({ id: `spec.mtn.${m.id}`, cat: L("规格", "spec"), code: "mountain_weak", target: m.id, region: m.region, label: L(`${RG(m.region)}要有${m.name}`, `${m.name} should rise in ${RG(m.region)}`), pass: cnt >= MOUNTAIN_MIN_CELLS, gap: clamp(1 - cnt / MOUNTAIN_MIN_CELLS, 0, 1), measured: L(`山地 ${cnt} 格（至少 ${MOUNTAIN_MIN_CELLS}），最高相对海拔 ${peak.toFixed(2)}`, `${cnt} mountain cells (need ${MOUNTAIN_MIN_CELLS}), peak relative elevation ${peak.toFixed(2)}`), at: [[Math.round(cx), Math.round(cy)]] });
  }
  add({ id: "spec.rivers", cat: L("规格", "spec"), code: "few_rivers", label: L(`至少 ${spec.min_major_rivers} 条大河`, `At least ${spec.min_major_rivers} major rivers`), pass: hy.rivers.length >= spec.min_major_rivers, gap: clamp(1 - hy.rivers.length / Math.max(1, spec.min_major_rivers), 0, 1), measured: L(`现有 ${hy.rivers.length} 条（主干 ≥ ${MAJOR_LEN * kmOf(W)} km）`, `${hy.rivers.length} now (main stem ≥ ${MAJOR_LEN * kmOf(W)} km)`), at: [] });
  if (spec.min_lakes > 0) add({ id: "spec.lakes", cat: L("规格", "spec"), code: "few_lakes", label: L(`至少 ${spec.min_lakes} 个湖泊`, `At least ${spec.min_lakes} lakes`), pass: hy.lakes.length >= spec.min_lakes, gap: clamp(1 - hy.lakes.length / spec.min_lakes, 0, 1), measured: L(`现有 ${hy.lakes.length} 个`, `${hy.lakes.length} now`), at: [] });
  for (const s of spec.settlements) {
    const i = posIdx(W, s.id), p = W.P.pos[s.id];
    if (s.region) {
      const rx = relaxFind(P, s.id, "region:" + s.region), want = effRegion(P, s), r = regionOf(...p);
      const note = rx ? L(`（原为${RG(s.region)}，已让步：${rx.reason || "无理由"}）`, ` (was ${RG(s.region)}, yielded: ${rx.reason || "no reason"})`) : "";
      add({ id: `spec.region.${s.id}`, cat: L("规格", "spec"), code: "wrong_region", target: s.id, item: want ? "region:" + want : null,
        relaxed: !!rx, relaxedOff: !!rx && !want,
        label: want ? L(`${s.name}应在${RG(want)}${note}`, `${s.name} should be in ${RG(want)}${note}`) : L(`${s.name}原应在${RG(s.region)}${note}`, `${s.name} was to be in ${RG(s.region)}${note}`),
        pass: want ? r === want : true, measured: L(`实际在${RG(r)}`, `actually in ${RG(r)}`), at: [p] });
    }
    for (const q of s.requires) {
      const id = `spec.req.${s.id}.${q}`;                    // the id follows the ORIGINAL item, so trajectories stay comparable
      const src = (s.proposed || []).includes(q) ? "proposed" : "explicit";
      const rx = relaxFind(P, s.id, q), q2 = rx ? rx.to : q;
      if (rx && !q2) {
        add({ id, cat: L("规格", "spec"), code: "req_relaxed", target: s.id, req: q, source: src, relaxed: true, relaxedOff: true,
          label: L(`${s.name}（${TYPE_ZH[s.type]}）原需要${REQ_ZH[q]}`, `${s.name} (${TYPE_ZH[s.type]}) was to be ${REQ_ZH[q]}`), pass: true, measured: L(`已放弃：${rx.reason || "无理由"}`, `dropped: ${rx.reason || "no reason"}`), at: [p] });
        continue;
      }
      const note = rx ? L(`（原需要${REQ_ZH[q]}，已让步：${rx.reason || "无理由"}）`, ` (was ${REQ_ZH[q]}, yielded: ${rx.reason || "no reason"})`) : (s.proposed || []).includes(q) ? L("（提议）", " (proposed)") : "";
      if ((q2 === "coast" || q2 === "river_mouth") && !hasOcean) {
        add({ id, cat: L("规格", "spec"), code: "no_ocean", target: s.id, req: q2, item: q2, source: src, relaxed: !!rx,
          label: L(`${s.name}（${TYPE_ZH[s.type]}）需要${REQ_ZH[q2]}${note}`, `${s.name} (${TYPE_ZH[s.type]}) must be ${REQ_ZH[q2]}${note}`), pass: false, measured: L("规格中整片区域没有海，此要求无法满足", "the spec has no sea anywhere, so this cannot hold"), at: [p] });
        continue;
      }
      const ok = REQ_TEST[q2](W, i);
      const g = q2 === "accessible" || q2 === "defensible" ? geoFields(W) : null;
      const detail = !g ? (ok ? L("满足", "met") : L("不满足", "not met"))
        : q2 === "accessible" ? L(`通达度 ${g.access[i].toFixed(2)}（需 ≥ ${ACCESS_T}）`, `accessibility ${g.access[i].toFixed(2)} (need ≥ ${ACCESS_T})`)
        : L(`防御性 ${g.def[i].toFixed(2)}（需 ≥ ${DEF_T}）`, `defensibility ${g.def[i].toFixed(2)} (need ≥ ${DEF_T})`);
      // a near miss on a graded measure costs little: 5% short of the line already counts as a full miss
      const gap = ok || !g ? 1 : clamp(5 * (1 - (q2 === "accessible" ? g.access[i] / ACCESS_T : g.def[i] / DEF_T)), 0, 1);
      add({ id, cat: L("规格", "spec"), code: "req_unmet", target: s.id, req: q2, item: q2, source: src, relaxed: !!rx,
        label: L(`${s.name}（${TYPE_ZH[s.type]}）需要${REQ_ZH[q2]}${note}`, `${s.name} (${TYPE_ZH[s.type]}) must be ${REQ_ZH[q2]}${note}`), pass: ok, gap, measured: detail, at: [p] });
    }
  }
  // narrative
  if (lore) for (const e of lore) e.claims.forEach((c, k) => {
    const r = checkClaim(W, c);
    const subj = c.s || c.a;
    add({ id: `lore.${e.id}.${k}`, cat: L("叙事", "lore"), code: "lore_claim", claim: c, target: subj, label: r.label, pass: r.ok, measured: r.measured, at: subj && W.P.pos[subj] ? [W.P.pos[subj]] : [] });
  });
  // relations between settlements (proposed constraints usually live here)
  for (const rl of spec.relations || []) {
    const A = spec.settlements.find(q => q.id === rl.a), B = spec.settlements.find(q => q.id === rl.b);
    if (!A || !B) continue;
    const item0 = rl.type === "downstream_of" ? "downstream:" + rl.b : "near:" + rl.b + "@" + rl.days;
    const rx = relaxFind(P, rl.a, item0), item = rx ? rx.to : item0;
    if (rx && !item) {
      add({ id: `spec.rel.${rl.id}`, cat: L("规格", "spec"), code: "rel_relaxed", target: rl.a, other: rl.b, source: rl.source, relaxed: true, relaxedOff: true,
        label: L(`${A.name}原应${REL_ZH[rl.type]}${B.name}`, `${A.name} was to be ${rl.type === "downstream_of" ? "downstream of" : `within ${rl.days} days of`} ${B.name}`), pass: true, measured: L(`已放弃：${rx.reason || "无理由"}`, `dropped: ${rx.reason || "no reason"}`), at: [W.P.pos[rl.a]] });
      continue;
    }
    const tag = rx ? L(`（已让步：${rx.reason || "无理由"}）`, ` (yielded: ${rx.reason || "no reason"})`) : rl.source === "proposed" ? L("（提议）", " (proposed)") : "";
    if (rl.type === "downstream_of") {
      const ok = dominatesDownstream(W, rl.b, rl.a);
      add({ id: `spec.rel.${rl.id}`, cat: L("规格", "spec"), code: "rel_downstream", target: rl.a, other: rl.b, source: rl.source, item, relaxed: !!rx,
        label: L(`${A.name}应位于${B.name}的下游${tag}`, `${A.name} should be downstream of ${B.name}${tag}`), pass: ok, measured: ok ? L("顺流可达", "reachable downstream") : L("两地不在同一水系的上下游", "not on the same river system"), at: [W.P.pos[rl.a]] });
    } else {
      const days = item.startsWith("near:") ? +item.split("@")[1] : rl.days;
      const d = travelDays(W, rl.a, rl.b), ok = d != null && d <= days;
      add({ id: `spec.rel.${rl.id}`, cat: L("规格", "spec"), code: "rel_days", target: rl.a, other: rl.b, days, source: rl.source, item, relaxed: !!rx,
        label: L(`${A.name}到${B.name}不超过 ${days} 天${tag}`, `${A.name} within ${days} days of ${B.name}${tag}`), pass: ok, gap: d == null ? 1 : clamp(5 * (d / days - 1), 0, 1), measured: d == null ? L("陆路不可达", "unreachable overland") : L(`实测 ${d} 天`, `measured ${d} days`), at: [W.P.pos[rl.a]] });
    }
  }
  // for settlements that fail a placement constraint, work out whether the constraint set is satisfiable at all
  const conflicted = new Set();
  for (const s2 of spec.settlements) {
    if (!C.some(c => c.status === "fail" && c.target === s2.id && ["req_unmet", "wrong_region", "no_ocean", "rel_downstream", "rel_days"].includes(c.code))) continue;
    const cf = analyseConflict(W, s2);
    if (!cf) continue;
    conflicted.add(s2.id);
    for (const c of C) {
      // `measured` stays a pure measurement; the conflict travels as structured data on `c.conflict`
      if (c.target === s2.id && c.status === "fail" && c.item && cf.core.includes(c.item)) c.conflict = cf;
    }
  }
  const fails = C.filter(c => c.status === "fail");
  const counted = C.filter(c => c.status !== "declared" && c.status !== "relaxed");
  return { checks: C, fails, rate: counted.length ? counted.filter(c => c.pass).length / counted.length : 1 };
}

// ---------- layered score ----------
// A map is judged in three layers, compared in order: the world as a whole (character shares, sea or no sea), then
// natural plausibility (physics, vegetation that fits the climate), then the details (settlement sites, relations,
// ranges, river and lake counts, lore). Each layer adds up how far its failing checks miss rather than how many fail:
// a share 12 points outside its band weighs 12 and a town 0.4% short of the accessibility line almost nothing. Details
// the author wrote weigh 1 and ones the planner inferred 0.5, times 0.6 for anything the planner invented outright.
// Declaring a check unsatisfiable halves its detail weight and changes nothing in the first two layers: the reader still
// sees the map.
const LAYER_OF = { character: 0, world_sea: 0, river_sink: 1, rain_shadow: 1, underwater: 1, steep: 1, biome_climate: 1 };
const SCORE_EPS = [1, 0.5, 0.25];          // differences this small within a layer count as a tie
function layeredScore(W, rep) {
  const sc = [0, 0, 0];
  for (const c of rep.checks) {
    if (c.status !== "fail" && c.status !== "declared") continue;
    const layer = LAYER_OF[c.code] ?? 2;
    if (layer === 0) sc[0] += c.code === "world_sea" ? 50 : c.dev ?? 10;
    else if (layer === 1) sc[1] += 1 + (c.dev || 0) / 5;
    else {
      const ent = W.spec.settlements.find(q => q.id === c.target) || W.spec.mountains.find(q => q.id === c.target);
      sc[2] += (c.source === "proposed" ? 0.5 : 1) * (ent && ent.invented ? 0.6 : 1) * (c.gap ?? 1) * (c.status === "declared" ? 0.5 : 1);
    }
  }
  return sc.map(x => +x.toFixed(2));
}
// < 0 when score a is better than b, > 0 when worse, 0 when every layer ties within its tolerance
function compareScore(a, b) {
  for (let k = 0; k < 3; k++) { const d = a[k] - b[k]; if (d < -SCORE_EPS[k]) return -1; if (d > SCORE_EPS[k]) return 1; }
  return 0;
}
// a strict order for keeping the best version: the tolerant comparison first, then the raw numbers layer by layer
function rankScore(a, b) { return compareScore(a, b) || (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
const scoreText = sc => L(`特征 ${sc[0]} · 自然 ${sc[1]} · 细节 ${sc[2]}`, `character ${sc[0]} · nature ${sc[1]} · detail ${sc[2]}`);

// ---------- tools ----------
const MOVE_TARGETS = ["nearest_coast", "nearest_river", "nearest_river_mouth", "nearest_lake", "near_mountain", "flattest_nearby", "accessible", "defensible"];
const TARGET_REQ = { nearest_coast: "coast", nearest_river: "on_river", nearest_river_mouth: "river_mouth", nearest_lake: "lakeside", near_mountain: "near_mountain", accessible: "accessible", defensible: "defensible" };
// cells the water leaving b flows through, so a site there is downstream of b
function downstreamMask(W, sid) {
  W._dsm = W._dsm || {};
  if (W._dsm[sid]) return W._dsm[sid];
  const m = new Uint8Array(NN), start = riverAt(W, posIdx(W, sid));
  if (start) {
    let c = start.cell;
    for (let k = 0; k < 4000 && c >= 0 && !W.ocean[c]; k++) {
      const x = c % N, y = (c - x) / N;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < N && yy < N && dx * dx + dy * dy <= 4) m[yy * N + xx] = 1;
      }
      c = W.hy.down[c];
    }
  }
  W._dsm[sid] = m; return m;
}
function withinDaysMask(W, sid, days) {
  travelDays(W, sid, sid);
  const dist = W.travel.get(sid), m = new Uint8Array(NN), budget = days * KM_PER_DAY / kmOf(W);
  for (let i = 0; i < NN; i++) if (dist[i] <= budget) m[i] = 1;
  return m;
}
const TOOL_DOC = `fill_depressions()  — switch hydrology to priority-flood: depressions fill into lakes that overflow, so every river reaches an outlet.
recompute_climate()  — replace noise moisture with an orographic model driven by wind_from (creates rain shadows).
raise_ridge(region, amount)  — raise the mountain ridge in a region (amount 0.02–0.2); creates a ridge if none exists there.
carve_basin(region)  — dig a shallow basin in a region; after fill_depressions it becomes a lake.
set_river_threshold(value)  — flow accumulation needed to draw a river (current value given). Lower = a denser network everywhere, so it is a last resort: when channels end in closed basins, fill_depressions alone usually creates the major rivers, so fill first and look. Lowering is refused in the round that also fills, and while there are enough major rivers and every settlement needing a river has one in its region; it can drop by at most 40% per call and never below the climate's floor (arid 220, dry 150, normal 90, humid 60). For a town that must be on a river, move_settlement it with nearest_river instead.
set_sea_level(value)  — 0.30–0.50. Higher floods more coast.
move_settlement(id, targets)  — move a settlement to the nearest flat dry cell satisfying ALL targets. targets: array of nearest_coast | nearest_river | nearest_river_mouth | nearest_lake | near_mountain | flattest_nearby | region:<R>. The settlement's spec region is preferred automatically.
declare_unsatisfiable(check_id, reason)  — mark a check as impossible to satisfy and stop trying.
set_landform(landform)  — rebuild land and sea from another template. With sea: coast | bay (coast with one large gulf) | two_coasts (sea on two sides) | continent (ringed by sea) | archipelago | islands | peninsula | isthmus | inland_sea | fjords | volcanic_island | shattered. Landlocked: plains (low, flat, open) | basin (lowland ringed by mountains) | lakeland (many lakes) | highland (raised, rugged, cold plateau with a rift). A landlocked world can only switch to another landlocked template and a world with sea only to another with sea. Towns left at sea are pulled back to land.
set_climate(temperature, humidity)  — temperature: polar | cold | temperate | warm | hot; humidity: arid | dry | normal | humid. Shifts every biome; under a dry climate, lakes shrink to what their inflow can keep against evaporation and the rest of each basin dries to salt flat.`;
// The negotiator's only tool. It is deliberately not in TOOL_DOC: the repair agent edits terrain, the negotiator
// edits the goal, and keeping the two tool sets apart is what makes the stage separable in an ablation.
const RELAX_DOC = `relax_constraint(target, item, to, reason)  — trade one of a settlement's constraints for a weaker one instead of failing it.
  target: settlement id.
  item:   the constraint, written exactly as the conflict core writes it ("coast", "river_mouth", "on_river", "lakeside", "near_mountain", "accessible", "defensible", "region:E", "near:S2@4", "downstream:S2").
  to:     the weaker constraint that replaces it, taken from that item's "can_become" list, or null to drop it outright.
  reason: one Chinese sentence naming what in the description justifies the trade.
  The tool refuses any item the solver did not put in a conflict core, any swap that is not a weakening, and any call without a reason.`;

// Lowering the river threshold thickens the whole network at once, so it is the last resort, not the first: a dry
// world gets a higher floor, one call can cut the value by at most 40%, and it is refused while it cannot help.
// Two cases where it cannot: hydrology is still unfilled and this same round fills it (every channel used to end in a
// closed basin, and filling alone usually yields the major rivers, so look first), or the map already has enough
// major rivers and every settlement that needs one has a river in its own region (move the town instead).
const RIVER_FLOOR = { arid: 220, dry: 150, normal: 90, humid: 60 };
function riverLowerBlock(W, P, acts) {
  if (W.P.hydro !== "filled" && acts.some(a => a.tool === "fill_depressions"))
    return ["本轮已经在填洼，先看填洼后形成的河流再决定", "this round already fills depressions; see the rivers that makes first"];
  if (W.hy.rivers.length < W.spec.min_major_rivers) return null;
  // a town that needs a river, or a river mouth on the sea, in a region that has none
  const dry = W.spec.settlements.filter(s => {
    const items = effItems(W.P, W.spec, s), reg = effRegion(W.P, s) || regionOf(...W.P.pos[s.id]);
    return (items.includes("on_river") && !regionHasRiver(W, reg)) || (items.includes("river_mouth") && !W.hy.rivers.some(r => r.kind === "sea" && r.mouthRegion === reg));
  });
  if (dry.length) return null;
  return ["大河数量已够，需要临河的聚落所在区域也都有河；请用 move_settlement 把聚落移到河边", "there are enough major rivers and every settlement that needs one has a river in its region; move the settlement with move_settlement"];
}
function regionHasRiver(W, region) {
  for (let i = 0; i < NN; i++) if (W.hy.channel[i] && !W.hy.lake[i] && regionOf(i % N, Math.floor(i / N)) === region) return true;
  return false;
}
function applyActions(W, actions) {
  const spec = W.spec; const P = deep(W.P); const results = [];
  P.relaxed = P.relaxed || [];
  const moves = [];
  const order = ["relax_constraint", "declare_unsatisfiable", "set_landform", "set_climate", "set_sea_level", "raise_ridge", "carve_basin", "recompute_climate", "fill_depressions", "set_river_threshold"];
  const acts = (Array.isArray(actions) ? actions : []).slice(0, 12).map(a => ({ tool: String(a && a.tool || ""), args: (a && a.args) || {} }));
  acts.sort((a, b) => (order.indexOf(a.tool) + 99) % 99 - (order.indexOf(b.tool) + 99) % 99);
  let terrainChanged = false;
  for (const a of acts) {
    const g = a.args;
    switch (a.tool) {
      case "fill_depressions": results.push({ a, ok: true, msg: P.hydro === "filled" ? L("已经是填洼模式", "already filling depressions") : L("水文改为 priority-flood 填洼", "hydrology now fills depressions (priority-flood)") }); P.hydro = "filled"; terrainChanged = true; break;
      case "recompute_climate": results.push({ a, ok: true, msg: L("湿度改由地形抬升降水模型计算", "moisture now from the orographic rainfall model") }); P.climate = "orographic"; terrainChanged = true; break;
      case "raise_ridge": {
        const region = REGIONS.includes(g.region) ? g.region : null; if (!region) { results.push({ a, ok: false, msg: "未知区域" }); break; }
        const amt = clamp(+g.amount || 0.1, 0.02, 0.2);
        let r = P.ridges.find(q => q.region === region);
        if (!r) { const m = spec.mountains.find(q => q.region === region); r = { mid: m ? m.id : null, region, orientation: m ? m.orientation : "EW", amp: 0, k: P.ridges.length }; P.ridges.push(r); }
        r.amp = clamp(r.amp + amt, 0, 0.45); terrainChanged = true;
        results.push({ a, ok: true, msg: L(`${RG(region)}山脊抬高到 ${r.amp.toFixed(2)}`, `ridge in ${RG(region)} raised to ${r.amp.toFixed(2)}`) }); break;
      }
      case "carve_basin": {
        const region = REGIONS.includes(g.region) ? g.region : null; if (!region) { results.push({ a, ok: false, msg: "未知区域" }); break; }
        if (P.basins.some(b => b.region === region)) { const b = P.basins.find(b => b.region === region); b.depth = Math.min(0.2, b.depth + 0.05); }
        else P.basins.push({ region, depth: 0.10 });
        terrainChanged = true; results.push({ a, ok: true, msg: L(`在${RG(region)}挖出盆地`, `basin dug in ${RG(region)}`) }); break;
      }
      case "set_landform": {
        const lf = String(g.landform || "");
        if (!LANDFORMS.includes(lf)) { results.push({ a, ok: false, msg: L(`未知地形模板 ${lf}`, `unknown landform ${lf}`) }); break; }
        // whether the world touches the sea is the author's call (spec.ocean_side), not a knob for fixing biome shares
        const inland = spec.ocean_side === "none";
        if (inland !== (LANDFORM_SIDE[lf] === "none")) { results.push({ a, ok: false, msg: inland ? L(`这是内陆世界，不能换成有海的「${LANDFORM_ZH[lf]}」`, `this world is landlocked; it cannot become "${LANDFORM_ZH[lf]}", which has sea`) : L(`这个世界临海，不能换成内陆的「${LANDFORM_ZH[lf]}」`, `this world has sea; it cannot become the landlocked "${LANDFORM_ZH[lf]}"`) }); break; }
        const was = P.landform !== undefined ? P.landform : spec.landform;
        P.landform = lf; terrainChanged = true;
        results.push({ a, ok: true, msg: L(`地形模板 ${LANDFORM_ZH[was] || "默认海岸"} → ${LANDFORM_ZH[lf]}`, `landform ${LANDFORM_ZH[was] || "default coast"} → ${LANDFORM_ZH[lf]}`) }); break;
      }
      case "set_climate": {
        const cur = (P.cz !== undefined ? P.cz : spec.climate_zone) || { temperature: "temperate", humidity: "normal" };
        const t = CLIMATE_T[g.temperature] != null ? g.temperature : cur.temperature, w = CLIMATE_W[g.humidity] ? g.humidity : cur.humidity;
        P.cz = t === "temperate" && w === "normal" ? null : { temperature: t, humidity: w }; terrainChanged = true;
        const T = L({ polar: "极寒", cold: "寒冷", temperate: "温和", warm: "温暖", hot: "炎热" }, { polar: "polar ", cold: "cold ", temperate: "temperate ", warm: "warm ", hot: "hot " }), H = L({ arid: "干旱", dry: "偏干", normal: "适中", humid: "湿润" }, { arid: "arid", dry: "dry", normal: "moderate", humid: "humid" });
        results.push({ a, ok: true, msg: L(`气候 ${T[cur.temperature]}${H[cur.humidity]} → ${T[t]}${H[w]}`, `climate ${T[cur.temperature]}${H[cur.humidity]} → ${T[t]}${H[w]}`) }); break;
      }
      case "set_river_threshold": {
        let v = clamp(Math.round(+g.value || P.riverThr), 60, 800);
        if (v < P.riverThr) {
          const why = riverLowerBlock(W, P, acts);
          if (why) { results.push({ a, ok: false, msg: L(`河流阈值保持 ${P.riverThr}：${why[0]}`, `river threshold stays ${P.riverThr}: ${why[1]}`) }); break; }
          const cz = (P.cz !== undefined ? P.cz : spec.climate_zone) || { humidity: "normal" }, floor = RIVER_FLOOR[cz.humidity] || 90;
          v = Math.max(v, Math.round(P.riverThr * 0.6), floor);
          if (v >= P.riverThr) { results.push({ a, ok: false, msg: L(`河流阈值保持 ${P.riverThr}：已到这种气候的下限 ${floor}`, `river threshold stays ${P.riverThr}: already at this climate's floor of ${floor}`) }); break; }
        }
        results.push({ a, ok: true, msg: L(`河流阈值 ${P.riverThr} → ${v}`, `river threshold ${P.riverThr} → ${v}`) }); P.riverThr = v; terrainChanged = true; break;
      }
      case "set_sea_level": { const v = clamp(+g.value || P.sea, 0.30, 0.50); results.push({ a, ok: true, msg: L(`海平面 ${P.sea.toFixed(2)} → ${v.toFixed(2)}`, `sea level ${P.sea.toFixed(2)} → ${v.toFixed(2)}`) }); P.sea = v; terrainChanged = true; break; }
      case "declare_unsatisfiable": { const id = String(g.check_id || ""); if (!P.unsat.includes(id)) P.unsat.push(id); results.push({ a, ok: true, msg: L(`声明无法满足：${id}`, `declared unsatisfiable: ${id}`) }); break; }
      case "relax_constraint": {
        const sid = String(g.target || ""), item = String(g.item || "");
        const st = spec.settlements.find(q => q.id === sid);
        if (!st) { results.push({ a, ok: false, msg: L(`没有聚落 ${sid}`, `no settlement ${sid}`) }); break; }
        if (!ownedItems(spec, st).includes(item)) { results.push({ a, ok: false, msg: L(`${st.name} 没有约束「${item}」`, `${st.name} has no constraint "${item}"`) }); break; }
        if (relaxFind(P, sid, item)) { results.push({ a, ok: false, msg: L(`「${ITEM_ZH(item)}」已经让过一次，不再重复让步`, `"${ITEM_ZH(item)}" has already yielded once`) }); break; }
        // a trade needs a proof: the item must sit in a minimal unsatisfiable core of this settlement's constraints
        const cf = analyseConflict(W, st);
        if (!cf || !cf.core.includes(item)) { results.push({ a, ok: false, msg: L(`「${ITEM_ZH(item)}」不在冲突核里，无需让步`, `"${ITEM_ZH(item)}" is not in a conflict core, nothing to yield`) }); break; }
        const to = g.to == null || g.to === "" || g.to === "null" ? null : String(g.to);
        if (to && !relaxTargets(item).includes(to)) { results.push({ a, ok: false, msg: L(`不能把「${ITEM_ZH(item)}」换成「${ITEM_ZH(to)}」（只能放弃或换成更弱的约束）`, `cannot trade "${ITEM_ZH(item)}" for "${ITEM_ZH(to)}" (only a drop or a weaker constraint)`) }); break; }
        const reason = String(g.reason || "").slice(0, 160);
        if (!reason) { results.push({ a, ok: false, msg: L("让步必须给出理由", "a trade needs a reason") }); break; }
        P.relaxed.push({ sid, item, to, reason });
        results.push({ a, ok: true, msg: L(`${st.name}：${ITEM_ZH(item)} → ${to ? ITEM_ZH(to) : "放弃"}（${reason}）`, `${st.name}: ${ITEM_ZH(item)} → ${to ? ITEM_ZH(to) : "dropped"} (${reason})`) });
        break;
      }
      case "move_settlement": moves.push(a); break;
      default: results.push({ a, ok: false, msg: L(`未知工具 ${a.tool}`, `unknown tool ${a.tool}`) });
    }
  }
  const W2 = derive(spec, P);
  // the ground changed under the settlements: re-site every one the change broke (explicit moves handle their own)
  if (terrainChanged) for (const st of spec.settlements) if (!moves.some(m => String(m.args.id) === st.id)) {
    const r = resite(W, W2, st); if (r) results.push(r);
  }
  for (const a of moves) results.push(moveSettlement(W2, a));
  return { W: W2, results, terrainChanged };
}
// How a settlement sits on its ground: the site must be dry and not steep, and each of its own site requirements
// (coast, on_river, accessible...) either holds there or not. Relaxed items count in their weaker form; requirements
// declared unsatisfiable are left out.
function siteState(W, s) {
  const i = posIdx(W, s.id), reqs = {};
  for (const t of ownedItems(W.spec, s)) {        // check ids follow the original item, the test follows its relaxed form
    const r = relaxFind(W.P, s.id, t), q = r ? r.to : t;
    if (q && REQ_TEST[q] && !W.P.unsat.includes(`spec.req.${s.id}.${t}`)) reqs[q] = REQ_TEST[q](W, i);
  }
  return { dry: isDry(W, i), steep: slopeAt(W, i) > SLOPE_MAX, reqs };
}
// After a terrain change, compare each site on the old and the new ground. A site that is now under water, newly
// steep, or has lost a requirement it used to meet moves to the nearest ground that keeps every requirement it met
// before; if no such ground exists, a flooded town still goes to the nearest dry, flat cell. Sites that were already
// failing for other reasons are left alone: that is the repair agent's call. Returns null when nothing changed.
function resite(W0, W1, s) {
  const a = siteState(W0, s), b = siteState(W1, s);
  const lost = Object.keys(b.reqs).filter(q => a.reqs[q] && !b.reqs[q]);
  const why = [!b.dry ? L("落入水中", "is now under water") : null, b.dry && b.steep && !a.steep ? L("变成陡坡", "is now on a steep slope") : null,
    ...lost.map(q => L(`失去「${ITEM_ZH(q)}」`, `lost "${ITEM_ZH(q)}"`))].filter(Boolean);
  if (!why.length) return null;
  const from = W1.P.pos[s.id].slice(), keep = Object.keys(b.reqs).filter(q => a.reqs[q]).map(q => REQ_TARGET[q]);
  let r = moveSettlement(W1, { tool: "move_settlement", args: { id: s.id, targets: keep } });
  // a town still on dry ground does not get flung out of its region to keep a requirement: it stays and fails it
  if (r.ok && r.outside && b.dry) { W1.P.pos[s.id] = from; r = { ok: false }; }
  if (!r.ok && !b.dry) r = moveSettlement(W1, { tool: "move_settlement", args: { id: s.id, targets: [] } });
  const head = L(`地形变化后${s.name}${why.join("、")}`, `After the terrain change ${s.name} ${why.join(", ")}`);
  return { a: { tool: "resite", args: { id: s.id } }, ok: r.ok, auto: true, from, to: W1.P.pos[s.id].slice(),
    msg: r.ok ? `${head} → ${L("自动重新选址：", "re-sited: ")}${r.msg}` : `${head}${L("，附近没有合适的位置，留在原处", "; no suitable ground nearby, left in place")}` };
}
function moveSettlement(W, a) {
  const id = String(a.args.id || ""); const s = W.spec.settlements.find(q => q.id === id);
  if (!s) return { a, ok: false, msg: L(`没有聚落 ${id}`, `no settlement ${id}`) };
  let targets = a.args.targets ?? a.args.target ?? [];
  if (!Array.isArray(targets)) targets = [targets];
  targets = targets.map(String);
  const reqs = [], regions = [], masks = []; let flattest = false;
  for (const t of targets) {
    if (t.startsWith("region:")) { const r = t.slice(7); if (REGIONS.includes(r)) regions.push(r); }
    else if (t.startsWith("downstream:")) { const o = t.slice(11); if (W.P.pos[o]) masks.push(downstreamMask(W, o)); }
    else if (t.startsWith("near:")) { const [o, d] = t.slice(5).split("@"); if (W.P.pos[o]) masks.push(withinDaysMask(W, o, +d || 5)); }
    else if (TARGET_REQ[t]) reqs.push(TARGET_REQ[t]);
    else if (t === "flattest_nearby") flattest = true;
  }
  const [x0, y0] = W.P.pos[id];
  const others = W.spec.settlements.filter(q => q.id !== id).map(q => W.P.pos[q.id]);
  const search = (region) => {
    let best = -1, bd = 1e9;
    for (let i = 0; i < NN; i++) {
      if (!isDry(W, i) || slopeAt(W, i) > SLOPE_MAX * 0.8) continue;
      const [x, y] = cellXY(i); if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
      if (region && regionOf(x, y) !== region) continue;
      if (regions.length && !regions.includes(regionOf(x, y))) continue;
      let ok = true; for (const q of reqs) if (!REQ_TEST[q](W, i)) { ok = false; break; }
      if (!ok) continue;
      if (masks.some(m => !m[i])) continue;
      if (others.some(o => Math.hypot(o[0] - x, o[1] - y) < 14)) continue;
      const d = Math.hypot(x - x0, y - y0); if (flattest && d > 20) continue;
      const sc = d + (flattest ? slopeAt(W, i) * 800 : 0);
      if (sc < bd) { bd = sc; best = i; }
    }
    return best;
  };
  const pref = regions.length ? null : effRegion(W.P, s);
  let best = search(pref), outside = false;
  if (best < 0 && pref) { best = search(null); outside = best >= 0; }
  if (best < 0) return { a, ok: false, msg: L(`找不到同时满足 [${targets.join(", ")}] 的位置${pref ? `（${RG(pref)}及全图）` : ""}`, `no site meets all of [${targets.join(", ")}]${pref ? ` (in ${RG(pref)} or anywhere)` : ""}`) };
  const to = cellXY(best); W.P.pos[id] = to;
  return { a, ok: true, outside, moved: Math.hypot(to[0] - x0, to[1] - y0), msg: L(`${s.name} 移动 ${Math.round(Math.hypot(to[0] - x0, to[1] - y0) * kmOf(W))} km${outside ? `（${RG(pref)}内没有合适位置，已移到${RG(regionOf(...to))}）` : ""}`,
    `${s.name} moved ${Math.round(Math.hypot(to[0] - x0, to[1] - y0) * kmOf(W))} km${outside ? ` (no site in ${RG(pref)}, moved to ${RG(regionOf(...to))})` : ""}`) };
}

// ---------- scripted policies (offline stand-ins for the LLM) ----------
const REQ_TARGET = { coast: "nearest_coast", on_river: "nearest_river", river_mouth: "nearest_river_mouth", lakeside: "nearest_lake", near_mountain: "near_mountain", accessible: "accessible", defensible: "defensible" };
const CLAIM_TARGET = { coastal: "nearest_coast", on_river: "nearest_river", lakeside: "nearest_lake", near_mountain: "near_mountain" };
function scriptedStructured(W, report, history) {
  const acts = [], notes = []; const P = W.P;
  const push = (tool, args) => { const key = tool + JSON.stringify(args); if (!acts.some(a => a.key === key)) acts.push({ tool, args, key }); };
  const lastFails = new Set();
  const last = history[history.length - 1];
  if (last) for (const r of last.results) if (r.a.tool === "move_settlement" && (!r.ok || r.outside || r.moved < 1)) lastFails.add(r.a.args.id);
  const settleT = {};
  for (const v of report.fails) {
    switch (v.code) {
      case "river_sink": push("fill_depressions", {}); notes.push(L("河道终止在洼地 → 填洼", "channels end in basins → fill depressions")); break;
      case "rain_shadow": push("recompute_climate", {}); notes.push(L("背风坡不够干 → 换地形降水模型", "lee side not dry enough → orographic rainfall")); break;
      case "mountain_weak": push("raise_ridge", { region: v.region, amount: 0.12 }); notes.push(L(`${RG(v.region)}山地不足 → 抬高山脊`, `too little mountain in ${RG(v.region)} → raise ridge`)); break;
      case "few_rivers": push("set_river_threshold", { value: Math.round(P.riverThr * 0.62) }); notes.push(L("大河数量不足 → 降低河流阈值", "too few major rivers → lower river threshold")); break;
      case "few_lakes": {
        if (P.hydro !== "filled") { push("fill_depressions", {}); break; }
        const used = new Set(P.basins.map(b => b.region));
        const want = W.spec.settlements.find(s => effItems(P, W.spec, s).includes("lakeside") && effRegion(P, s) && !used.has(effRegion(P, s)));
        const reg = want ? effRegion(P, want) : ["C", "SW", "NE", "W", "S"].find(r => !used.has(r)) || "C";
        push("carve_basin", { region: reg }); notes.push(L(`湖泊不足 → 在${RG(reg)}挖盆地`, `too few lakes → dig a basin in ${RG(reg)}`)); break;
      }
      case "no_ocean": push("declare_unsatisfiable", { check_id: v.id, reason: L("规格没有海，港口无法临海", "the spec has no sea, a port cannot reach it") }); notes.push(L("内陆区域不可能有港口 → 声明无法满足", "no port is possible inland → declared unsatisfiable")); break;
      case "rel_downstream": (settleT[v.target] = settleT[v.target] || new Set()).add("downstream:" + v.other); notes.push(L(`${v.label} → 沿水系下移`, `${v.label} → move downstream`)); break;
      case "rel_days": (settleT[v.target] = settleT[v.target] || new Set()).add("near:" + v.other + "@" + v.days); notes.push(L(`${v.label} → 向目标方向迁移`, `${v.label} → move towards the target`)); break;
      case "req_unmet": case "underwater": case "steep": case "wrong_region": case "lore_claim": {
        const s = W.spec.settlements.find(q => q.id === v.target); if (!s) break;
        settleT[s.id] = settleT[s.id] || new Set();
        if (v.code === "lore_claim") { const t = CLAIM_TARGET[v.claim.type]; if (t) settleT[s.id].add(t); else if (v.claim.type === "in_region") settleT[s.id].add("region:" + v.claim.region); }
        break;
      }
    }
  }
  for (const s of W.spec.settlements) {
    const failing = report.fails.filter(f => f.target === s.id && ["req_unmet", "underwater", "steep", "wrong_region"].includes(f.code));
    const loreT = settleT[s.id];
    if (!failing.length && !(loreT && loreT.size)) continue;
    const tg = new Set(loreT || []);
    for (const t of effItems(P, W.spec, s)) if (REQ_TARGET[t]) tg.add(REQ_TARGET[t]);
    if (!tg.size) tg.add("flattest_nearby");
    const conflictFails = failing.filter(f => f.conflict);
    if (conflictFails.length) {
      conflictFails.forEach(f => push("declare_unsatisfiable", { check_id: f.id, reason: f.conflict.reason }));
      notes.push(L(`${s.name}：${conflictFails[0].conflict.reason} → 声明无法满足${conflictFails[0].conflict.alternatives.length ? `（建议${conflictFails[0].conflict.alternatives[0]}）` : ""}`,
        `${s.name}: ${conflictFails[0].conflict.reason} → declared unsatisfiable${conflictFails[0].conflict.alternatives.length ? ` (suggest: ${conflictFails[0].conflict.alternatives[0]})` : ""}`));
      continue;
    }
    if (lastFails.has(s.id)) {
      // moving alone did not work last round: change the terrain instead
      const eff = effItems(P, W.spec, s), reg = effRegion(P, s);
      if (eff.includes("lakeside") && reg && !P.basins.some(b => b.region === reg)) { push("carve_basin", { region: reg }); if (P.hydro !== "filled") push("fill_depressions", {}); notes.push(L(`${s.name}附近无湖 → 在${RG(reg)}造湖`, `no lake near ${s.name} → make one in ${RG(reg)}`)); }
      else if (eff.some(q => q === "on_river" || q === "river_mouth") && P.riverThr > 90) { push("set_river_threshold", { value: Math.round(P.riverThr * 0.6) }); notes.push(L(`${s.name}附近无合适河道 → 降低河流阈值`, `no river near ${s.name} → lower river threshold`)); }
      else if (eff.includes("near_mountain") && reg) { push("raise_ridge", { region: reg, amount: 0.12 }); notes.push(L(`${s.name}附近山地不够 → 抬高山脊`, `too little mountain near ${s.name} → raise ridge`)); }
      else { failing.forEach(f => push("declare_unsatisfiable", { check_id: f.id, reason: L("多次移动仍无法满足", "still unmet after repeated moves") })); notes.push(L(`${s.name}多次移动失败 → 声明无法满足`, `${s.name}: moves keep failing → declared unsatisfiable`)); continue; }
    }
    push("move_settlement", { id: s.id, targets: [...tg] });
    notes.push(L(`${s.name}：${failing.map(f => f.label.replace(s.name, "").replace(/^（.*?）/, "")).join("、") || "与设定不符"} → 移动`, `${s.name}: ${failing.map(f => f.label.replace(s.name, "").replace(/^ \(.*?\)/, "")).join("; ") || "does not match the spec"} → move`));
  }
  return { analysis: notes.length ? [...new Set(notes)].join(L("；", "; ")) + L("。", ".") : L("没有可用的修正。", "No repair available."), actions: acts.map(({ tool, args }) => ({ tool, args })) };
}
function scriptedBlind(W, report, history, it) {
  const r = rng(W.P.seed * 31 + it * 7);
  const pick = a => a[Math.floor(r() * a.length)];
  const s = W.spec.settlements.length ? pick(W.spec.settlements) : null;
  const pool = [
    () => ({ tool: "raise_ridge", args: { region: pick(REGIONS), amount: 0.08 } }),
    () => ({ tool: "set_river_threshold", args: { value: Math.round(W.P.riverThr * (0.6 + r() * 0.8)) } }),
    () => ({ tool: "set_sea_level", args: { value: +(0.36 + r() * 0.08).toFixed(2) } }),
    () => ({ tool: "fill_depressions", args: {} }),
    () => ({ tool: "carve_basin", args: { region: pick(REGIONS) } }),
    () => s && ({ tool: "move_settlement", args: { id: s.id, targets: [pick(MOVE_TARGETS)] } }),
  ];
  const i1 = Math.floor(r() * pool.length); let i2 = Math.floor(r() * pool.length); if (i2 === i1) i2 = (i2 + 1) % pool.length;
  const acts = [pool[i1](), pool[i2]()].filter(Boolean);
  return { analysis: L("只知道本轮结果是“不通过”，不知道哪里出错，只能试探性地调整参数。", "Only told this round FAILED, not why, so the parameters are adjusted by trial."), actions: acts };
}

// ---------- map facts & scripted lore ----------
function settlementFacts(W, s) {
  const i = posIdx(W, s.id), rv = riverAt(W, i);
  const nearM = W.spec.mountains.filter(m => checkClaim(W, { type: "near_mountain", s: s.id, mountain: m.id }).ok).map(m => m.id);
  return { id: s.id, name: s.name, type: s.type, region: regionOf(...W.P.pos[s.id]), biome: W.biome[i], coastal: REQ_TEST.coast(W, i), river: rv ? rv.river : null, lakeside: REQ_TEST.lakeside(W, i), near_mountains: nearM };
}
function mapFacts(W) {
  const S = W.spec.settlements;
  const pairs = [];
  for (const a of S) for (const b of S) {
    if (a.id >= b.id) continue;
    pairs.push({ a: a.id, b: b.id, a_lies_to_the_dir_of_b: dirOf(W, a.id, b.id), travel_days: travelDays(W, a.id, b.id), separated_by: W.spec.mountains.filter(m => crossesMountain(W, a.id, b.id, m.id)).map(m => m.id), a_upstream_of_b: upstreamOf(W, a.id, b.id), b_upstream_of_a: upstreamOf(W, b.id, a.id) });
  }
  return {
    region: W.spec.name,
    settlements: S.map(s => ({ ...settlementFacts(W, s), ...geoProfile(W, s.id) })),
    rivers: W.hy.rivers.map(r => ({ id: r.id, name: r.name, length_km: r.lengthKm, ends: r.kind === "sea" ? L(`在${RG(r.mouthRegion)}入海`, `reaches the sea in ${RG(r.mouthRegion)}`) : L("流出图幅", "leaves the map"), passes: r.regions.map(x => REGION_ZH[x]) })),
    lakes: W.hy.lakes.map(l => ({ id: l.id, name: l.name, region: REGION_ZH[l.region] })),
    mountains: W.spec.mountains.map(m => ({ id: m.id, name: m.name, region: REGION_ZH[m.region] })),
    pairs,
    geography_notes: `accessibility 0-1 = how easily terrain is crossed; defensibility 0-1 = commanding height or choke point; road_centrality = share of road through-traffic; hinterland_cells = land cells within 1.5 days (1 cell = ${kmOf(W)} km)`,
  };
}
const FLAVOR_EN = {
  port: ["the salt fog never lifts, and the dock lamps sway on windless nights", "fishing boats and smugglers share one jetty, and nobody counts the boats"],
  city: ["the clock tower always strikes one time too many", "the lanes inside the old wall follow a strange geometry nobody remembers designing"],
  town: ["the waterwheel never stops, and the miller swears the river is heavier than it was ten years ago", "the market meets every tenth day, and strangers always leave after it closes"],
  village: ["the boundary stone at the gate is carved with signs no one can read", "villagers shut every window facing the hills before sunset"],
  fortress: ["the stone fort guards the pass, and its roll lists more men than its barracks hold", "the beacon on the tower has not been lit in years"],
};
const FLAVOR = {
  port: ["咸雾终年不散，码头上的灯常在无风的夜里摇晃", "渔船与走私船共用同一段栈桥，镇上的人从不数船"],
  city: ["钟楼整点敲响时总会多出一声", "旧城墙内的街巷按奇怪的几何图形排列，没人记得是谁设计的"],
  town: ["水车日夜不停，磨坊主坚称河水比十年前更重了", "集市每旬一次，外乡人总在散市后才离开"],
  village: ["村口的界石刻着无人能读的符号", "村民在日落前关好所有朝山的窗户"],
  fortress: ["石砌要塞守着山口，守军名册上的人比营房里的多", "塔楼的烽火已经很多年没有点过"],
};
function nearestOther(W, s) {
  let best = null, bd = 1e9; const [x, y] = W.P.pos[s.id];
  for (const o of W.spec.settlements) { if (o.id === s.id) continue; const [ox, oy] = W.P.pos[o.id]; const d = Math.hypot(ox - x, oy - y); if (d < bd) { bd = d; best = o; } }
  return best ? { o: best, straight: bd } : null;
}
function scriptedLoreEntry(W, s, k, mode) {
  const f = settlementFacts(W, s); const bits = []; const claims = [];
  bits.push(L(`[[${s.id}]]位于${RG(f.region)}，${FLAVOR[s.type][k % 2]}。`, `[[${s.id}]] lies in ${RG(f.region)}; ${FLAVOR_EN[s.type][k % 2]}.`));
  claims.push({ type: "in_region", s: s.id, region: f.region });
  if (f.coastal && f.river) { bits.push(L(`[[${f.river}]]在城边汇入大海。`, `The [[${f.river}]] meets the sea at its edge.`)); claims.push({ type: "coastal", s: s.id }, { type: "on_river", s: s.id, river: f.river }); }
  else if (f.coastal) { bits.push(L("镇子正对着灰色的海。", "It faces a grey sea.")); claims.push({ type: "coastal", s: s.id }); }
  else if (f.river) { bits.push(L(`[[${f.river}]]从镇旁流过。`, `The [[${f.river}]] runs past it.`)); claims.push({ type: "on_river", s: s.id, river: f.river }); }
  if (f.lakeside) { bits.push(L("镇外的湖面在冬天也不结冰。", "The lake beyond it never freezes, even in winter.")); claims.push({ type: "lakeside", s: s.id }); }
  if (f.near_mountains.length) { bits.push(L(`背后是[[${f.near_mountains[0]}]]的阴影。`, `Behind it lies the shadow of [[${f.near_mountains[0]}]].`)); claims.push({ type: "near_mountain", s: s.id, mountain: f.near_mountains[0] }); }
  bits.push(L(`四周是${BIOME_ZH[f.biome]}。`, `All around is ${BIOME_ZH[f.biome]}.`)); claims.push({ type: "biome", s: s.id, biome: f.biome });
  const no = nearestOther(W, s);
  if (no) {
    const days = mode === "draft" ? Math.round(no.straight * kmOf(W) / KM_PER_DAY * 2) / 2 : travelDays(W, s.id, no.o.id);
    if (days != null) { bits.push(L(`去往[[${no.o.id}]]约需 ${days} 天，路在${dirOf(W, no.o.id, s.id)}方。`, `[[${no.o.id}]] is about ${days} days away, to the ${dirOf(W, no.o.id, s.id)}.`)); claims.push({ type: "travel_days", a: s.id, b: no.o.id, days }, { type: "direction", a: no.o.id, b: s.id, dir: dirOf(W, no.o.id, s.id) }); }
    const sep = W.spec.mountains.find(m => crossesMountain(W, s.id, no.o.id, m.id));
    if (sep) { bits.push(L(`两地之间隔着[[${sep.id}]]。`, `[[${sep.id}]] stands between them.`)); claims.push({ type: "separated_by", a: s.id, b: no.o.id, mountain: sep.id }); }
  }
  return { id: "E" + (k + 1), subject: s.id, title: `${s.name}`, text: bits.join(L("", " ")), claims, lang: LANG, scripted: mode };
}
function scriptedLore(W, mode) { return W.spec.settlements.map((s, k) => scriptedLoreEntry(W, s, k, mode)); }

// ---------- random worlds (offline) ----------
// A whole WorldSpec drawn from a seed, so the offline demo can show the generator's range without a model.
function randomSpec(seed) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)], wpick = o => { let t = r() * Object.values(o).reduce((a, b) => a + b, 0); for (const [k, w] of Object.entries(o)) if ((t -= w) <= 0) return k; return Object.keys(o)[0]; };
  const EN_SUF = { 城: "", 港: " Harbour", 镇: "", 村: "", 堡: " Keep", 山: " Hills", 岭: " Ridge", 脊: " Spine", 峰: " Peaks", 山脉: " Mountains", 之地: " Lands", 王国: " Kingdom", 边境: " March", 诸邦: " Reaches", 古国: " Realm", 河: " River", 江: " River", 水: "water", 溪: " Brook", 川: " Run", 湖: "Lake ", 泊: " Mere", 潭: " Tarn", 海子: " Water" };
  const used = new Set(), nm = (suf, two) => {
    if (LANG === "en") {
      for (let t = 0; t < 40; t++) {
        const base = pick(NAME_EN_A) + (suf === "城" || suf === "镇" || suf === "村" || two ? pick(NAME_EN_B) : pick(NAME_EN_B));
        const e = EN_SUF[suf] ?? "", n = e.endsWith(" ") ? e + base : base + e;
        if (!used.has(n)) { used.add(n); return n; }
      }
      return pick(NAME_EN_A);
    } for (let t = 0; t < 40; t++) { const a = pick(HAMLET_A), b = pick(HAMLET_A), n = ((two || r() < 0.7) && a !== b ? a + b : a) + suf; if (!used.has(n)) { used.add(n); return n; } } return pick(HAMLET_A) + suf; };
  const landform = pick(LANDFORMS);
  const sea = LANDFORM_SIDE[landform] !== "none";
  const ocean_side = ["coast", "fjords", "peninsula", "bay"].includes(landform) ? pick(["E", "W", "N", "S"])
    : landform === "two_coasts" ? pick(["NE", "NW", "SE", "SW", "NS", "EW"]) : LANDFORM_SIDE[landform];
  const temperature = wpick({ polar: 1, cold: 2, temperate: 4, warm: 2, hot: 2 }), humidity = wpick({ arid: 1, dry: 2, normal: 4, humid: 2 });
  const era = wpick({ medieval: 5, modern: 2, future: 1.5, alien: 1.5 });
  const wseed = Math.floor(r() * 99999) + 1;
  const land = landByRegion({ landform, ocean_side, seed: wseed });
  const landR = REGIONS.filter(q => land[q] >= 0.35), onLand = landR.length ? landR : REGIONS;
  const mountains = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ name: nm(pick(["山", "岭", "脊", "峰", "山脉"]), true), region: pick(onLand), angle: Math.floor(r() * 180), length: pick(["short", "medium", "long", "long"]) }));
  const types = ["city", "town", "town", "village", "village", "village", "fortress"].concat(sea ? ["port", "port"] : []);
  const SUF = { city: "城", port: "港", town: "镇", village: "村", fortress: "堡" };
  const settlements = Array.from({ length: 8 + Math.floor(r() * 7) }, (_, k) => {
    const type = k === 0 ? "city" : pick(types), req = [];
    if (type === "port") req.push("coast");
    else if (type === "fortress") req.push(pick(["defensible", "near_mountain"]));
    else { const q = pick(["on_river", "on_river", "accessible", "near_mountain", null].concat(sea ? ["coast"] : [], landform === "lakeland" ? ["lakeside", "lakeside"] : [])); if (q) req.push(q); }
    return { name: nm(SUF[type]), type, region: pick(onLand), requires: req };
  });
  return {
    name: nm(pick(["之地", "王国", "边境", "诸邦", "古国"]), true), seed: wseed, landform, ocean_side, wind_from: pick(["E", "W", "N", "S"]),
    scale: wpick({ region: 4, kingdom: 3.5, continent: 2.5 }), climate_zone: { temperature, humidity },
    mountains, min_major_rivers: 1 + Math.floor(r() * 3), min_lakes: landform === "lakeland" ? 3 : Math.floor(r() * 2),
    settlements, hamlets: pick(["sparse", "normal", "normal", "dense"]),
    names: { rivers: Array.from({ length: 10 }, () => nm(pick(["河", "江", "水", "溪", "川"]))), lakes: Array.from({ length: 6 }, () => nm(pick(["湖", "泊", "潭", "海子"]))) },
    style: { era },
  };
}
// share of each 3x3 region that a landform's recipe puts on land (coarse, ignores coastline noise)
function landByRegion(spec) {
  if (!spec.landform) return Object.fromEntries(REGIONS.map(r => [r, 1]));
  const rec = landformRecipe(spec, spec.seed), cnt = {}, G = 30;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const u = (x + 0.5) / G, v = (y + 0.5) / G, reg = regionOf(u * N, v * N);
    cnt[reg] = (cnt[reg] || 0) + (seaDistance(rec, u, v) < COAST_D ? 1 / (G * G / 9) : 0);
  }
  return cnt;
}
// a readable summary of a spec, used as the description of a random world
function describeSpec(sp) {
  if (LANG === "en") {
    const s = normalizeSpec(sp), T = { polar: "polar", cold: "cold", temperate: "mild", warm: "warm", hot: "hot" }, H = { arid: " and arid", dry: " and dry", normal: "", humid: " and humid" };
    const sc = { region: "about 1024 km across", kingdom: "a kingdom-scale land about 2048 km across", continent: "a continent-scale land about 4096 km across" }[s.scale || "region"];
    const cz = s.climate_zone ? `${T[s.climate_zone.temperature]}${H[s.climate_zone.humidity]}` : "mild";
    const side = { E: "east", W: "west", N: "north", S: "south" };
    return `${s.name}: ${sc}, a ${LANDFORM_ZH[s.landform] || "coast"} with a ${cz} climate; the wind blows from the ${side[s.wind_from]}. `
      + `Mountains: ${s.mountains.map(m => `${m.name} in ${RG(m.region)}`).join(", ")}. `
      + `At least ${s.min_major_rivers} major rivers${s.min_lakes ? ` and ${s.min_lakes} lakes` : ""}. `
      + s.settlements.map(t => `${t.region ? `In ${RG(t.region)}, ` : ""}the ${TYPE_ZH[t.type]} ${t.name}${t.requires.length ? ` (${t.requires.map(q => REQ_ZH[q]).join(", ")})` : ""}`).join("; ") + ".";
  }
  const s = normalizeSpec(sp), T = { polar: "极寒", cold: "寒冷", temperate: "温和", warm: "温暖", hot: "炎热" }, H = { arid: "干旱", dry: "偏干", normal: "", humid: "湿润" };
  const sc = { region: "约 1024 km 见方", kingdom: "约 2048 km 见方的王国尺度", continent: "约 4096 km 见方的大陆尺度" }[s.scale || "region"];
  const cz = s.climate_zone ? `${T[s.climate_zone.temperature]}${H[s.climate_zone.humidity]}` : "温和";
  const side = { E: "东", W: "西", N: "北", S: "南" };
  return `${s.name}：${sc}的${LANDFORM_ZH[s.landform] || "海岸"}，气候${cz}，风从${side[s.wind_from]}方吹来。`
    + `山脉有${s.mountains.map(m => `${RG(m.region)}的「${m.name}」`).join("、")}。`
    + `至少 ${s.min_major_rivers} 条大河${s.min_lakes ? `、${s.min_lakes} 个湖泊` : ""}。`
    + s.settlements.map(t => `${RG(t.region)}有${TYPE_ZH[t.type]}「${t.name}」${t.requires.length ? `（${t.requires.map(q => REQ_ZH[q]).join("、")}）` : ""}`).join("；") + "。";
}

if (typeof module !== "undefined") module.exports = { setLangCore: l => { LANG = l; }, mapStats, layeredScore, compareScore, rankScore, scoreText, CHAR_METRICS, LANDFORMS, LANDFORM_ZH, SCALES, hamlets, randomSpec, describeSpec, N, NN, normalizeSpec, initParams, derive, verify, applyActions, scriptedStructured, scriptedBlind, scriptedLore, scriptedLoreEntry, mapFacts, checkClaim, REGION_ZH, cellXY, regionOf , geoProfile, geoFields, roadCentrality, hinterland, dominatesDownstream};
// ===================== END CORE =====================

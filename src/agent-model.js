// Shared planner, relations, critique, repair and negotiation prompts.
const SPEC_SCHEMA = () => `{"name": string, "seed": integer,
 "landform": "coast"|"continent"|"archipelago"|"islands"|"peninsula"|"isthmus"|"inland_sea"|"fjords"|"volcanic_island"|"shattered"|"lakeland"|"highland"|"plains"|"basin"|"bay"|"two_coasts",
 "ocean_side": "E"|"W"|"N"|"S"|"NE"|"NW"|"SE"|"SW"|"NS"|"EW"|"all"|"none", "wind_from": "E"|"W"|"N"|"S",
 "scale": "region"|"kingdom"|"continent",
 "climate_zone": {"temperature": "polar"|"cold"|"temperate"|"warm"|"hot", "humidity": "arid"|"dry"|"normal"|"humid"},
 "mountains": [{"name": string, "region": R, "angle": 0-179, "length": "short"|"medium"|"long", "invented": boolean}],
 "min_major_rivers": 0-6, "min_lakes": 0-4,
 "settlements": [{"name": string, "type": "port"|"city"|"town"|"village"|"fortress", "region": R,
                  "requires": subset of ["coast","river_mouth","on_river","lakeside","near_mountain","accessible","defensible"],
                  "proposed": subset of "requires" — the ones YOU inferred rather than read,
                  "invented": true if the description never mentions this settlement,
                  "rationale": short ${LANGN()} sentence saying why the proposed ones follow}],
 "character": [{"metric": M, "level": "none"|"low"|"moderate"|"high"|"dominant", "why": short ${LANGN()} reason}
               | {"metric": "islands", "min": integer, "max": integer, "why": ...}],
 "names": {"rivers": [8-12 names], "lakes": [4-8 names], "places": [30-50 hamlet names]},
 "hamlets": "none"|"sparse"|"normal"|"dense",
 "style": {"era": "medieval"|"modern"|"future"|"alien", "street_pattern": "organic"|"grid"|"radial"|"ring"|"terraced",
           "block_scale": 0.5-2, "building_height": 0.5-4, "walls": "always"|"never"|"auto",
           "landmarks": subset of ["plaza","cathedral","church","chapel","cityhall","market","hospital","clinic","school","library","station","factory","keep","lighthouse"]}}
R is one of NW, N, NE, W, C, E, SW, S, SE (a 3x3 grid, north is up). The map is a 512 x 512 grid; "scale" sets how much
ground it covers: region = 1024 km across (a province), kingdom = 2048 km, continent = 4096 km.

landform — the shape of land and sea, drawn fresh from the seed each time:
  coast: mainland with the sea on ocean_side, bays and offshore islets
  continent: one island continent with sea on every side (Australia) — about the sea, not about size or scale
  bay: mainland with the sea on ocean_side and one large gulf reaching deep inland through a narrower mouth
  two_coasts: sea on two sides — a corner of land (ocean_side NE, NW, SE, SW) or a strip between two seas (NS, EW)
  archipelago: many islands · islands: two or three large islands · peninsula: a long arm of land into the sea
  isthmus: two landmasses joined by a narrow neck · inland_sea: land around an enclosed sea with one strait out
  fjords: a mountainous coast cut by long narrow inlets · volcanic_island: one island around a volcanic peak
  shattered: a landmass broken by winding straits
  Landlocked, no sea anywhere on the map:
  plains: low, flat, open interior (steppe, prairie, farmland) · lakeland: dotted with many lakes
  basin: a lowland ringed by mountains that drains out through one gorge (Sichuan, Tarim)
  highland: a raised plateau split by a rift valley — high ground runs cold and rugged, so pick it only for uplands
mountains.angle — the direction a range runs, in degrees: 0 = east-west, 90 = north-south, 45 = from NW to SE... any value.
climate_zone shifts the whole map: hot+humid gives jungle, hot+arid desert and savanna, polar gives ice and tundra.
character — measurable expectations about the map as a whole. M is one of:
  land_share (land / whole map) · lake_share · mountain_share · desert_share (desert + salt flat) · grass_share
  (grassland, steppe, savanna) · forest_share · cold_share (ice, tundra, snow) · wetland_share — each a share of the land —
  and islands (number of separate landmasses, small islets included). Levels: none ≤ 2%, low ≤ 15%, moderate 10–40%,
  high ≥ 35%, dominant ≥ 55%. The checks allow some slack (about 5 points on a share, a few extra islets on a count),
  so pick the level that reads right instead of aiming at a boundary, and give islands a range, not one number.
  Typical values: a temperate coast is ~60-80% land with lake_share ~2-5%; lakeland lake_share 10-20%; an archipelago
  has 5-12 landmasses and land_share 25-45%.

What the checkable requirements mean:
  coast / river_mouth / on_river / lakeside / near_mountain — the site is next to that feature
  accessible  — the site sits in an easily traversed corridor (terrain permeability over its neighbourhood is in the top third)
  defensible  — the site commands its surroundings or holds a choke point (top ~15% of terrain)
  (relations between settlements are proposed later, once the rivers and roads actually exist)`;

async function llmPlan(desc, item) {
  const prompt = `You turn a worldbuilding description into a WorldSpec for a procedural map generator. The map should
read as a real, inhabited, distinctive place — something that sparks the reader's imagination — not a generic square of land.

Reply with only one JSON object of this shape:
${SPEC_SCHEMA()}

You do five jobs at once. Do the first one first: everything after it must serve it.

0. OVERALL CHARACTER — before any place, decide what this world is like as a whole and write 2-4 "character"
   expectations that the description states or clearly implies and a reader would check at a glance: a desert empire is dominated by
   desert and has almost no lakes; a Viking archipelago has many islands and a cold climate; a jungle kingdom is
   mostly forest. Each needs a ${LANGN()} "why". Leave out what the description is silent on: "a grassland realm"
   implies grass dominates, not that forests, lakes and deserts must each stay low. Every expectation is a rule the
   generator must obey, so a few that matter leave it room to make a varied, believable map; a long list of guesses
   boxes it in. These rank ABOVE every site constraint: when a town's requirement
   would break the world's character (a lakeside town in a desert with no lakes), the town gives way, not the world.
   Then choose landform, climate_zone and scale so that the character holds.

1. HARD CONSTRAINTS — encode everything the description states, faithfully. These are the author's and are never
   marked invented or proposed.

2. INVENTION — the description may be one sentence. Fill the world out so it is rich and specific to THIS prompt:
   - Choose the landform, scale, climate_zone, wind and seed that best fit the mood and setting, and vary them between
     prompts; a desert empire, a frozen archipelago and a river delta should look nothing alike. If the description
     implies size ("an empire", "a continent", "a whole kingdom"), use a larger scale; a valley or county stays "region".
   - Bring the map to roughly 8-16 named settlements and 2-5 mountain ranges in total, adding what the setting
     implies (a capital, its ports, frontier forts, mining towns, holy sites, trading posts). Mark each added
     settlement and range "invented": true; give every invented settlement at least one requirement so it sits
     somewhere meaningful, and a ${LANGN()} rationale. Never contradict or crowd out what the author wrote: if the author
     lists many places, add fewer.
   - Write names in the description's language with one consistent naming culture that fits the setting (Nordic,
     desert, East Asian, Celtic, alien...). Supply "names": river, lake and hamlet name pools in that same culture.
     Set "hamlets" to "normal" unless the setting is empty wilderness ("sparse") or crowded heartland ("dense").

3. PROPOSED CONSTRAINTS — add the geographic conditions that the description *implies* for the author's own
   settlements but does not state, and list them in "proposed" with a one-line ${LANGN()} "rationale":
     a prosperous trading town needs "accessible" — wealth follows traffic, and a town walled in by mountains cannot trade
     a border fortress needs "defensible" — it exists to hold ground
     a mill town belongs on a river; a fishing village belongs on the coast
   Use on_river and river_mouth sparingly: only for a settlement whose role depends on a river (mill, ferry, river port,
   irrigated fields) or that the description puts on one — about a third of the settlements at most. Give invented
   settlements other requirements where they fit just as well (accessible, near_mountain, coast, defensible).
   Propose only what the seven checkable site predicates can express. Do NOT propose relations between settlements
   here: the rivers and roads do not exist yet. Atmosphere ("常年有雾", "闹鬼的矿镇") is NOT a constraint.
   Proposed and invented items are relaxed before explicit ones when something is impossible, so a guess is cheap.

4. STYLE PROFILE — read the era and culture off the description and fill "style". This drives how towns are drawn,
   never where things go: a medieval town is organic with walls and a cathedral; a modern city is a grid with a station,
   hospital and factories, taller buildings and no walls; a future or alien settlement can be radial or terraced with
   much taller structures. Pick "landmarks" as the vocabulary that fits that world.

Rules:
- Land and sea come from what the description says about the sea. If it names no sea, use a landlocked template
  (plains, basin, lakeland, highland) when it says inland, and otherwise coast, bay or two_coasts with the sea on the
  side that fits the setting. Put sea on every side (continent, islands, archipelago, volcanic_island, isthmus,
  shattered) only when the description says so: an island, an island realm, a land surrounded by ocean. An empire, a
  large country or scale "continent" is not a reason for it.
- ocean_side must agree with the landform: "all" for islands, archipelagos, continents and other sea-ringed shapes,
  "none" for plains, basin, lakeland and highland, the sea side for coast, bay, fjords and peninsula, and the two
  sides for two_coasts.
- A description that says the land is inland, landlocked or far from the sea ("内陆", "深居内陆", "不靠海") needs a
  landlocked landform; "continent" is NOT inland, it is an island continent ringed by sea. Inland grassland, steppe or
  farmland is "plains" unless the description asks for highlands or many lakes.
- A port, or anything that requires "coast", needs a landform with sea. Settlement regions must be places the
  landform puts land (on an archipelago the centre may be open sea).
- Small islands are low and open: "accessible" (a corridor through hard country) and "defensible" (a commanding
  height) rarely hold there, so on archipelagos and small islands prefer coast, river_mouth and on_river for the
  settlements you invent. Set min_lakes above 0 only when the description names lakes or the landform is lakeland.
- "lakeland" means a country of many large lakes (Finland, Canadian shield). A desert with oases is NOT lakeland: use
  plains, basin, highland, coast or bay with an arid climate_zone; the generator's water balance then keeps only small lakes
  (the oases) and dries the rest of each basin into salt flats. Oasis towns can require "lakeside" or "on_river".
- min_major_rivers follows the description: the number it names, otherwise 1 for deserts and arid or dry lands, 2 for a
  temperate land, 3 or more only when the description stresses rivers. Every extra river the map must have pushes the
  generator to thicken the whole river network.
- At most 8 mountains and 20 settlements; seed is any integer from 1 to 99999.
- If the description asks for something impossible (a port in a landlocked region), keep it anyway: the verifier
  will find the conflict and report it. Never quietly fix the user's intent.

Description:
"""${desc.slice(0, 3000)}"""`;
  return llmJSON(prompt, L("规划 WorldSpec", "planning the WorldSpec"), item);
}

// Stage 2': propose relations once the map exists, so upstream/downstream and travel times are grounded in fact.
async function llmRelations(W, item) {
  const facts = mapFacts(W);
  const prompt = `A regional map has just been generated from a worldbuilding description. Propose the geographic
relations between settlements that the world implies and that the map can actually support.

Two relation types are checkable:
  {"type":"downstream_of","a":"S3","b":"S1"}                 water leaving b flows past a (b can foul or cut a's water)
  {"type":"within_days_of","a":"S5","b":"S1","days":4}       a is at most that many days of travel from b

Scale: the map is ${kmOf(W) * N} km across, travel is 32 km/day over slope-weighted paths, so crossing the whole region takes
about ${Math.round(kmOf(W) * N / 32)} days. The facts below already contain the measured travel days for every pair, which rivers each settlement
sits on, and each site's accessibility, defensibility, road centrality and hinterland size.

Rules:
- Ground every proposal in the facts. If two settlements are not on the same river system, do not propose a
  downstream relation between them.
- For "within_days_of", set "days" close to (and not below) the measured travel time of the pair, so the relation
  records a real dependency rather than forcing the settlements together. Only propose it where the world implies a
  dependency: a satellite village and its market town, a fortress and the capital it guards, a mine and its smelter.
- Propose at most 4 relations. Fewer is better. Skip anything the map does not support.
- Each needs a one-line ${LANGN()} "rationale" that cites the fact it rests on.

Facts:
${JSON.stringify(facts)}

Reply with only JSON: {"relations":[{"type":..., "a":"S1", "b":"S3", "days":4, "rationale":"..."}]}`;
  const out = await llmJSON(prompt, L("提议地缘关系", "proposing relations"), item);
  const ids = new Set(W.spec.settlements.map(s => s.id));
  return (Array.isArray(out.relations) ? out.relations : []).filter(r => r && ids.has(r.a) && ids.has(r.b) && r.a !== r.b)
    .slice(0, 4).map(r => ({ ...r, source: "proposed" }));
}
function regionSummary(W) {
  const o = {};
  for (const r of REGIONS) o[r] = { land_pct: 0, peak_rel_elev: 0, mountain_cells: 0, rivers: new Set(), sea_mouths: 0, lakes: 0, settlements: [] };
  for (let i = 0; i < NN; i++) {
    const [x, y] = cellXY(i), g = o[regionOf(x, y)];
    if (W.ocean[i]) continue;
    g.land_pct++; const rel = W.h[i] - W.P.sea; g.peak_rel_elev = Math.max(g.peak_rel_elev, rel); if (rel > MOUNTAIN_REL) g.mountain_cells++;
    if (W.hy.channel[i] && !W.hy.lake[i]) { const r = W.hy.riverOfSys.get(W.hy.sys[i]); if (r) g.rivers.add(r.id); }
  }
  W.hy.lakes.forEach(l => o[l.region].lakes++);
  W.hy.rivers.forEach(r => { if (r.kind === "sea") o[r.mouthRegion].sea_mouths++; });
  for (const s of W.spec.settlements) o[regionOf(...W.P.pos[s.id])].settlements.push(s.id);
  const area = (N / 3) ** 2;
  for (const r of REGIONS) { const g = o[r]; g.land_pct = Math.round(g.land_pct / area * 100); g.peak_rel_elev = +g.peak_rel_elev.toFixed(2); g.rivers = [...g.rivers]; }
  return o;
}

async function llmRepair(W, rep, hist, fb, item) {
  const params = {
    sea_level: +W.P.sea.toFixed(2), hydrology: W.P.hydro, climate: W.P.climate, river_threshold: W.P.riverThr, river_threshold_floor: riverFloor(W.P, W.spec, W),
    water_per_cell: (runoffOf(W.P, W.P.cz !== undefined ? W.P.cz : W.spec.climate_zone, kmOf(W)) || { q: "0.3 + moisture (no climate set)" }).q,
    ridges: W.P.ridges.map(r => ({ region: r.region, orientation: r.orientation, amp: +r.amp.toFixed(2) })),
    basins: W.P.basins.map(b => b.region), declared_unsatisfiable: W.P.unsat,
    landform: W.P.landform !== undefined ? W.P.landform : W.spec.landform || "coast (default)",
    climate_zone: (W.P.cz !== undefined ? W.P.cz : W.spec.climate_zone) || { temperature: "temperate", humidity: "normal" },
    map_stats: mapStats(W),
    relaxed_constraints: (W.P.relaxed || []).map(r => ({ settlement: r.sid, was: r.item, now: r.to, why: r.reason })),
    settlement_regions: Object.fromEntries(W.spec.settlements.map(s => [s.id, regionOf(...W.P.pos[s.id])])),
    layered_score: Object.fromEntries(["character", "nature", "detail"].map((k, j) => [k, layeredScore(W, rep)[j]])),
    // passing character checks within 3 points of failing: the agent sees only failures otherwise, and kept breaking these
    near_limits: rep.checks.filter(c => c.code === "character" && c.status === "pass" && c.margin <= 3).map(c => ({ id: c.id, check: c.label, measured: c.measured, points_left: c.margin })),
  };
  const feedback = fb === "structured"
    ? "Structured verifier report (failed checks only):\n" + JSON.stringify(rep.fails.map(f => ({
        id: f.id, code: f.code, target: f.target, region: f.region, requirement: f.req, item: f.item,
        source: f.source, relaxed: f.relaxed || undefined, check: f.label, measured: f.measured, claim: f.claim, why: f.why,
        conflict: f.conflict ? { core: f.conflict.core, reason: f.conflict.reason } : undefined,
      })), null, 0)
    : "Verifier verdict: FAIL. No further detail is available in this condition.";
  const history = hist.slice(-3).map((h, k) => ({ round: hist.length - Math.min(3, hist.length) + k + 1, actions: h.actions, results: h.results.map(r => `${r.a.tool}: ${r.ok ? "ok" : "failed"} — ${r.msg}`),
    ...(h.score ? { score_before: h.score[0], score_after: h.score[1], kept: h.kept } : {}) }));
  const prompt = `You are the repair agent in a regional-map generation loop. The generator is procedural; you can only change it through the tools below. After your actions the map is rebuilt and verified again.

WorldSpec:
${JSON.stringify(W.spec)}

Current generator state:
${JSON.stringify(params)}

Per-region map summary (3x3 grid):
${JSON.stringify(regionSummary(W))}

${feedback}

Previous rounds:
${history.length ? JSON.stringify(history) : "none"}

Tools:
${TOOL_DOC}

Reply with only JSON: {"analysis": "one or two sentences in ${LANGN()} explaining your plan", "actions": [{"tool": "<name>", "args": {...}}], "stop": false}
HOW A ROUND IS JUDGED: after your actions the map gets a layered score [character, nature, detail], lower is better,
compared layer by layer. character = how many points the whole-map shares miss their tolerated bands by, plus 50 if the
map has sea where the spec has none or the other way round. nature = physics and climate-vegetation failures (rivers
without outlet, rain shadow, towns in water or on cliffs, rainforest in a dry climate). detail = settlement sites,
relations, ranges, river and lake counts, weighted by source (author 1, proposed 0.5, invented ×0.6) and by how near
the miss is. A round that does not make an earlier layer worse is kept; changes under 1 / 0.5 / 0.25 count as a tie.
A worse round is usually undone: it may still be kept by chance, less likely the more it costs (a character point
counts as one detail miss, a nature failure as two) and less likely in later rounds, and the run ends on the best
version seen anyway. An undone round keeps its settlement moves and declarations when they alone help. So fix
character first, usually with set_climate or set_landform, never trade it for a town, and leave "near_limits" checks
alone: they pass now but have only a few points left. If a town's requirement can only be met by breaking the world's
character (a lakeside town in a lakeless desert), call declare_unsatisfiable on that town's check with a reason naming
the character expectation; a declared detail still costs half its weight, and declaring a character or nature check
changes nothing in the score.
A check carrying a "conflict" has no candidate site under the current relaxed feasibility check; the negotiator handles possible trades, so avoid spending edits on that core until it has decided. Use the fewest edits that address the failures. Terrain and hydrology tools run before settlement moves within a round. If a move failed or kept a settlement outside its region, change the terrain (raise a ridge, carve a basin; lower the river threshold only if that region has no river at all) instead of repeating it. Use declare_unsatisfiable only with a concrete reason: the executor does not verify that declaration. Set "stop": true only when nothing useful is left to try.`;
  const out = await llmJSON(prompt, L("决定修正动作", "choosing repairs"), item);
  return { analysis: String(out.analysis || ""), actions: Array.isArray(out.actions) ? out.actions : [], stop: !!out.stop };
}

// Stage 1b: map review. The only stage that sees both the original description and the map as a whole. It compares
// them, adds character expectations the planner missed, and may change landform or climate before the repair loop
// starts; at the end it reviews again and only reports, which gives a description-fit score for the run.
function charSummary(W) {
  const st = mapStats(W), bc = {};
  let land = 0; for (let i = 0; i < NN; i++) if (!W.ocean[i]) { land++; bc[W.biome[i]] = (bc[W.biome[i]] || 0) + 1; }
  const biomes = Object.fromEntries(Object.entries(bc).sort((a, b) => b[1] - a[1]).filter(([, n]) => n / land >= 0.01).map(([b, n]) => [b, +(n / land).toFixed(2)]));
  return {
    landform: W.P.landform !== undefined ? W.P.landform : W.spec.landform || "coast (default)", ocean_side: W.spec.ocean_side, scale: W.spec.scale || "region",
    climate_zone: (W.P.cz !== undefined ? W.P.cz : W.spec.climate_zone) || { temperature: "temperate", humidity: "normal" },
    stats: st, biome_shares_of_land: biomes,
    settlements: W.spec.settlements.map(s => ({ name: s.name, type: s.type, region: regionOf(...W.P.pos[s.id]), biome: W.biome[posIdx(W, s.id)] })),
  };
}
async function llmCritique(W, desc, mode, item) {
  const final = mode === "final";
  const prompt = `You review a generated map against the worldbuilding description it was made from. Judge the WORLD AS A
WHOLE — its shape, climate, water, vegetation, relief — not individual town placements, which other checks handle.

Description:
"""${desc.slice(0, 3000)}"""

What the map actually is (shares are of the land unless named otherwise):
${JSON.stringify(charSummary(W))}

Character expectations already declared:
${JSON.stringify(W.spec.character || [])}

Ask: would a reader of the description recognise this map? A desert empire should be mostly desert, not a land of
big lakes; a frozen archipelago should be many cold islands; a river delta needs rivers and wetland.

Reply with only JSON:
{"fits": true|false, "score": 1-5 (5 = clearly the place described), "issues": ["short ${LANGN()} sentences, most important first"],
${final ? `"actions": []}` : `"add_character": [at most two character expectations the map should meet but nobody declared, same shape as above;
   add one only when the map clearly contradicts something the description says, not to pin down a share it never mentions:
   {"metric": ..., "level": ... | "min"/"max" for islands, "why": ${LANGN()}}],
 "actions": [{"tool": "<name>", "args": {...every argument the tool lists...}}] — tool calls that fix the world as a whole,
   from: set_landform, set_climate, raise_ridge, carve_basin, set_sea_level, set_river_threshold}

Tools:
${TOOL_DOC.split("\n").filter(l => /^(set_landform|set_climate|raise_ridge|carve_basin|set_sea_level|set_river_threshold)/.test(l)).join("\n")}

Change the landform or climate only when the current one clearly contradicts the description; an empty actions list is fine.
A landlocked world (ocean_side "none") stays landlocked: fix its biome shares with another landlocked template or the climate, never by adding sea.`}
Character metrics: ${Object.keys(CHAR_METRICS).join(", ")}; levels: none ≤ 2%, low ≤ 15%, moderate 10–40%, high ≥ 35%, dominant ≥ 55%,
checked with about 5 points of slack; islands counts small islets too, so give it a range.`;
  const out = await llmJSON(prompt, final ? L("终审：对照描述", "final review against the description") : L("审阅：对照描述", "review against the description"), item);
  return {
    fits: !!out.fits, score: clamp(Math.round(+out.score || 0), 0, 5), issues: (Array.isArray(out.issues) ? out.issues : []).map(String).slice(0, 6),
    add: final ? [] : normalizeCharacter(out.add_character, "critic").slice(0, 2),
    actions: final ? [] : (Array.isArray(out.actions) ? out.actions : []).filter(a => a && /^(set_landform|set_climate|raise_ridge|carve_basin|set_sea_level|set_river_threshold)$/.test(a.tool)).slice(0, 6),
  };
}

// Stage 2'': conflict resolution. A relaxed feasibility check found no candidate site under its current approximation;
// this stage decides which constraint to yield. The original description helps rank trades by authorial intent.
async function llmNegotiate(W, briefs, desc, item) {
  const prompt = `You are the negotiator in a regional-map generation loop. A relaxed feasibility check found no
candidate site for some settlements on the current map. This is an approximation, not proof that every possible tool
sequence would fail. Decide what to yield; the loop will rebuild and verify the map after the tools run.

The original description provides the author's intent:
<description>
${String(desc || "").slice(0, 2000)}
</description>

Each conflict below lists a deletion-minimal core under the current feasibility approximation. For every
item you get where it came from — "explicit" was written by the author, "proposed" was inferred by an earlier stage of
this same agent and carries the reason that stage gave — and "can_become": what the item may be traded for. Each option
carries two numbers: "cells_now" is how many sites satisfy it on the map as it stands, and "cells_after_tools" is how
many are estimated reachable after terrain changes (digging a lake, raising a ridge, lowering the river threshold).
An option with cells_now = 0 but cells_after_tools > 0 may require rebuilding terrain; the estimate is not a guarantee.
Some items carry "blocked_by_character": the world's overall character — decided first, and ranked above every site
constraint — keeps the feature this item needs scarce (few lakes, few mountains), so the feasibility estimate does not
assume building it for this town and its cells_after_tools counts only what the map already has. Such a conflict is between the town and the
world as a whole.
${JSON.stringify(briefs.map(b => ({ target: b.target, name: b.name, type: b.type, conflict: b.reason, checks: b.checks, core: b.core })), null, 0)}

Tool:
${RELAX_DOC}

Rules:
- Yield a "proposed" constraint before an "explicit" one. A proposed constraint is this agent's own guess about what
  the description implied; giving one up costs the author nothing. Say that plainly in the reason.
- You may relax an "explicit" constraint, but only when the description itself supports the trade, and the reason must
  name the words it rests on. Wanting the loop to converge is not a reason.
- Prefer a swap over a drop wherever "can_become" offers one. A port that cannot reach the sea is still a port if it
  sits on a river, and that keeps more of the author's intent than deleting the requirement.
- When a core holds an item blocked_by_character, the world wins: yield that item, preferring a swap that keeps the
  town's role (an oasis town that needed a lake can take its water from a river). Only when the description itself
  explicitly demands that very feature for that very town may you keep it, by relaxing another item in the core or
  declaring the check unsatisfiable; name the words you rest on.
- Relax at most ONE item per conflict in this decision. The map will be rebuilt and checked again before any further trade.
- If every item in a core is explicit and the description gives you no ground to rank them, relax nothing and declare
  that conflict's checks unsatisfiable instead of guessing.

Reply with only JSON:
{"analysis": "one or two sentences in ${LANGN()} saying what you traded and why",
 "relaxations": [{"target": "S3", "item": "coast", "to": "on_river", "reason": "${L("中文一句", "one sentence")}"}],
 "declare": [{"check_id": "spec.req.S3.coast", "reason": "${L("中文一句", "one sentence")}"}]}
Use "to": null to drop an item outright. Leave either list empty when you have nothing to put in it.`;
  const out = await llmJSON(prompt, L("冲突让步决策", "negotiating the conflict"), item);
  const ids = new Set(briefs.flatMap(b => b.checks)), targets = new Set(briefs.map(b => b.target));
  const actions = [];
  for (const r of Array.isArray(out.relaxations) ? out.relaxations : []) {
    if (!r || !targets.has(r.target)) continue;
    actions.push({ tool: "relax_constraint", args: { target: r.target, item: String(r.item || ""), to: r.to == null ? null : String(r.to), reason: String(r.reason || "") } });
  }
  for (const d of Array.isArray(out.declare) ? out.declare : []) {
    if (!d || !ids.has(d.check_id)) continue;
    actions.push({ tool: "declare_unsatisfiable", args: { check_id: d.check_id, reason: String(d.reason || "") } });
  }
  return { analysis: String(out.analysis || ""), actions };
}

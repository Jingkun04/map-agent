# Region Map Agent

DSA4213 group-project demo: an agent turns a worldbuilding description into a regional map (1024 × 1024 km, 512 × 512 cells), a verifier checks physical and specification constraints, and the agent repairs the map through generator tools. Generated lore is checked claim by claim against the map, and settlements get procedural city plans with functional districts.

The whole app is one self-contained page: `dist/region-map-agent.html`. Open it in a browser (it loads three.js r128 and Google Fonts from CDNs; without three.js it falls back to the 2D map).

## Layout

| Path | Contents |
| --- | --- |
| `src/core.js` | Terrain (noise, ridges, valley carving, thermal erosion), climate, hydrology (D8 / priority-flood), biomes, verifier, conflict analysis and relaxation, repair tools, scripted policies, lore claims |
| `src/presets.js` | Four example WorldSpecs (coast, kingdom, island, contradictory landlocked port) |
| `src/city.js` | Regional road network (A* + MST) and settlement plans: districts, streets, blocks, buildings, landmarks, farmland; the style profile that drives them; 2D drawing |
| `src/gamemap.js` | Game-style map view: tilted orthographic render of the 3D scene, fog of war, grid, waypoint/POI icons, region and town zoom levels |
| `src/view3d.js` | three.js diorama: terrain mesh, water, city decals, instanced buildings, landmark models, camera controls |
| `src/ui.js` | Agent loop; model-backed planning, relation proposals, map review, negotiation, repair, final review and lore; panels, 2D rendering, edits |
| `src/template.html` | Page markup and CSS; `build.py` inlines the scripts at `/*__SCRIPT__*/` |
| `src/bench.js` | Test-set generator, trial runner with 20 metrics, conflict-core review export, fault-injection harness (shared by node and the browser) |
| `tests/` | Node tests for the core loop and city generation; Playwright screenshot script |

## Build and test

### Running the LLM stages locally (DeepSeek or OpenRouter)

```bash
cp .env.example .env      # put a DeepSeek key in DEEPSEEK_API_KEY
npm run serve             # builds, then serves http://localhost:8787
```

`server.js` holds the key and proxies `/api/llm` to DeepSeek when `DEEPSEEK_API_KEY` is set. Both tiers use
`deepseek-flash` by default. Thinking is disabled by default for predictable JSON and a small trial budget; set
`DEEPSEEK_THINKING=enabled` to test thinking separately. The server logs token usage and a peak/off-peak cost estimate
for each call in `history/api-usage.jsonl`. `.env` and `history/` are git-ignored. The proxy listens only on 127.0.0.1
and rejects cross-origin calls. To use OpenRouter instead, set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY`;
its default/quick tiers remain Sonnet 5.5 / Haiku 5.5.

### Experiments

```bash
node tests/benchmark.js 30 6 structured 0 30   # baseline, one feedback condition at a time (appends to results/baseline.csv)
node tests/benchmark.js 30 6 binary 0 30
node tests/benchmark.js 30 6 none 0 30
node tests/injection.js 10                     # verifier reliability (only injects into worlds the verifier calls clean)
node tests/benchmark.js 30 6 structured 0 30 negotiate   # same, with the conflict-resolution stage on (ablation)
```

In the page (claude.ai, Claude engine enabled), from the browser console:

```js
runBatch({n: 12, policy: "llm", feedback: "structured"})  // group A: same WorldSpec, agent vs rule baseline
runExtraction()                                           // group B: free text -> WorldSpec, which the baseline cannot do
```

`runBatch()` downloads a CSV using the benchmark columns. `runExtraction()` prints and returns extraction rows in the
browser console; its columns are different from the benchmark CSV.

The river-threshold injection now raises the threshold until the injected map actually has fewer major rivers than
the WorldSpec requires; `results/injection.csv` records the before/after counts, final threshold, and whether the
fault was created. In the page, names marked with `「」` in the description are checked against WorldSpec names after
planning. `runExtraction()` also reports `quoted_name_coverage` and missing names. This is a review hint: quoted text
is not necessarily a place name.
The rain-shadow verifier samples along each range's actual angle and compares land cells upwind and downwind. The
injection report records how many rain-shadow checks applied, and excludes worlds with none from that row's rate.
The verifier also reports below-sea terrain outside the edge-connected ocean, split into dry land, desert/salt flats,
and lake cells. This appears under Terrain diagnostics in the checks panel. Closed basins can be valid, so the diagnostic
does not change the violation count, pass rate, or repair score.

```bash
npm run build             # writes dist/region-map-agent.html
node tests/test_core.js   # scripted agent on every preset: violation trajectories, structured vs blind feedback
node tests/test_city.js   # roads and city plans: counts and timings
node tests/test_rain_shadow.js  # diagonal ridge and wind-direction geometry
node tests/test_subsea_land.js  # ocean-connected vs enclosed below-sea cells
npm install               # only needed for the screenshot script (local three.js)
node run-python.js -m pip install playwright
node run-python.js -m playwright install chromium
npm run screenshots -- 0  # built-in preset index 0-3
```

### T1 headless comparison

The `experiments/t1/` directory contains the G0 direct-map baseline, the G1 single-pass physical-repair baseline,
the full G2 pipeline, a shared map representation, independent scoring, rendering, a paired image judge, and resumable
batch runners. See [the T1 guide](experiments/t1/README.md) for the human-annotated protocol and
[the automated guide](experiments/t1/AUTOMATED.md) for the fixed programmatic corpus. The automated corpus and gold are
included as fixtures; its results are exploratory because the descriptions and gold come from the same rules and
have not been independently human-validated. Paid runs require a local `.env` key and an explicit `--max-usd` cap.

## Notes

- **Where each deployment runs.** The model stages need a model source, and the page tries three in order:
  1. **claude.ai artifact runtime** — `window.claude.use("sample")`, injected only when `dist/region-map-agent.html` is
     opened as an artifact.
  2. **Local proxy** — `npm run serve` (see above). `server.js` holds a DeepSeek or OpenRouter key from `.env`, and the page finds it via `/api/llm/health`.
  3. **Bring your own key** — anywhere else, including the GitHub Pages copy, the page shows an "OpenRouter API key"
     field. The key is checked against OpenRouter, kept only in that browser's `localStorage`, and sent only to
     `openrouter.ai`; "忘记" removes it. The repo and the published page never contain a key.

  With none of these the Claude radio stays disabled and only the offline scripted policies run.
- **What the offline demo still shows.** Terrain, climate and hydrology, the verifier, the repair loop, the conflict
  analysis and the rule-based negotiator, the city planner and every street pattern all run with no model at all. What
  it cannot show are model-based parsing of free text, relation proposals, map review and final review, conflict resolution,
  repair decisions, and lore writing.
- **Offline mode** is rule-based: it demonstrates the loop, not LLM ability.
- **Conflict resolution**: when a settlement's constraints have no candidate site under the current relaxed feasibility
  check, `minimalCore` in `src/core.js` computes a deletion-minimal core. `REACHABLE` relaxes some predicates but still
  uses the current map for terrain, rivers and travel, so this is a useful approximation, not a proof that every tool
  sequence would fail. `conflictBriefs` turns each core into the negotiator's input:
  every item with its provenance (`explicit` = written by the author, `proposed` = inferred by `llmPlan`, with the
  reason that stage gave) and what it could be traded for, each option carrying how many sites satisfy it now and how
  many would after the terrain tools do their best. `relax_constraint` then swaps a constraint for a weaker one or
  drops it; it refuses any item the solver did not put in a core, any swap that is not a weakening, and any call with
  no reason, so a constraint is only given up when the current feasibility check finds a conflict. The decision itself
  is a stage of its own — `llmNegotiate` in `src/ui.js` receives the original description because ranking two constraints
  is a question about authorial intent and the WorldSpec no longer contains all of it. Offline,
  `scriptedNegotiate` stands in and can only rank by provenance and room, which is the baseline the LLM stage is meant
  to beat. Relaxed checks stay on the report with their reason (`status: "relaxed"`), out of the failure count and out
  of the pass rate, so every trade is auditable. `runTrial` takes the stage as an option, so it can be ablated.
- **Style profile**: the intent layer (`llmPlan`) reads an era, a street pattern, block and building scale, a wall
  policy and a landmark vocabulary off the description, and `cityPlan` in `src/city.js` builds the town from them.
  `street_pattern` picks the road skeleton and what each district's block lattice lines up with — `organic` (noise-warped
  districts, each aligned to its nearest main road), `grid` (one lattice through the whole town), `radial` (extra spokes,
  blocks facing the centre), `ring` (concentric rings, blocks tangential), `terraced` (blocks follow the terrain contour).
  `era` fixes the landmark vocabulary, so a medieval town gets a cathedral and a keep while a modern one gets a station,
  a hospital and factories; a landmark outside the vocabulary is substituted by one with the same function or dropped.
  Nothing here touches geography: the style decides how a settlement is drawn, never where it is, and the verifier's
  checks are unchanged by it. Panel 4 has era / pattern / wall controls that re-plan the towns without re-running the agent.
- **World shape and invention**: from a one-line description the planner fills the world out instead of returning a
  near-empty spec. It picks a `landform` (coast, continent, archipelago, islands, peninsula, isthmus, inland sea, fjords,
  volcanic island, shattered, lakeland, highland — each a seeded recipe of land/sea/relief primitives in
  `landformRecipe`), a `scale`, a `climate_zone` (temperature × humidity, which shifts biomes up to ice, savanna and
  jungle), angled ranges, name pools for rivers, lakes and hamlets in one naming culture, and settlements up to 20.
  Everything the author did not write is marked `invented`: its constraints count as proposals, so the negotiator gives
  them up before anything explicit, and `compareSpecs` scores extraction on the author's items only. `hamlets(W)` adds
  unverified background villages so the map reads as inhabited. All of these fields are optional, and a spec without them
  derives bit-for-bit the same world as before, so the benchmark and `results/` stay reproducible.
- **History and export**: every finished run is saved (last 30). A record keeps the WorldSpec and generator params
  rather than the grids — a world is fully determined by those — plus the trace, lore and a thumbnail, so loading
  re-derives the same map. Under `npm run serve` records are files in `history/` (git-ignored; `HISTORY_MAX` in `.env`
  changes the cap), so a cleared or different browser loses nothing, and records left in a browser are moved there on
  first load. On a static host they stay in localStorage. 导出 / 导入 moves them as one JSON file; "保存平面图" exports the
  flat map as a PNG.
- **Language**: the header button switches the page between Chinese and English. Static text is translated by exact
  match; program text goes through `L(zh, en)`; name tables (regions, biomes, landforms…) are swapped in place by
  `setLang`. In English mode the model writes its rationales and lore in English. Trace entries written before a switch
  keep their language. Chinese output is byte-identical to before the switch was added. Lore entries remember the
  language they were written in; shown in the other language they are translated from that text by the model (one
  call for all entries, cached per entry and dropped if the source changes), or rebuilt from the template when they
  came from the offline writer. Translations are saved with the history record.
- **Random worlds**: the "随机世界" button draws a whole spec from a seed (`randomSpec`), so the offline page shows the
  same range without a model.
- **Scale**: the grid is always 512 × 512; `scale` sets 2 / 4 / 8 km per cell (region 1024 km, kingdom 2048 km,
  continent 4096 km) and makes terrain features proportionally finer. Settlements are drawn at an exaggerated,
  map-style scale (a city plan is about 28 cells across).
- **Scaling rule**: cell-based thresholds in `core.js` are tuned for N = 512. `SC = N / 256` scales most of them, but re-run `tests/test_core.js` after changing N.

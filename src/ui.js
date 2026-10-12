// ===================== UI =====================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// yield to the browser between steps; a hidden tab never fires animation frames, so fall back to a timer there
// (otherwise switching tabs mid-run would freeze the agent loop)
const frame = () => new Promise(r => document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => setTimeout(r, 0)));

const S = {
  spec: null, snaps: [], cur: -1, trace: [], lore: null, sample: null, running: false, ctl: null,
  focus: null, highlight: null, llmCalls: 0, t0: 0, elapsed: 0,
  layers: { base: "atlas", rivers: true, settle: true, marks: true, grid: true }, view: "3d",
};
const last = () => S.snaps[S.snaps.length - 1];
const curSnap = () => S.snaps[S.cur];
const engine = () => document.querySelector('input[name="engine"]:checked').value;

// ---------- Claude availability ----------
// Three sources can supply a model, tried in order:
//   1. the claude.ai artifact runtime (window.claude);
//   2. the local proxy in server.js, which keeps the OpenRouter key on the machine and serves /api/llm;
//   3. an OpenRouter key the viewer pastes in, kept only in this browser's localStorage and sent only to openrouter.ai.
// The last is what lets a static host (GitHub Pages) run the model stages without publishing a key.
const OR_API = "https://openrouter.ai/api/v1";
const OR_MODELS = { default: "anthropic/claude-sonnet-5.5", quick: "anthropic/claude-haiku-5.5" };   // keep in step with server.js
const OR_KEY_SLOT = "region-map-agent.openrouter-key";
const keyStore = {
  get() { try { return localStorage.getItem(OR_KEY_SLOT); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(OR_KEY_SLOT, v) : localStorage.removeItem(OR_KEY_SLOT); } catch {} },
};

function unlockModel(sample, models, msg) {
  S.sample = sample;
  $("#engClaude").disabled = false;
  if (!S.running) { $("#engClaude").checked = true; $("#tierWrap").hidden = false; }   // a prompt-first page wants the model by default
  $("#tier").options[0].text = `default（${models.default}）`;
  $("#tier").options[1].text = `quick（${models.quick}）`;
  $("#agentStatus").textContent = msg; $("#agentStatus").dataset.state = "ok";
}
function lockModel(msg) {
  S.sample = null;
  $("#engOff").checked = true; $("#engClaude").disabled = true; $("#tierWrap").hidden = true;
  $("#agentStatus").textContent = msg; $("#agentStatus").dataset.state = "off";
}
const NO_MODEL_MSG = "这个页面不在 claude.ai 的 artifact 运行时里，也没有连上本地代理。在下方填入 OpenRouter API key 即可解锁模型阶段；"
  + "不填就只跑离线脚本策略。";

(async () => {
  try {
    if (!window.claude || !window.claude.use) throw 0;
    const s = await window.claude.use("sample");
    if (!s) throw 0;
    S.sample = s;
    $("#engClaude").disabled = false;
    $("#agentStatus").textContent = "Claude 可用：切换到 Claude 后，规划、提议关系、冲突让步、修正和写设定都是真实模型调用（第一次调用会请求授权）";
    $("#agentStatus").dataset.state = "ok";
    return;
  } catch {}
  try {
    if (location.protocol === "file:") throw 0;
    const r = await fetch("api/llm/health", { cache: "no-store" });
    const h = r.ok && await r.json();
    if (!h || !h.ok) throw 0;
    unlockModel(openRouterSample(proxyPost), h.models,
      `本地 OpenRouter 代理可用：切换到 Claude 后，各阶段经 server.js 调用 ${h.models.default}，API key 只留在本机。`);
    return;
  } catch {}
  // A plain static host (GitHub Pages) or a file opened from disk: offer the key field.
  $("#keyWrap").hidden = false;
  lockModel(NO_MODEL_MSG);
  $("#orKeyUse").onclick = () => useKey($("#orKey").value.trim());
  $("#orKey").onkeydown = e => { if (e.key === "Enter") useKey($("#orKey").value.trim()); };
  $("#orKeyForget").onclick = () => {
    keyStore.set(null); $("#orKey").value = ""; $("#orKeyForget").hidden = true;
    $("#orKeyMsg").textContent = "已从这个浏览器删除 key。"; lockModel(NO_MODEL_MSG);
  };
  const saved = keyStore.get();
  if (saved) { $("#orKey").value = saved; useKey(saved); }
})();

// Check the key against OpenRouter before unlocking, so a typo surfaces here rather than mid-run.
async function useKey(key) {
  const msg = $("#orKeyMsg");
  if (!/^sk-or-/.test(key)) { msg.textContent = "这不像 OpenRouter 的 key（应以 sk-or- 开头）。"; return; }
  msg.textContent = "正在验证 key…"; $("#orKeyUse").disabled = true;
  try {
    const r = await fetch(`${OR_API}/key`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (r.status === 401) { msg.textContent = "OpenRouter 不认这个 key（无效或已被撤销）。"; return; }
    if (!r.ok) { msg.textContent = `验证失败（HTTP ${r.status}），稍后再试。`; return; }
    const d = (await r.json()).data || {};
    keyStore.set(key); $("#orKeyForget").hidden = false;
    const left = d.limit_remaining != null ? `剩余额度 $${(+d.limit_remaining).toFixed(2)}` : "无额度上限";
    msg.textContent = `key 有效，${left}。只保存在这个浏览器里，请求直接发往 openrouter.ai。`;
    unlockModel(openRouterSample(directPost(key)), OR_MODELS, `已用你的 OpenRouter key 解锁：切换到 Claude 后，各阶段直接调用 ${OR_MODELS.default}。`);
  } catch {
    msg.textContent = "连不上 openrouter.ai，检查网络后再试。";
  } finally { $("#orKeyUse").disabled = false; }
}

// Both transports return OpenRouter's SSE stream for one prompt.
function proxyPost(prompt, tier, signal) {
  return fetch("api/llm", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ prompt, tier }) });
}
function directPost(key) {
  return (prompt, tier, signal) => fetch(`${OR_API}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "region-map-agent" },
    body: JSON.stringify({ model: OR_MODELS[tier] || OR_MODELS.default, stream: true, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
  });
}

// Patch the two mistakes models make most in JSON: a bare double quote inside a string (Chinese prose quoting a word,
// "绿洲") and a trailing comma. A quote counts as closing only when the next non-space character could follow a string.
function repairJSON(t) {
  let out = "", inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr && c === "\\") { out += c + (t[i + 1] ?? ""); i++; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      let j = i + 1; while (j < t.length && /\s/.test(t[j])) j++;
      if (j >= t.length || ",:}]".includes(t[j])) { inStr = false; out += c; } else out += '\\"';
      continue;
    }
    if (inStr && (c === "\n" || c === "\r")) { out += c === "\n" ? "\\n" : ""; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

// The same json(prompt, {modelTier, signal, onText}) contract as window.claude's sampler, over an OpenRouter stream.
// Errors carry the codes llmJSON maps: cancelled, rate_limited, bad_key, invalid_json, or a plain status code.
function openRouterSample(post) {
  const fail = (code, detail) => { const e = new Error(detail || code); e.code = code; return e; };
  const parse = text => {
    const s = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
    try { return JSON.parse(s); } catch {}
    const a = s.search(/[{[]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    const body = a >= 0 && b > a ? s.slice(a, b + 1) : s;
    try { return JSON.parse(body); } catch {}
    try { return JSON.parse(repairJSON(body)); } catch (e) {
      console.warn("[llm] unparseable reply:", text);
      throw fail("invalid_json", String(e.message || e).slice(0, 120));
    }
  };
  return {
    async json(prompt, opts = {}) {
      let r;
      try { r = await post(prompt, opts.modelTier, opts.signal); }
      catch (e) { throw e && e.name === "AbortError" ? fail("cancelled") : fail("network"); }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const detail = d.detail || (d.error && (d.error.message || d.error));
        console.warn("[llm]", r.status, detail);
        throw fail(r.status === 429 || r.status === 402 ? "rate_limited" : r.status === 401 ? "bad_key" : `http_${r.status}`, detail);
      }
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = "", text = "";
      try {
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;          // ": OPENROUTER PROCESSING" keep-alives
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let ev; try { ev = JSON.parse(data); } catch { continue; }
            if (ev.error) throw fail(ev.error.code === 429 ? "rate_limited" : "upstream", ev.error.message);
            const d = ev.choices && ev.choices[0] && ev.choices[0].delta;
            if (d && d.content) { text += d.content; if (opts.onText) opts.onText({ text }); }
            if (ev.usage) console.debug(`[llm] ${ev.model} in=${ev.usage.prompt_tokens} out=${ev.usage.completion_tokens}`, ev.usage.cost != null ? `$${ev.usage.cost}` : "");
          }
        }
      } catch (e) { throw e && e.name === "AbortError" ? fail("cancelled") : e; }
      return parse(text);
    },
  };
}

// ---------- presets ----------
function initControls() {
  // example prompts: clicking one only fills the box. The four presets double as examples because each carries a
  // hand-written WorldSpec, which is what lets the offline engine run them (and what the experiments score against).
  $("#examples").innerHTML = EXAMPLES.map((e, k) => `<button type="button" data-k="${k}" title="${esc(e.text)}">${esc(e.label)}</button>`).join("");
  $("#examples").querySelectorAll("button").forEach(b => b.onclick = () => { $("#desc").value = EXAMPLES[+b.dataset.k].text; $("#desc").focus(); });
  $("#desc").value = PRESETS[0].text;
  $("#randomBtn").onclick = () => { newRandomWorld(); runAgent({ eng: "offline" }); };
  $("#layoutBtn").onclick = () => setWide(!document.body.classList.contains("wide"));
  let wide = true; try { wide = localStorage.getItem("region-map-agent.layout") !== "side"; } catch {}
  setWide(wide);
  for (const r of REGIONS) { $("#editR").add(new Option(REGION_ZH[r] + "部", r)); $("#ridgeR").add(new Option(REGION_ZH[r] + "部", r)); }
  document.querySelectorAll('input[name="engine"]').forEach(el => el.onchange = () => { $("#tierWrap").hidden = engine() !== "claude"; });
  $("#run").onclick = () => runAgent();
  $("#stop").onclick = () => { if (S.ctl) S.ctl.abort(); };
  $("#loreBtn").onclick = () => genLore();
  $("#moveBtn").onclick = () => editMove();
  $("#ridgeBtn").onclick = () => editRidge();
  $("#styleEra").onchange = () => { $("#stylePat").value = ERA_DEFAULT[$("#styleEra").value].street_pattern; };
  $("#restyleBtn").onclick = () => restyle();
  $("#rewriteBtn").onclick = () => rewriteStale();
  $("#obeyBtn").onclick = () => obeyLore();
  document.querySelectorAll("[data-layer]").forEach(el => el.onchange = () => {
    const k = el.dataset.layer; if (k === "base") S.layers.base = el.value; else S.layers[k] = el.checked; renderMap();
  });
  const cv = $("#map");
  cv.addEventListener("mousemove", e => {
    const sn = curSnap(); if (!sn) return;
    const r = cv.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * N), y = Math.floor((e.clientY - r.top) / r.height * N);
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    showCell(sn.W, x, y);
  });
  cv.addEventListener("mouseleave", () => { $("#readout").textContent = READOUT_HINT; });
  cv.addEventListener("click", e => {
    const sn = curSnap(); if (!sn) return;
    const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * N, y = (e.clientY - r.top) / r.height * N;
    let best = null, bd = 1e9;
    for (const s of sn.W.spec.settlements) { const [px, py] = sn.W.P.pos[s.id]; const d = Math.hypot(px + 0.5 - x, py + 0.5 - y); if (d < PLAN_R[s.type] * 1.1 && d < bd) { bd = d; best = s.id; } }
    if (best) selectCity(best);
  });
  $("#cityFly").onclick = () => { if (S.city) { setViewMode("3d"); flyTo(S.city); $("#view3d").scrollIntoView({ behavior: "smooth", block: "center" }); } };
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => setViewMode(b.dataset.view));
  $("#exag").oninput = e => { if (V3) { V3.exag = +e.target.value; if (S.view === "3d") update3D(); } };
  $("#camReset").onclick = () => { setView("oblique"); };
  $("#gmFog").onchange = e => { GM.fog = e.target.checked; renderGameMap(true); };
  $("#gmRedraw").onclick = () => renderGameMap(true);
  const gm = $("#gmCanvas");
  gm.addEventListener("click", e => { const ic = gmPick(e); if (ic) { S.city = ic.sid; renderCity(); gmFocus(GM.focus === ic.sid ? null : ic.sid); } });
  $("#gmAll").onclick = () => gmFocus(null);
  $("#gmZoom").onclick = () => gmFocus(S.city);
  gm.addEventListener("mousemove", e => { const ic = gmPick(e); gm.style.cursor = ic ? "pointer" : "default"; if (GM.hover !== ic) { GM.hover = ic; renderGameMap(); } });
  $("#camTop").onclick = () => { setView("top"); };
}
const READOUT_HINT = "把鼠标移到地图上查看格点信息。";
function setWide(on) {
  document.body.classList.toggle("wide", on);
  $("#layoutBtn").setAttribute("aria-pressed", String(on));
  try { localStorage.setItem("region-map-agent.layout", on ? "wide" : "side"); } catch {}
  if (V3 && V3.ok) { resize3D(); setView("oblique"); }
  if (S.view === "game") renderGameMap(true);
}
const EXAMPLES = [
  { label: "沙漠绿洲帝国", text: "一个被沙漠包围的绿洲帝国" },
  { label: "维京群岛", text: "北方冰海上的维京群岛" },
  { label: "热带火山岛", text: "热带海上的一座火山岛，岛上有古老的神庙和走私者的港口" },
  { label: "峡湾王国", text: "寒冷多雨的峡湾海岸，山民王国沿着峡湾修建堡垒" },
  ...PRESETS.map(p => ({ label: p.label, text: p.text })),
];
// a random world skips the planner: its WorldSpec is drawn from a seed, and the description is a summary of it
function newRandomWorld() {
  S.randomSpec = randomSpec(Math.floor(Math.random() * 1e6));
  S.randomDesc = describeSpec(S.randomSpec);
  $("#desc").value = S.randomDesc;
}
function showCell(W, x, y) {
  const i = y * N + x, rel = W.h[i] - W.P.sea;
  const elev = W.ocean[i] ? `水深约 ${Math.round(-rel * 6000)} m` : `海拔约 ${Math.round(Math.max(0, rel) * 6000)} m`;
  $("#readout").textContent = `${REGION_ZH[regionOf(x, y)]}部，距西界 ${x * kmOf(W)} km、北界 ${y * kmOf(W)} km；${elev}，湿度 ${W.moist[i].toFixed(2)}，${BIOME_ZH[W.biome[i]]}${W.hy.channel[i] && !W.hy.lake[i] ? "，河道" : ""}`;
}
function setViewMode(v) {
  if ((v === "3d" || v === "game") && !(V3 && (V3.ok || init3D()))) v = "2d";
  S.view = v;
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  $("#map").hidden = v !== "2d";
  $("#view3d").hidden = v !== "3d";
  $("#ctl3d").hidden = v !== "3d";
  $("#gamemap").hidden = v !== "game";
  $("#ctlgame").hidden = v !== "game";
  $("#readout").textContent = v === "game" ? "俯视渲染叠加探索迷雾与图标；点击城镇图标可在下方查看它的规划详图。" : READOUT_HINT;
  if (v === "3d") resize3D();
  renderMap();
}

function setBusy(b, msg) {
  S.running = b;
  for (const id of ["#run", "#loreBtn", "#moveBtn", "#ridgeBtn", "#rewriteBtn", "#obeyBtn"]) $(id).disabled = b;
  $("#stop").hidden = !(b && engine() === "claude");
  $("#busy").textContent = b ? (msg || "运行中") : "";
  if (!b) updateEditButtons();
}

// ---------- snapshots & trace ----------
function pushSnap(W, label, kind) {
  S.snaps.push({ W, label, kind, rep: null });
  S.cur = S.snaps.length - 1;
  refreshAll();
}
function reportOf(sn) {
  if (!sn.rep || sn.repLore !== S.loreVersion) { sn.rep = verify(sn.W, sn === last() ? activeLore() : null); sn.repLore = S.loreVersion; }
  return sn.rep;
}
S.loreVersion = 0;
const activeLore = () => S.lore ? S.lore.filter(e => !e.draft) : null;
function bumpLore() { S.loreVersion++; }
function addTrace(item) { S.trace.push(item); renderTrace(); return item; }

function refreshAll() { renderScrub(); renderMap(); renderChecks(); renderMetrics(); renderTrace(); renderLore(); renderCity(); updateEditButtons(); }

// ---------- LLM helpers ----------
const JSON_NOTE = `

Format: reply with one valid JSON object and nothing else. Inside string values never use a bare ASCII double quote —
quote words with 「」 instead.`;
async function llmJSON(prompt, what, item, retried) {
  S.llmCalls++;
  const t = performance.now();
  if (item) { item.pending = `${what}：等待 Claude…`; renderTrace(); }
  try {
    const out = await S.sample.json(prompt + JSON_NOTE, {
      modelTier: $("#tier").value, signal: S.ctl.signal, cache: false,
      onText: ({ text }) => { if (item) { item.pending = `${what}：Claude 正在输出（${text.length} 字符）`; renderTrace(); } },
    });
    if (item) { item.pending = null; item.llm = ((performance.now() - t) / 1000).toFixed(1) + " s"; }
    return out;
  } catch (e) {
    if (item) item.pending = null;
    // one retry for a malformed reply, telling the model what went wrong; everything else fails straight away
    if (e && e.code === "invalid_json" && !retried) {
      console.warn(`[llm] ${what}: invalid JSON (${e.message}), retrying once`);
      return llmJSON(prompt + `\n\nYour previous reply to this exact request was not valid JSON (${String(e.message || "").slice(0, 80)}). Answer again.`, what, item, true);
    }
    const map = { cancelled: "已停止", not_granted: "未授权调用 Claude，已切回离线模式", rate_limited: "调用太频繁或额度已用完，请稍后再试", invalid_json: "Claude 的回复不是合法 JSON", refused: "Claude 拒绝了这次请求", sampling_disabled: "此账号无法调用 Claude", bad_key: "OpenRouter key 无效或已被撤销，已切回离线模式", network: "连不上模型服务，检查网络" };
    const msg = map[e && e.code] || `调用失败（${(e && e.code) || e}）`;
    if (e && (e.code === "not_granted" || e.code === "sampling_disabled" || e.code === "bad_key")) { $("#engOff").checked = true; $("#engClaude").disabled = true; $("#tierWrap").hidden = true; }
    const err = new Error(msg); err.code = e && e.code; throw err;
  }
}

const SPEC_SCHEMA = `{"name": string, "seed": integer,
 "landform": "coast"|"continent"|"archipelago"|"islands"|"peninsula"|"isthmus"|"inland_sea"|"fjords"|"volcanic_island"|"shattered"|"lakeland"|"highland",
 "ocean_side": "E"|"W"|"N"|"S"|"all"|"none", "wind_from": "E"|"W"|"N"|"S",
 "scale": "region"|"kingdom"|"continent",
 "climate_zone": {"temperature": "polar"|"cold"|"temperate"|"warm"|"hot", "humidity": "arid"|"dry"|"normal"|"humid"},
 "mountains": [{"name": string, "region": R, "angle": 0-179, "length": "short"|"medium"|"long", "invented": boolean}],
 "min_major_rivers": 0-6, "min_lakes": 0-4,
 "settlements": [{"name": string, "type": "port"|"city"|"town"|"village"|"fortress", "region": R,
                  "requires": subset of ["coast","river_mouth","on_river","lakeside","near_mountain","accessible","defensible"],
                  "proposed": subset of "requires" — the ones YOU inferred rather than read,
                  "invented": true if the description never mentions this settlement,
                  "rationale": short Chinese sentence saying why the proposed ones follow}],
 "character": [{"metric": M, "level": "none"|"low"|"moderate"|"high"|"dominant", "why": short Chinese reason}
               | {"metric": "islands", "min": integer, "max": integer, "why": ...}],
 "names": {"rivers": [8-12 names], "lakes": [4-8 names], "places": [30-50 hamlet names]},
 "hamlets": "none"|"sparse"|"normal"|"dense",
 "style": {"era": "medieval"|"modern"|"future"|"alien", "street_pattern": "organic"|"grid"|"radial"|"ring"|"terraced",
           "block_scale": 0.5-2, "building_height": 0.5-4, "walls": "always"|"never"|"auto",
           "landmarks": subset of ["plaza","cathedral","church","chapel","cityhall","market","hospital","clinic","school","library","station","factory","keep","lighthouse"]}}
R is one of NW, N, NE, W, C, E, SW, S, SE (a 3x3 grid, north is up). The map is a 512 x 512 grid; "scale" sets how much
ground it covers: region = 1024 km across (a province), kingdom = 2048 km, continent = 4096 km.

landform — the shape of land and sea, drawn fresh from the seed each time:
  coast: mainland with the sea on ocean_side, bays and offshore islets · continent: one large landmass ringed by sea
  archipelago: many islands · islands: two or three large islands · peninsula: a long arm of land into the sea
  isthmus: two landmasses joined by a narrow neck · inland_sea: land around an enclosed sea with one strait out
  fjords: a mountainous coast cut by long narrow inlets · volcanic_island: one island around a volcanic peak
  shattered: a landmass broken by winding straits · lakeland: landlocked, dotted with lakes · highland: landlocked plateau split by a rift valley
mountains.angle — the direction a range runs, in degrees: 0 = east-west, 90 = north-south, 45 = from NW to SE... any value.
climate_zone shifts the whole map: hot+humid gives jungle, hot+arid desert and savanna, polar gives ice and tundra.
character — measurable expectations about the map as a whole. M is one of:
  land_share (land / whole map) · lake_share · mountain_share · desert_share (desert + salt flat) · grass_share
  (grassland, steppe, savanna) · forest_share · cold_share (ice, tundra, snow) · wetland_share — each a share of the land —
  and islands (number of separate landmasses). Levels: none ≤ 2%, low ≤ 15%, moderate 10–40%, high ≥ 35%, dominant ≥ 55%.
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
${SPEC_SCHEMA}

You do five jobs at once. Do the first one first: everything after it must serve it.

0. OVERALL CHARACTER — before any place, decide what this world is like as a whole and write 2-5 "character"
   expectations that the description implies and a reader would check at a glance: a desert empire is dominated by
   desert and has almost no lakes; a Viking archipelago has many islands and a cold climate; a jungle kingdom is
   mostly forest. Each needs a Chinese "why". These rank ABOVE every site constraint: when a town's requirement
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
     somewhere meaningful, and a Chinese rationale. Never contradict or crowd out what the author wrote: if the author
     lists many places, add fewer.
   - Write names in the description's language with one consistent naming culture that fits the setting (Nordic,
     desert, East Asian, Celtic, alien...). Supply "names": river, lake and hamlet name pools in that same culture.
     Set "hamlets" to "normal" unless the setting is empty wilderness ("sparse") or crowded heartland ("dense").

3. PROPOSED CONSTRAINTS — add the geographic conditions that the description *implies* for the author's own
   settlements but does not state, and list them in "proposed" with a one-line Chinese "rationale":
     a prosperous trading town needs "accessible" — wealth follows traffic, and a town walled in by mountains cannot trade
     a border fortress needs "defensible" — it exists to hold ground
     a mill town belongs on a river; a fishing village belongs on the coast
   Propose only what the seven checkable site predicates can express. Do NOT propose relations between settlements
   here: the rivers and roads do not exist yet. Atmosphere ("常年有雾", "闹鬼的矿镇") is NOT a constraint.
   Proposed and invented items are relaxed before explicit ones when something is impossible, so a guess is cheap.

4. STYLE PROFILE — read the era and culture off the description and fill "style". This drives how towns are drawn,
   never where things go: a medieval town is organic with walls and a cathedral; a modern city is a grid with a station,
   hospital and factories, taller buildings and no walls; a future or alien settlement can be radial or terraced with
   much taller structures. Pick "landmarks" as the vocabulary that fits that world.

Rules:
- ocean_side must agree with the landform: "all" for islands, archipelagos, continents and other sea-ringed shapes,
  "none" for lakeland and highland, the sea side for coast, fjords and peninsula.
- A port, or anything that requires "coast", needs a landform with sea. Settlement regions must be places the
  landform puts land (on an archipelago the centre may be open sea).
- Small islands are low and open: "accessible" (a corridor through hard country) and "defensible" (a commanding
  height) rarely hold there, so on archipelagos and small islands prefer coast, river_mouth and on_river for the
  settlements you invent. Set min_lakes above 0 only when the description names lakes or the landform is lakeland.
- "lakeland" means a country of many large lakes (Finland, Canadian shield). A desert with oases is NOT lakeland: use
  highland, continent or coast with an arid climate_zone; the generator's water balance then keeps only small lakes
  (the oases) and dries the rest of each basin into salt flats. Oasis towns can require "lakeside" or "on_river".
- At most 8 mountains and 20 settlements; seed is any integer from 1 to 99999.
- If the description asks for something impossible (a port in a landlocked region), keep it anyway: the verifier
  will find the conflict and report it. Never quietly fix the user's intent.

Description:
"""${desc.slice(0, 3000)}"""`;
  return llmJSON(prompt, "规划 WorldSpec", item);
}

// Stage 2': propose relations once the map exists, so upstream/downstream and travel times are grounded in fact.
async function llmRelations(W, item) {
  const facts = mapFacts(W);
  const prompt = `A regional map has just been generated from a worldbuilding description. Propose the geographic
relations between settlements that the world implies and that the map can actually support.

Two relation types are checkable:
  {"type":"downstream_of","a":"S3","b":"S1"}                 water leaving b flows past a (b can foul or cut a's water)
  {"type":"within_days_of","a":"S5","b":"S1","days":4}       a is at most that many days of travel from b

Scale: the map is 1024 km across, travel is 32 km/day over slope-weighted paths, so crossing the whole region takes
about 30 days. The facts below already contain the measured travel days for every pair, which rivers each settlement
sits on, and each site's accessibility, defensibility, road centrality and hinterland size.

Rules:
- Ground every proposal in the facts. If two settlements are not on the same river system, do not propose a
  downstream relation between them.
- For "within_days_of", set "days" close to (and not below) the measured travel time of the pair, so the relation
  records a real dependency rather than forcing the settlements together. Only propose it where the world implies a
  dependency: a satellite village and its market town, a fortress and the capital it guards, a mine and its smelter.
- Propose at most 4 relations. Fewer is better. Skip anything the map does not support.
- Each needs a one-line Chinese "rationale" that cites the fact it rests on.

Facts:
${JSON.stringify(facts)}

Reply with only JSON: {"relations":[{"type":..., "a":"S1", "b":"S3", "days":4, "rationale":"..."}]}`;
  const out = await llmJSON(prompt, "提议地缘关系", item);
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
    sea_level: +W.P.sea.toFixed(2), hydrology: W.P.hydro, climate: W.P.climate, river_threshold: W.P.riverThr,
    ridges: W.P.ridges.map(r => ({ region: r.region, orientation: r.orientation, amp: +r.amp.toFixed(2) })),
    basins: W.P.basins.map(b => b.region), declared_unsatisfiable: W.P.unsat,
    landform: W.P.landform !== undefined ? W.P.landform : W.spec.landform || "coast (default)",
    climate_zone: (W.P.cz !== undefined ? W.P.cz : W.spec.climate_zone) || { temperature: "temperate", humidity: "normal" },
    map_stats: mapStats(W),
    relaxed_constraints: (W.P.relaxed || []).map(r => ({ settlement: r.sid, was: r.item, now: r.to, why: r.reason })),
    settlement_regions: Object.fromEntries(W.spec.settlements.map(s => [s.id, regionOf(...W.P.pos[s.id])])),
  };
  const feedback = fb === "structured"
    ? "Structured verifier report (failed checks only):\n" + JSON.stringify(rep.fails.map(f => ({
        id: f.id, code: f.code, target: f.target, region: f.region, requirement: f.req, item: f.item,
        source: f.source, relaxed: f.relaxed || undefined, check: f.label, measured: f.measured, claim: f.claim, why: f.why,
        conflict: f.conflict ? { core: f.conflict.core, reason: f.conflict.reason } : undefined,
      })), null, 0)
    : "Verifier verdict: FAIL. No further detail is available in this condition.";
  const history = hist.slice(-3).map((h, k) => ({ round: hist.length - Math.min(3, hist.length) + k + 1, actions: h.actions, results: h.results.map(r => `${r.a.tool}: ${r.ok ? "ok" : "failed"} — ${r.msg}`) }));
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

Reply with only JSON: {"analysis": "one or two sentences in Chinese explaining your plan", "actions": [{"tool": "<name>", "args": {...}}], "stop": false}
PRIORITY: checks with code "character" describe the world as a whole and outrank every other check. Fix them first,
usually with set_climate or set_landform. Never trade one away for a town: a round whose edits break a character check
that was passing is rolled back automatically. If a town's requirement can only be met by breaking the world's
character (a lakeside town in a lakeless desert), call declare_unsatisfiable on that town's check with a reason naming
the character expectation.
A check carrying a "conflict" has been proved unsatisfiable together with the rest of its core; a separate negotiator stage decides what to give up there, so do not spend edits on it. Use the fewest edits that address the failures. Terrain and hydrology tools run before settlement moves within a round. If a move failed or kept a settlement outside its region, change the terrain (e.g. lower the river threshold, carve a basin) instead of repeating it. If a check cannot be satisfied at all, call declare_unsatisfiable with its id. Set "stop": true only when nothing useful is left to try.`;
  const out = await llmJSON(prompt, "决定修正动作", item);
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
    landform: W.P.landform !== undefined ? W.P.landform : W.spec.landform || "coast (default)", scale: W.spec.scale || "region",
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
{"fits": true|false, "score": 1-5 (5 = clearly the place described), "issues": ["short Chinese sentences, most important first"],
${final ? `"actions": []}` : `"add_character": [character expectations the map should meet but nobody declared, same shape as above:
   {"metric": ..., "level": ... | "min"/"max" for islands, "why": Chinese}],
 "actions": [{"tool": "<name>", "args": {...every argument the tool lists...}}] — tool calls that fix the world as a whole,
   from: set_landform, set_climate, raise_ridge, carve_basin, set_sea_level, set_river_threshold}

Tools:
${TOOL_DOC.split("\n").filter(l => /^(set_landform|set_climate|raise_ridge|carve_basin|set_sea_level|set_river_threshold)/.test(l)).join("\n")}

Change the landform or climate only when the current one clearly contradicts the description; an empty actions list is fine.`}
Character metrics: ${Object.keys(CHAR_METRICS).join(", ")}; levels: none ≤ 2%, low ≤ 15%, moderate 10–40%, high ≥ 35%, dominant ≥ 55%.`;
  const out = await llmJSON(prompt, final ? "终审：对照描述" : "审阅：对照描述", item);
  return {
    fits: !!out.fits, score: clamp(Math.round(+out.score || 0), 0, 5), issues: (Array.isArray(out.issues) ? out.issues : []).map(String).slice(0, 6),
    add: final ? [] : normalizeCharacter(out.add_character, "critic"),
    actions: final ? [] : (Array.isArray(out.actions) ? out.actions : []).filter(a => a && /^(set_landform|set_climate|raise_ridge|carve_basin|set_sea_level|set_river_threshold)$/.test(a.tool)).slice(0, 6),
  };
}

// Stage 2'': conflict resolution. The solver has proved a set of constraints jointly unsatisfiable; this stage decides
// which one to give up. It is the only stage that gets the original description, because ranking two constraints is a
// question about authorial intent, and intent lives in the prose — the WorldSpec has already thrown it away.
async function llmNegotiate(W, briefs, desc, item) {
  const prompt = `You are the negotiator in a regional-map generation loop. A constraint solver has proved that some
settlements carry constraints that cannot all hold at once, whatever the terrain tools do. Decide what to give up.

The original description — the only place the author's intent is written down:
<description>
${String(desc || "").slice(0, 2000)}
</description>

Each conflict below lists a MINIMAL unsatisfiable core: remove any one item and the rest become satisfiable. For every
item you get where it came from — "explicit" was written by the author, "proposed" was inferred by an earlier stage of
this same agent and carries the reason that stage gave — and "can_become": what the item may be traded for. Each option
carries two numbers: "cells_now" is how many sites satisfy it on the map as it stands, and "cells_after_tools" is how
many could after the terrain tools do their best (digging a lake, raising a ridge, lowering the river threshold).
An option with cells_now = 0 but cells_after_tools > 0 is reachable, but only by rebuilding terrain for it.
Some items carry "blocked_by_character": the world's overall character — decided first, and ranked above every site
constraint — keeps the feature this item needs scarce (few lakes, few mountains), so the tools may not build it for
this town and its cells_after_tools counts only what the map already has. Such a conflict is between the town and the
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
- Relax exactly ONE item per conflict. The core is minimal, so one is enough; a second throws away intent for nothing.
- If every item in a core is explicit and the description gives you no ground to rank them, relax nothing and declare
  that conflict's checks unsatisfiable instead of guessing.

Reply with only JSON:
{"analysis": "one or two sentences in Chinese saying what you traded and why",
 "relaxations": [{"target": "S3", "item": "coast", "to": "on_river", "reason": "中文一句"}],
 "declare": [{"check_id": "spec.req.S3.coast", "reason": "中文一句"}]}
Use "to": null to drop an item outright. Leave either list empty when you have nothing to put in it.`;
  const out = await llmJSON(prompt, "冲突让步决策", item);
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

const CLAIM_DOC = `Claim objects (use entity ids):
{"type":"in_region","s":"S1","region":"E"}                     region code: NW,N,NE,W,C,E,SW,S,SE
{"type":"coastal","s":"S1"}
{"type":"on_river","s":"S1","river":"R1"}
{"type":"lakeside","s":"S1"}
{"type":"near_mountain","s":"S1","mountain":"M1"}
{"type":"biome","s":"S1","biome":"forest"}                      biome: snow,rock,tundra,taiga,steppe,desert,grassland,forest,marsh,rainforest
{"type":"direction","a":"S2","b":"S1","dir":"东北"}             a lies to the dir of b; dir: 东,东南,南,西南,西,西北,北,东北
{"type":"travel_days","a":"S1","b":"S2","days":3.5}
{"type":"separated_by","a":"S1","b":"S2","mountain":"M1"}
{"type":"upstream_of","a":"S2","b":"S1"}`;

async function llmLore(facts, item) {
  const prompt = `Write one short worldbuilding entry per settlement for a tabletop campaign region called "${facts.region}". Tone: quiet, uncanny, 1920s or low-fantasy depending on the names. Write in Chinese, 50-110 characters per entry.
Use ONLY these map facts for geography. Refer to entities by writing [[ID]] in the text (e.g. [[S1]], [[R1]], [[M1]]) instead of their names.
Every geographic statement in the text must also appear as a machine-checkable claim. Non-geographic flavour needs no claim.

${CLAIM_DOC}

Map facts:
${JSON.stringify(facts)}

Reply with only JSON: {"entries":[{"subject":"S1","title":"...","text":"...","claims":[...]}]}`;
  const out = await llmJSON(prompt, "起草世界观", item);
  return Array.isArray(out.entries) ? out.entries : Array.isArray(out) ? out : [];
}
async function llmReviseLore(entries, failures, facts, item, why) {
  const prompt = `These worldbuilding entries contain geographic claims that ${why}. Rewrite ONLY the listed entries so every claim matches the map facts. Keep the tone and the [[ID]] references; keep each entry 50-110 Chinese characters; make the claims list match the new text.

${CLAIM_DOC}

Entries to fix:
${JSON.stringify(entries)}

Failed claims (with what the map actually shows):
${JSON.stringify(failures)}

Current map facts:
${JSON.stringify(facts)}

Reply with only JSON: {"entries":[{"subject":"S1","title":"...","text":"...","claims":[...]}]}`;
  const out = await llmJSON(prompt, "修订世界观", item);
  return Array.isArray(out.entries) ? out.entries : [];
}
function normalizeEntries(list, W, idOffset) {
  const ids = new Set(W.spec.settlements.map(s => s.id));
  return (list || []).filter(e => e && ids.has(String(e.subject))).map((e, k) => ({
    id: "E" + (idOffset + k + 1), subject: String(e.subject), title: String(e.title || nameOf(W, e.subject)).slice(0, 30),
    text: String(e.text || "").slice(0, 400),
    claims: (Array.isArray(e.claims) ? e.claims : []).filter(c => c && typeof c.type === "string").slice(0, 10).map(c => { const o = {}; for (const [k2, v] of Object.entries(c)) o[k2] = k2 === "days" ? +v : String(v); return o; }),
  }));
}

// ---------- the agent loop ----------
async function repairLoop(W, { fb, maxIter, withLore, eng, title, desc }) {
  const hist = [];
  let rep = verify(W, withLore ? activeLore() : null);
  const negotiated = new Set();          // one negotiation per distinct conflict core, never the same core twice
  for (let it = 1; it <= maxIter; it++) {
    if (!rep.fails.length) { addTrace({ kind: "done", title: "全部检查通过", body: "验证器没有发现剩余违规，循环结束。" }); break; }
    // Conflict resolution runs first: editing terrain towards a goal the solver has proved unreachable is wasted work.
    // It does not consume an iteration — after yielding, the same round still gets its repair step.
    if (fb === "structured") {
      const briefs = conflictBriefs(W, rep).filter(b => !negotiated.has(b.key));
      if (briefs.length) {
        briefs.forEach(b => negotiated.add(b.key));
        const ni = addTrace({ kind: "conflict", title: `${title} 第 ${it} 轮 · 冲突消解`, before: rep.fails.length,
          body: briefs.map(b => `${b.name}：${b.reason}`).join("；") + "。" });
        let dec = { analysis: "", actions: [] };
        try { dec = eng === "claude" ? await llmNegotiate(W, briefs, desc, ni) : scriptedNegotiate(W, briefs); }
        catch (e) { ni.body += ` 让步决策失败：${e.message || e}`; }
        if (dec.actions.length) {
          const r = applyActions(W, dec.actions);
          hist.push({ actions: dec.actions, results: r.results });
          W = r.W; rep = verify(W, withLore ? activeLore() : null);
          if (dec.analysis) ni.body = dec.analysis;
          ni.after = rep.fails.length;
          ni.actions = r.results.map(x => ({ call: `${x.a.tool}(${Object.values(x.a.args || {}).map(v => JSON.stringify(v)).join(", ")})`, ok: x.ok, msg: x.msg }));
          pushSnap(W, `${title}${it}让步`, "iter");
          await frame();
          if (!rep.fails.length) { addTrace({ kind: "done", title: "全部检查通过", body: "让步之后没有剩余违规，循环结束。" }); break; }
        } else { ni.after = rep.fails.length; ni.body += "（agent 选择不让步）"; renderTrace(); }
      }
    }
    const item = addTrace({ kind: "iter", title: `${title} 第 ${it} 轮`, before: rep.fails.length });
    let pol;
    try {
      if (eng === "claude") pol = await llmRepair(W, rep, hist, fb, item);
      else pol = fb === "structured" ? scriptedStructured(W, rep, hist) : scriptedBlind(W, rep, hist, it);
    } catch (e) {
      if (e && e.code === "cancelled") throw e;
      // a failed round ends the loop but keeps the map built so far; the run still gets its final review
      item.after = rep.fails.length; item.body = `本轮修正决策失败（${e.message || e}），保留当前地图并结束修正循环。`; renderTrace();
      break;
    }
    item.body = pol.analysis;
    if (!pol.actions.length || pol.stop) { item.after = rep.fails.length; item.body += (item.body ? " " : "") + "（agent 没有给出新动作，循环结束）"; renderTrace(); break; }
    const r = applyActions(W, pol.actions);
    // character outranks site constraints: a round that breaks a passing character check is undone
    const rep2 = verify(r.W, withLore ? activeLore() : null);
    const broken = rep.checks.filter(c => c.code === "character" && c.status === "pass").filter(c => rep2.fails.some(f => f.id === c.id));
    if (broken.length) {
      const why = `本轮会破坏整体特征（${broken.map(c => c.label.replace("整体特征：", "")).join("、")}），已回滚`;
      r.results.push({ a: { tool: "rollback", args: {} }, ok: false, msg: why });
      hist.push({ actions: pol.actions, results: r.results });
      item.after = rep.fails.length; item.body += (item.body ? " " : "") + `（${why}）`;
      item.actions = r.results.map(x => ({ call: `${x.a.tool}(${Object.values(x.a.args || {}).map(v => JSON.stringify(v)).join(", ")})`, ok: x.ok && !x.outside, msg: x.msg }));
      renderTrace(); await frame();
      if (it === maxIter && rep.fails.length) addTrace({ kind: "done", title: "达到迭代上限", body: `仍有 ${rep.fails.length} 项违规。` });
      continue;
    }
    hist.push({ actions: pol.actions, results: r.results });
    W = r.W;
    rep = rep2;
    item.after = rep.fails.length;
    item.actions = r.results.map(x => ({ call: `${x.a.tool}(${Object.values(x.a.args || {}).map(v => JSON.stringify(v)).join(", ")})`, ok: x.ok && !x.outside, msg: x.msg }));
    pushSnap(W, `${title}${it}`, "iter");
    await frame();
    if (it === maxIter && rep.fails.length) addTrace({ kind: "done", title: "达到迭代上限", body: `仍有 ${rep.fails.length} 项违规。` });
  }
  return W;
}

async function runAgent(opts = {}) {
  if (S.running) return;
  const eng = opts.eng || engine(), fb = $("#feedback").value, maxIter = clamp(+$("#maxIter").value || 6, 1, 10);
  // Where the WorldSpec comes from: the model reads any description; without one, only a random world or an example
  // that carries a hand-written spec can be built. Say so instead of silently drawing something unrelated.
  const desc0 = $("#desc").value.trim();
  const isRandom = !!S.randomSpec && desc0 === S.randomDesc.trim();
  const preset = PRESETS.find(p => p.text.trim() === desc0) || null;
  if (!desc0) { $("#busy").textContent = "先写一句描述，或点「随机世界」。"; return; }
  if (eng !== "claude" && !isRandom && !preset) {
    $("#busy").textContent = $("#engClaude").disabled
      ? "离线模式读不懂自由描述。填入 OpenRouter key 解锁模型，或点「随机世界」。"
      : "离线模式读不懂自由描述：把「规划与修正由谁完成」切到 Claude，或点「随机世界」。";
    return;
  }
  S.ctl = new AbortController(); S.snaps = []; S.trace = []; S.lore = null; S.fit = null; bumpLore(); $("#loreLog").innerHTML = ""; $("#editResult").textContent = "先生成世界观，再来这里修改。"; S.llmCalls = 0; S.focus = null; S.t0 = performance.now();
  setBusy(true, "生成中");
  try {
    const desc = desc0;
    let raw;
    if (isRandom) {
      raw = S.randomSpec;
      addTrace({ kind: "plan", title: "规划器（随机世界）", body: "使用随机抽取的 WorldSpec：地形模板、气候、尺度、山脉和聚落都由种子决定，规划阶段不调用模型。" });
    } else if (eng === "claude") {
      const item = addTrace({ kind: "plan", title: "规划器", body: "把描述转成 WorldSpec（结构化规格）。" });
      raw = resolveRelationNames(await llmPlan(desc, item));
    } else {
      raw = preset.spec;
      addTrace({ kind: "plan", title: "规划器（离线）", body: "这段描述是自带 WorldSpec 的示例，离线模式直接使用写好的规格，不调用模型。" });
    }
    S.spec = normalizeSpec(raw);
    $("#specView").textContent = JSON.stringify(S.spec, null, 2);
    { const km = (SCALES[S.spec.scale] || SCALES.region).km * N;
      $("#scaleHint").textContent = `图幅 ${km} × ${km} km，512 × 512 格（每格 ${km / N} km），北在上。${S.spec.landform ? `地形：${LANDFORM_ZH[S.spec.landform]}。` : ""}`; }
    fillEditSelects(); syncStyleControls();
    await frame();
    let W = derive(S.spec, initParams(S.spec));
    if (eng === "claude") {
      const it2 = addTrace({ kind: "plan", title: "地缘关系提议", body: "地图已生成，让 agent 根据真实水系、路网和实测路程提议关系约束。" });
      try {
        const rels = await llmRelations(W, it2);
        if (rels.length) {
          S.spec = normalizeSpec({ ...S.spec, settlements: S.spec.settlements.map(s => ({ ...s })), relations: rels });
          W = derive(S.spec, W.P);
          it2.body = rels.map(r => `${nameOf(W, r.a)} ${REL_ZH[r.type]}${r.type === "within_days_of" ? " " + r.days + " 天" : ""} ${nameOf(W, r.b)}：${r.rationale || ""}`).join("；");
          $("#specView").textContent = JSON.stringify(S.spec, null, 2);
        } else it2.body = "agent 认为这张图不支持任何关系约束。";
      } catch (e) { it2.body = "关系提议失败：" + (e.message || e); }
    }
    const rep0 = verify(W, null);
    addTrace({ kind: "build", title: "生成器", body: `按默认参数生成：噪声地形、噪声湿度、不填洼的 D8 水文。验证器发现 ${rep0.fails.length} 项违规。` });
    pushSnap(W, "初始", "init");
    if (eng === "claude" && !isRandom && fb !== "none") {
      const ci = addTrace({ kind: "plan", title: "地图审阅", body: "把整张图的统计和原始描述对照，检查世界的整体特征。" });
      try {
        const cr = await llmCritique(W, desc, "pre", ci);
        const notes = [`吻合度 ${cr.score}/5`].concat(cr.issues);
        if (cr.add.length) {
          const have = new Set((S.spec.character || []).map(c => c.metric));
          const add = cr.add.filter(c => !have.has(c.metric));
          if (add.length) {
            S.spec = normalizeSpec({ ...S.spec, character: [...(S.spec.character || []), ...add] });
            W = derive(S.spec, W.P);
            notes.push("补充整体特征：" + add.map(charLabel).join("、"));
            $("#specView").textContent = JSON.stringify(S.spec, null, 2);
          }
        }
        if (cr.actions.length) {
          const r = applyActions(W, cr.actions); W = r.W;
          ci.actions = r.results.map(x => ({ call: `${x.a.tool}(${Object.values(x.a.args || {}).map(v => JSON.stringify(v)).join(", ")})`, ok: x.ok, msg: x.msg }));
        }
        ci.body = notes.join("；") + "。";
        if (cr.add.length || cr.actions.length) { ci.after = verify(W, null).fails.length; pushSnap(W, "审阅调整", "iter"); }
        renderTrace();
      } catch (e) { ci.body = "审阅失败：" + (e.message || e); }
    }
    if (fb === "none") addTrace({ kind: "done", title: "无反馈条件", body: "只生成一次，不进入修正循环。" });
    else W = await repairLoop(W, { fb, maxIter, withLore: false, eng, title: "修正", desc });
    if (eng === "claude" && !isRandom && fb !== "none") {
      const fi = addTrace({ kind: "plan", title: "终审", body: "修正结束后再把地图和描述对照一次，只评分不改动。" });
      try {
        const cr = await llmCritique(W, desc, "final", fi);
        S.fit = cr.score;
        fi.body = `吻合度 ${cr.score}/5${cr.fits ? "，符合描述" : "，与描述仍有出入"}。` + (cr.issues.length ? cr.issues.join("；") + "。" : "");
        renderTrace(); renderMetrics();
      } catch (e) { fi.body = "终审失败：" + (e.message || e); }
    }
  } catch (e) {
    addTrace({ kind: "error", title: "中断", body: e.message || String(e) });
  } finally {
    S.elapsed = (performance.now() - S.t0) / 1000;
    setBusy(false); refreshAll();
  }
}

// ---------- lore ----------
function claimStatuses(W) {
  for (const e of S.lore || []) for (const c of e.claims) {
    const r = checkClaim(W, c); const prev = c.status;
    c.result = r;
    if (r.ok) c.status = "ok";
    else if (prev === "ok" || prev === "stale") c.status = "stale";
    else c.status = "false";
  }
}
async function genLore() {
  const sn = last(); if (!sn || S.running) return;
  const eng = engine();
  S.ctl = new AbortController();
  setBusy(true, "写设定中");
  const log = [];
  const W = sn.W;
  try {
    S.lore = null;
    if (eng === "claude") {
      const facts = mapFacts(W);
      const item = { kind: "lore" }; S.loreItem = item;
      log.push("通过地图查询工具取得聚落、河流、山脉和两两路程等事实，交给 Claude 起草。");
      renderLoreLog(log, item);
      let entries = normalizeEntries(await llmLore(facts, item), W, 0);
      S.lore = entries; S.lore.forEach(e => e.claims.forEach(c => c.status = null)); claimStatuses(W);
      const bad = entries.filter(e => e.claims.some(c => c.status !== "ok"));
      const nClaims = entries.reduce((a, e) => a + e.claims.length, 0);
      log.push(`起草完成：${entries.length} 条设定，${nClaims} 条地理声明，其中 ${countBad()} 条与地图不符。`);
      renderLoreLog(log, item); renderLore();
      if (bad.length) {
        const failures = bad.flatMap(e => e.claims.filter(c => c.status !== "ok").map(c => ({ entry: e.subject, claim: c, map_says: c.result.measured })));
        const fixed = normalizeEntries(await llmReviseLore(bad.map(({ subject, title, text, claims }) => ({ subject, title, text, claims })), failures, facts, item, "contradict the map"), W, 0);
        mergeEntries(fixed); S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
        log.push(`修订 ${fixed.length} 条后，还剩 ${countBad()} 条声明不符。`);
      }
    } else {
      S.lore = scriptedLore(W, "draft");
      S.lore.forEach(e => e.claims.forEach(c => c.status = null)); claimStatuses(W);
      log.push("起草（离线模板）：路程按两地直线距离估算，没有调用路径工具。");
      log.push(`核查：${S.lore.reduce((a, e) => a + e.claims.length, 0)} 条地理声明，${countBad()} 条与地图不符。`);
      renderLore(); renderLoreLog(log); await frame();
      const bad = S.lore.filter(e => e.claims.some(c => c.status !== "ok"));
      if (bad.length) {
        for (const e of bad) { const k = S.lore.indexOf(e); const s = S.spec.settlements.find(q => q.id === e.subject); S.lore[k] = scriptedLoreEntry(W, s, k, "final"); }
        S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
        log.push(`修订：对不符的 ${bad.length} 条设定改用路径工具的实测路程重写，剩余不符 ${countBad()} 条。`);
      } else log.push("没有需要修订的声明。");
    }
    log.push("这些声明现在也是地图的约束：之后编辑地图时，被影响的设定会被标记为过期。");
  } catch (e) {
    log.push("中断：" + (e.message || e));
  } finally {
    bumpLore(); renderLoreLog(log); setBusy(false); refreshAll();
  }
}
function countBad() { return (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status !== "ok").length, 0); }
function mergeEntries(fixed) {
  for (const f of fixed) {
    const k = S.lore.findIndex(e => e.subject === f.subject);
    if (k >= 0) { f.id = S.lore[k].id; S.lore[k] = f; }
  }
}
function renderLoreLog(log, item) {
  $("#loreLog").innerHTML = log.map(l => `<li>${esc(l)}</li>`).join("") + (item && item.pending ? `<li class="pending">${esc(item.pending)}</li>` : "");
}

async function rewriteStale() {
  const sn = last(); if (!sn || !S.lore || S.running) return;
  const W = sn.W; const bad = S.lore.filter(e => e.claims.some(c => c.status !== "ok"));
  if (!bad.length) { $("#editResult").textContent = "没有过期或不符的设定。"; return; }
  S.ctl = new AbortController(); setBusy(true, "重写设定中");
  try {
    if (engine() === "claude") {
      const facts = mapFacts(W);
      const failures = bad.flatMap(e => e.claims.filter(c => c.status !== "ok").map(c => ({ entry: e.subject, claim: c, map_says: c.result.measured })));
      const item = {}; S.loreItem = null;
      $("#editResult").textContent = "Claude 正在重写过期设定…";
      const fixed = normalizeEntries(await llmReviseLore(bad.map(({ subject, title, text, claims }) => ({ subject, title, text, claims })), failures, facts, item, "became outdated after the map was edited"), W, 0);
      mergeEntries(fixed);
    } else {
      for (const e of bad) { const k = S.lore.indexOf(e); const s = S.spec.settlements.find(q => q.id === e.subject); S.lore[k] = scriptedLoreEntry(W, s, k, "final"); }
    }
    S.lore.forEach(e => e.claims.forEach(c => { if (c.status !== "ok") c.status = null; })); claimStatuses(W);
    $("#editResult").textContent = `已重写 ${bad.length} 条设定，剩余不符 ${countBad()} 条。地图没有改动。`;
    addTrace({ kind: "lore", title: "设定服从地图", body: `重写了 ${bad.length} 条过期设定。` });
  } catch (e) { $("#editResult").textContent = "中断：" + (e.message || e); }
  finally { bumpLore(); setBusy(false); refreshAll(); }
}
async function obeyLore() {
  const sn = last(); if (!sn || !S.lore || S.running) return;
  S.ctl = new AbortController(); setBusy(true, "修正地图中");
  try {
    const before = countBad();
    const W = await repairLoop(sn.W, { fb: "structured", maxIter: 4, withLore: true, eng: engine(), title: "服从设定", desc: $("#desc").value.trim() });
    claimStatuses(W);
    const left = countBad();
    $("#editResult").textContent = `地图修正后，不符的设定从 ${before} 条变为 ${left} 条。${left ? "剩下的（路程、方位、地貌等）无法靠移动聚落解决，可以改用“重写过期设定”。" : ""}`;
  } catch (e) { $("#editResult").textContent = "中断：" + (e.message || e); }
  finally { bumpLore(); setBusy(false); refreshAll(); }
}

// ---------- local edits ----------
function fillEditSelects() {
  const sel = $("#editS"); sel.innerHTML = "";
  for (const s of S.spec.settlements) sel.add(new Option(`${s.name}（${TYPE_ZH[s.type]}）`, s.id));
}
function updateEditButtons() {
  const has = !!last();
  $("#moveBtn").disabled = S.running || !has || !S.spec.settlements.length;
  $("#ridgeBtn").disabled = S.running || !has;
  $("#restyleBtn").disabled = S.running || !has || !S.spec.settlements.length;
  $("#loreBtn").disabled = S.running || !has || !S.spec.settlements.length;
  const hasLore = !!(S.lore && S.lore.length);
  $("#rewriteBtn").disabled = S.running || !hasLore;
  $("#obeyBtn").disabled = S.running || !hasLore;
}
function afterEdit(W0, r, label, what) {
  const W = r.W;
  let same = 0, riverDiff = 0;
  for (let i = 0; i < NN; i++) { if (Math.abs(W.h[i] - W0.h[i]) < 1e-6) same++; if ((W.hy.channel[i] && !W.hy.lake[i]) !== (W0.hy.channel[i] && !W0.hy.lake[i])) riverDiff++; }
  const staleBefore = (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status === "stale").length, 0);
  claimStatuses(W); bumpLore();
  const staleAfter = (S.lore || []).reduce((a, e) => a + e.claims.filter(c => c.status === "stale").length, 0);
  pushSnap(W, label, "edit");
  const rep = reportOf(last());
  const msg = `${r.results.map(x => x.msg).join("；")}。地形未改动的格子 ${(same / NN * 100).toFixed(1)}%，河道变化 ${riverDiff} 格；${S.lore ? `新增过期声明 ${Math.max(0, staleAfter - staleBefore)} 条；` : ""}当前违规 ${rep.fails.length} 项。`;
  $("#editResult").textContent = msg;
  addTrace({ kind: "edit", title: "用户编辑", body: `${what}。${msg}` });
}
// ---------- city style: re-plan the settlements under a different style profile ----------
function syncStyleControls() {
  const st = (S.spec && S.spec.style) || STYLE_DEFAULT;
  $("#styleEra").value = st.era; $("#stylePat").value = st.street_pattern; $("#styleWalls").value = st.walls;
}
function restyle() {
  const sn = last(); if (!sn || S.running) return;
  const prev = S.spec.style || STYLE_DEFAULT, era = $("#styleEra").value, newEra = era !== prev.era;
  // The block scale, storey height and landmark list all belong to the era they were written for, so changing the
  // era hands them back to that era's defaults (undefined makes normalizeStyle fill them in). The pattern select
  // already moved with the era when it was picked, so it is read as-is and an explicit override still wins.
  const st = normalizeStyle({
    ...prev,
    ...(newEra ? { block_scale: undefined, building_height: undefined, landmarks: null } : {}),
    era, street_pattern: $("#stylePat").value, walls: $("#styleWalls").value,
  });
  S.spec.style = st;
  // every snapshot shares one spec object; the plans are cached per world, so drop them and let them be rebuilt
  for (const s2 of S.snaps) { s2.W.spec.style = st; delete s2.W._plans; }
  S.snapGen = (S.snapGen || 0) + 1;              // part of the 3D and game-map cache keys, so both rebuild their cities
  S.city = null;
  $("#specView").textContent = JSON.stringify(S.spec, null, 2);
  const what = `${ERA_ZH[st.era]}·${PATTERN_ZH[st.street_pattern]}·街区 ${st.block_scale}×·楼高 ${st.building_height}×·城墙${{ auto: "按时代", always: "总是有", never: "不建" }[st.walls]}${newEra ? "（尺度与地标词表改用该时代的默认值）" : ""}`;
  $("#editResult").textContent = `城市风格改为「${what}」，正在重新规划聚落…（地形、水系和所有地理约束都没有改动）`;
  addTrace({ kind: "edit", title: "城市风格", body: `改为 ${what}。只重画城镇，验证器的检查结果不变。` });
  refreshAll();
}
function editMove() {
  const sn = last(); if (!sn || S.running) return;
  const id = $("#editS").value, reg = $("#editR").value;
  const r = applyActions(sn.W, [{ tool: "move_settlement", args: { id, targets: ["region:" + reg] } }]);
  afterEdit(sn.W, r, "编辑", `把${nameOf(sn.W, id)}移到${REGION_ZH[reg]}部`);
}
function editRidge() {
  const sn = last(); if (!sn || S.running) return;
  const reg = $("#ridgeR").value;
  const r = applyActions(sn.W, [{ tool: "raise_ridge", args: { region: reg, amount: 0.15 } }]);
  afterEdit(sn.W, r, "编辑", `在${REGION_ZH[reg]}部隆起山脊`);
}

// ---------- rendering: side panels ----------
function renderScrub() {
  const el = $("#scrub");
  el.innerHTML = S.snaps.map((s, k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.cur}" class="snap ${s.kind}"><span>${esc(s.label)}</span><b>${reportOf(s).fails.length}</b></button>`).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => { S.cur = +b.dataset.k; S.focus = null; renderScrub(); renderMap(); renderChecks(); renderCity(); });
  $("#histNote").hidden = S.cur === S.snaps.length - 1 || !S.snaps.length;
}
function renderMetrics() {
  const el = $("#metrics");
  if (!S.snaps.length) { el.innerHTML = ""; return; }
  const traj = S.snaps.filter(s => s.kind !== "edit").map(s => reportOf(s).fails.length);
  const rep = reportOf(last());
  const declared = rep.checks.filter(c => c.status === "declared").length;
  el.innerHTML = `
    <div><dt>违规数变化</dt><dd>${traj.join(" → ")}</dd></div>
    <div><dt>检查通过率</dt><dd>${(rep.rate * 100).toFixed(0)}%</dd></div>
    <div><dt>声明无法满足</dt><dd>${declared}</dd></div>
    <div><dt>Claude 调用</dt><dd>${S.llmCalls} 次</dd></div>
    ${S.fit != null ? `<div><dt>描述吻合（终审）</dt><dd>${S.fit}/5</dd></div>` : ""}
    <div><dt>用时</dt><dd>${S.elapsed ? S.elapsed.toFixed(1) + " s" : "…"}</dd></div>`;
}
function renderTrace() {
  const el = $("#trace");
  el.innerHTML = S.trace.map(t => `
    <li class="tr ${t.kind}">
      <div class="tr-head"><span class="tr-title">${esc(t.title)}</span>${t.before != null ? `<span class="tr-count">${t.before} → ${t.after ?? "…"}</span>` : ""}${t.llm ? `<span class="tr-llm">Claude ${t.llm}</span>` : ""}</div>
      ${t.body ? `<p>${esc(t.body)}</p>` : ""}
      ${t.pending ? `<p class="pending">${esc(t.pending)}</p>` : ""}
      ${t.actions ? `<ul class="acts">${t.actions.map(a => `<li class="${a.ok ? "" : "bad"}"><code>${esc(a.call)}</code><span>${esc(a.msg)}</span></li>`).join("")}</ul>` : ""}
    </li>`).join("");
  el.scrollTop = el.scrollHeight;
  if (S.loreItem && S.loreItem.pending) { const p = $("#loreLog .pending"); if (p) p.textContent = S.loreItem.pending; else $("#loreLog").insertAdjacentHTML("beforeend", `<li class="pending">${esc(S.loreItem.pending)}</li>`); }
}
function renderChecks() {
  const el = $("#checks"); const sn = curSnap();
  if (!sn) { el.innerHTML = ""; return; }
  const rep = reportOf(sn);
  const fails = rep.fails, declared = rep.checks.filter(c => c.status === "declared");
  const traded = rep.checks.filter(c => c.status === "relaxed" || (c.relaxed && c.status !== "fail"));
  const pass = rep.checks.filter(c => c.status === "pass" && !c.relaxed);
  const item = (c, n) => `<li class="ck ${c.status}${c.relaxed ? " was-relaxed" : ""}${S.focus === c.id ? " focus" : ""}" data-id="${esc(c.id)}" tabindex="0">
      <span class="ck-n">${n ?? ""}</span><span class="ck-cat">${esc(c.cat)}</span>
      <span class="ck-body"><span class="ck-label">${esc(c.label)}</span><span class="ck-meas">${esc(c.measured)}</span></span></li>`;
  el.innerHTML = `
    <p class="ck-sum">${sn.label}：${rep.checks.length} 项检查，<b class="f">${fails.length} 项违规</b>${declared.length ? `，${declared.length} 项已声明无法满足` : ""}${traded.length ? `，${traded.length} 项已让步` : ""}</p>
    <ol class="ck-list">${fails.map((c, k) => item(c, k + 1)).join("")}${declared.map(c => item(c, "×")).join("")}</ol>
    ${traded.length ? `<details open><summary>${traded.length} 项让步（约束被换成更弱的，或被放弃）</summary><ol class="ck-list">${traded.map(c => item(c, "~")).join("")}</ol></details>` : ""}
    <details><summary>${pass.length} 项通过</summary><ol class="ck-list">${pass.map(c => item(c, "")).join("")}</ol></details>`;
  el.querySelectorAll(".ck").forEach(li => {
    const f = () => { S.focus = S.focus === li.dataset.id ? null : li.dataset.id; renderChecks(); renderMap(); };
    li.onclick = f; li.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };
  });
}
function renderLore() {
  const el = $("#lore");
  if (!S.lore) { el.innerHTML = `<p class="empty">生成并修正地图后，点“生成世界观”。每条设定里的地理描述都会被逐条对照地图核查。</p>`; return; }
  const W = last().W;
  el.innerHTML = S.lore.map(e => `
    <article class="card" data-subject="${esc(e.subject)}">
      <h3>${esc(e.title)}</h3>
      <p class="lore-text">${esc(e.text).replace(/\[\[([A-Za-z]\d+)\]\]/g, (m, id) => `<span class="ent" data-id="${id}">${esc(nameOf(W, id))}</span>`)}</p>
      <ul class="claims">${e.claims.map(c => {
        const r = c.result || checkClaim(W, c);
        const st = c.status || (r.ok ? "ok" : "false");
        const tag = st === "ok" ? "符合" : st === "stale" ? "过期" : "不符";
        return `<li class="cl ${st}"><span class="cl-tag">${tag}</span><span>${esc(r.label)}${st !== "ok" ? `<em>${esc(r.measured)}</em>` : ""}</span></li>`;
      }).join("")}</ul>
    </article>`).join("");
  el.querySelectorAll(".ent, .card").forEach(n => {
    n.addEventListener("mouseenter", () => { S.highlight = n.dataset.id || n.dataset.subject; renderMap(); });
    n.addEventListener("mouseleave", () => { S.highlight = null; renderMap(); });
  });
}

// ---------- batch experiments (group A: same WorldSpec, agent vs rule baseline) ----------
// Run from the browser console:  runBatch({n: 12, policy: "llm", feedback: "structured"})
async function runBatch(opts = {}) {
  const { n = 12, policy = "llm", feedback = "structured", maxIter = 6, offset = 0 } = opts;
  if (policy === "llm" && !S.sample) { console.warn("Claude 不可用，无法跑 LLM 组"); return; }
  S.ctl = new AbortController();
  const trials = makeTestSet(BENCH_POOL).slice(offset, offset + n);   // fixed pool, so trial ids mean the same thing in every run
  const rows = [];
  const label = policy === "llm" ? `llm-${feedback}-${$("#tier").value}` : `rule-${feedback}`;
  const fn = policy === "llm"
    ? async (W, rep, hist) => { const p = await llmRepair(W, rep, hist, feedback, {}); return p; }
    : SCRIPTED[feedback === "binary" ? "binary" : feedback === "none" ? "none" : "structured"](label).fn;
  for (const t of trials) {
    S.llmCalls = 0;
    const t0 = performance.now();
    const { rec } = await runTrial(t, fn, { maxIter, label });
    rec.llm_calls = S.llmCalls; rec.wall_ms = Math.round(performance.now() - t0);
    rows.push(rec);
    console.log(`${rows.length}/${trials.length}`, rec.trial, rec.cat, rec.traj, rec.stopped, `${(rec.wall_ms / 1000).toFixed(1)}s`);
    window.__batchRows = rows;
  }
  console.table(summarise(rows));
  downloadCSV(`${label}.csv`, toCSV(rows));
  return rows;
}
// group B: free-text description -> WorldSpec, which the rule baseline cannot do at all
async function runExtraction(cases) {
  if (!S.sample) { console.warn("Claude 不可用"); return; }
  S.ctl = new AbortController();
  const rows = [], props = [], styles = [];
  for (const c of cases || PRESETS.map(p => ({ id: p.key, text: p.text, gold: normalizeSpec(p.spec) }))) {
    let got = null, err = "";
    try { got = normalizeSpec(resolveRelationNames(await llmPlan(c.text, {}))); } catch (e) { err = e.message || String(e); }
    if (got) { props.push(...proposalRows(c.id, got)); styles.push({ case: c.id, ...got.style, landmarks: (got.style.landmarks || []).join("|") }); }
    rows.push({ case: c.id, err, ...(got ? compareSpecs(c.gold, got) : {}) });
    console.log(rows[rows.length - 1]);
  }
  console.table(rows);
  console.table(props);
  window.__extraction = { rows, props, styles };
  console.log("复制用：copy(toCSV(window.__extraction.props))  —— 逐条标注 label 列：合理 / 不合理 / 无关");
  return { rows, props, styles };
}
// run the relation-proposal stage on each preset (map is repaired first, so the facts are the ones the agent would see)
async function runRelationProposals(opts = {}) {
  if (!S.sample) { console.warn("Claude 不可用"); return; }
  S.ctl = new AbortController();
  const rows = [];
  for (const p of PRESETS) {
    const spec = normalizeSpec(p.spec);
    let W = derive(spec, initParams(spec)), rep = verify(W, null);
    for (let i = 0; i < (opts.maxIter || 5) && rep.fails.length; i++) {
      const pol = scriptedStructured(W, rep, []); if (!pol.actions.length) break;
      const r = applyActions(W, pol.actions); W = r.W; rep = verify(W, null);
    }
    let rels = [];
    try { rels = await llmRelations(W, {}); } catch (e) { console.warn(p.key, e.message); }
    const spec2 = normalizeSpec({ ...spec, relations: rels });
    const W2 = derive(spec2, W.P), rep2 = verify(W2, null);
    for (const rl of spec2.relations) {
      const chk = rep2.checks.find(c => c.id === `spec.rel.${rl.id}`);
      rows.push({ case: p.key, kind: "relation", subject: nameOf(W2, rl.a), constraint: `${REL_ZH[rl.type]}${rl.type === "within_days_of" ? " " + rl.days + " 天" : ""} → ${nameOf(W2, rl.b)}`,
        rationale: rl.rationale || "", holds_on_map: chk ? (chk.pass ? 1 : 0) : "", measured: chk ? chk.measured : "", label_A: "", label_B: "" });
    }
    console.log(p.key, rels.length, "relations");
  }
  console.table(rows);
  window.__relations = rows;
  console.log("复制用：copy(toCSV(window.__relations))");
  return rows;
}
// crude field-level agreement between a gold WorldSpec and an extracted one
// the model writes relations with settlement names; turn them into the ids normalizeSpec expects
function resolveRelationNames(raw) {
  if (!raw || !Array.isArray(raw.settlements)) return raw;
  const byName = {};
  raw.settlements.forEach((s, k) => { if (s && s.name) byName[String(s.name).trim()] = "S" + (k + 1); });
  if (Array.isArray(raw.relations)) raw.relations = raw.relations.map(rl => rl && ({ ...rl, a: byName[String(rl.a).trim()] || rl.a, b: byName[String(rl.b).trim()] || rl.b })).filter(Boolean);
  return raw;
}
// every proposed constraint, one row per proposal, for hand labelling (合理 / 不合理 / 无关)
function proposalRows(caseId, spec) {
  const rows = [];
  for (const s of spec.settlements) for (const q of s.proposed || [])
    rows.push({ case: caseId, kind: "requirement", subject: s.name, type: TYPE_ZH[s.type], region: REGION_ZH[s.region] || "", constraint: REQ_ZH[q] || q, rationale: s.rationale || "", label: "" });
  for (const rl of spec.relations || []) {
    if (rl.source !== "proposed") continue;
    const A = spec.settlements.find(q => q.id === rl.a), B = spec.settlements.find(q => q.id === rl.b);
    rows.push({ case: caseId, kind: "relation", subject: A ? A.name : rl.a, type: "", region: "", constraint: `${REL_ZH[rl.type]}${rl.type === "within_days_of" ? " " + rl.days + " 天" : ""} → ${B ? B.name : rl.b}`, rationale: rl.rationale || "", label: "" });
  }
  return rows;
}
function compareSpecs(gold, got) {
  // invented settlements and ranges are the planner's additions, not extractions: score only what it claims to have read
  const own = got.settlements.filter(s => !s.invented), ownM = got.mountains.filter(m => !m.invented);
  const setOf = ss => new Set(ss.map(s => `${s.type}|${s.region}|${[...s.requires].sort().join("+")}`));
  const g = setOf(gold.settlements), h = setOf(own);
  const inter = [...h].filter(x => g.has(x)).length;
  return {
    ocean_side: gold.ocean_side === got.ocean_side ? 1 : 0,
    wind_from: gold.wind_from === got.wind_from ? 1 : 0,
    n_mountains: ownM.length, gold_mountains: gold.mountains.length,
    mountain_region_hits: ownM.filter(m => gold.mountains.some(q => q.region === m.region)).length,
    n_settlements: own.length, gold_settlements: gold.settlements.length,
    n_invented: got.settlements.length - own.length, n_invented_mountains: got.mountains.length - ownM.length,
    landform: got.landform || "", scale: got.scale || "region", n_character: (got.character || []).length,
    settlement_precision: +(inter / Math.max(1, h.size)).toFixed(2),
    settlement_recall: +(inter / Math.max(1, g.size)).toFixed(2),
    min_rivers_match: gold.min_major_rivers === got.min_major_rivers ? 1 : 0,
    n_proposed: own.reduce((a, s) => a + (s.proposed || []).length, 0),
    n_relations: (got.relations || []).length,
    era: got.style.era, street_pattern: got.style.street_pattern,
  };
}
function downloadCSV(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- settlement plans (generated in the background) ----------
function plansReady(W) { return !!(W._roads && W._plans && W.spec.settlements.every(s => W._plans[s.id])); }
function schedulePlans(W) {
  if (plansReady(W) || W._planJob) return;
  W._planJob = true;
  const todo = W.spec.settlements.slice();
  const step = () => {
    if (!W._roads) buildRoads(W);
    else { const s = todo.shift(); if (s) cityPlan(W, s); }
    if (todo.length || !W._roads) { setTimeout(step, 0); return; }
    W._planJob = false;
    const sn = curSnap();
    if (sn && sn.W === W) { renderMap(); renderCity(); }
  };
  setTimeout(step, 30);
}
function selectCity(sid) { S.city = sid; renderCity(); if (S.view === "2d") renderMap(); else if (V3.ok) { V3.dirty = true; buildMarkers3D(curSnap()); } }
function renderCity() {
  const sn = curSnap(), tabs = $("#cityTabs"), cv = $("#cityCanvas");
  if (!sn) { tabs.innerHTML = ""; return; }
  const W = sn.W, list = W.spec.settlements;
  if (!list.length) { tabs.innerHTML = `<p class="empty">这个区域没有聚落。</p>`; return; }
  if (!list.some(s => s.id === S.city)) S.city = (list.find(s => s.type === "city") || list.find(s => s.type === "port") || list[0]).id;
  tabs.innerHTML = list.map(s => `<button type="button" data-sid="${s.id}" aria-pressed="${s.id === S.city}">${esc(s.name)}<small>${TYPE_ZH[s.type]}</small></button>`).join("");
  tabs.querySelectorAll("button").forEach(b => b.onclick = () => selectCity(b.dataset.sid));
  const s = list.find(q => q.id === S.city);
  $("#cityTitle").textContent = s.name;
  const reg = REGION_ZH[regionOf(...W.P.pos[s.id])];
  if (!plansReady(W)) { $("#citySub").textContent = "正在生成城市规划…"; const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height); $("#cityLegend").innerHTML = ""; $("#cityLandmarks").innerHTML = ""; schedulePlans(W); return; }
  const P = cityPlan(W, s);
  const f = settlementFacts(W, s);
  $("#citySub").textContent = `${TYPE_ZH[s.type]}，位于${reg}部，${BIOME_ZH[f.biome]}${f.coastal ? "，临海" : ""}${f.river ? `，${nameOf(W, f.river)}流经` : ""}。图示范围约 ${Math.round(P.EXT * 2.7 * KM_PER_CELL)} km 见方，城镇按示意比例放大。风格：${ERA_ZH[P.style.era]}·${PATTERN_ZH[P.style.street_pattern]}·街区 ${P.style.block_scale}×·楼高 ${P.style.building_height}×${P.walls.length ? "·有城墙" : ""}。`;
  drawCityDetail(W, P);
  const total = Object.values(P.zoneCells).reduce((a, b) => a + b, 0) || 1;
  const zones = Object.entries(P.zoneCells).sort((a, b) => b[1] - a[1]);
  $("#cityLegend").innerHTML = zones.map(([z, n]) => `<li data-zone="${z}"><span class="sw" style="background:${ZONES[z].block || ZONES[z].ground}"></span>${ZONES[z].zh}<b>${Math.round(n / total * 100)}%</b></li>`).join("")
    + `<li data-zone="road"><span class="sw road"></span>主干道与环路</li>` + (P.walls.length ? `<li><span class="sw wall"></span>城墙</li>` : "");
  $("#cityLegend").querySelectorAll("li[data-zone]").forEach(li => {
    li.onmouseenter = () => { S.cityZoneHl = li.dataset.zone === "road" ? null : li.dataset.zone; drawCityDetail(W, P); };
    li.onmouseleave = () => { S.cityZoneHl = null; drawCityDetail(W, P); };
  });
  const counts = {}; for (const L of P.landmarks) counts[L.kind] = (counts[L.kind] || 0) + 1;
  $("#cityLandmarks").innerHTML = Object.entries(counts).map(([k, n]) => `<li><span class="ic">${LANDMARK[k].icon}</span>${LANDMARK[k].zh}${n > 1 ? ` ×${n}` : ""}</li>`).join("")
    + `<li class="meta">${P.blocks.length} 个街区，${P.buildings.length} 栋建筑</li>`;
}
function drawCityDetail(W, P) {
  const cv = $("#cityCanvas"), ctx = cv.getContext("2d"), SZ = cv.width;
  const view = P.EXT * 1.35, k = SZ / (2 * view);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, SZ, SZ);
  const sn = curSnap();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseImage(sn, "2d"), P.CX - view, P.CY - view, 2 * view, 2 * view, 0, 0, SZ, SZ);
  ctx.fillStyle = "rgba(245,244,238,0.18)"; ctx.fillRect(0, 0, SZ, SZ);
  if (!P._viewWater) P._viewWater = viewWaterCanvas(W, P.CX - view, P.CY - view, 2 * view, 420);
  ctx.drawImage(P._viewWater, 0, 0, SZ, SZ);
  // regional context: rivers, fields, roads leading out
  ctx.save(); ctx.setTransform(k, 0, 0, k, SZ / 2 - P.CX * k, SZ / 2 - P.CY * k);
  ctx.save(); ctx.translate(P.CX, P.CY); drawFields(ctx, P); ctx.restore();
  for (const rd of buildRoads(W)) {
    if (rd.a !== P.id && rd.b !== P.id && !rd.pts.some(([x, y]) => Math.abs(x - P.CX) < view && Math.abs(y - P.CY) < view)) continue;
    for (const [col, w] of [["rgba(90,70,40,0.6)", 0.34], [rd.major ? "#f7e7a8" : "#f4efe2", 0.24]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); rd.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  ctx.translate(P.CX, P.CY);
  drawPlan(ctx, W, P, { unitPx: k, hlZone: S.cityZoneHl });
  ctx.restore();
  // landmark labels
  const toPx = (u, v) => [SZ / 2 + u * k, SZ / 2 + v * k];
  const placed = [];
  for (const L of P.landmarks) {
    const [x, y] = toPx(L.u, L.v);
    const label = LANDMARK[L.kind].zh;
    let ly = y - L.h * k / 2 - 12;
    while (placed.some(p => Math.abs(p[0] - x) < 60 && Math.abs(p[1] - ly) < 16)) ly -= 16;
    placed.push([x, ly]);
    ctx.fillStyle = "rgba(31,43,46,0.85)"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    if (ly < y - L.h * k / 2 - 13) { ctx.strokeStyle = "rgba(31,43,46,0.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ly + 6); ctx.stroke(); }
    halo(ctx, `${LANDMARK[L.kind].icon} ${label}`, x, ly, `600 13px ${SANS}`, INK, "center");
  }
  halo(ctx, P.name, 16, 24, `700 24px ${SERIF}`, INK, "left");
  // scale bar
  const bar = 10 / KM_PER_CELL * k; ctx.fillStyle = INK; ctx.fillRect(SZ - 24 - bar, SZ - 24, bar, 4);
  halo(ctx, "10 km（示意）", SZ - 24 - bar / 2, SZ - 36, `500 12px ${SANS}`, INK, "center");
}

// ---------- rendering: map ----------
const BIOME_RGB = {
  snow: [240, 241, 238], rock: [150, 140, 128], tundra: [176, 178, 150], taiga: [86, 116, 88], steppe: [198, 186, 128],
  desert: [220, 196, 142], grassland: [158, 182, 108], forest: [100, 138, 78], marsh: [104, 134, 110], rainforest: [66, 112, 74],
  ice: [228, 237, 242], savanna: [196, 180, 108], jungle: [52, 106, 62], playa: [226, 218, 198],
};
function hyps(rel) {
  const stops = [[0, [120, 158, 104]], [0.1, [170, 186, 124]], [0.2, [204, 192, 134]], [0.3, [186, 150, 104]], [0.4, [140, 116, 96]], [0.5, [236, 234, 228]]];
  for (let k = 1; k < stops.length; k++) if (rel <= stops[k][0]) { const [a, ca] = stops[k - 1], [b, cb] = stops[k]; const t = (rel - a) / (b - a); return ca.map((v, j) => v + (cb[j] - v) * t); }
  return stops[stops.length - 1][1];
}
function boxBlur(src, r) {
  const t = new Float32Array(NN), o = new Float32Array(NN);
  for (let y = 0; y < N; y++) { let acc = 0, c = 0; for (let x = -r; x < N + r; x++) { const a = x + r, b = x - r - 1; if (a >= 0 && a < N) { acc += src[y * N + a]; c++; } if (b >= 0 && b < N) { acc -= src[y * N + b]; c--; } if (x >= 0 && x < N) t[y * N + x] = acc / c; } }
  for (let x = 0; x < N; x++) { let acc = 0, c = 0; for (let y = -r; y < N + r; y++) { const a = y + r, b = y - r - 1; if (a >= 0 && a < N) { acc += t[a * N + x]; c++; } if (b >= 0 && b < N) { acc -= t[b * N + x]; c--; } if (y >= 0 && y < N) o[y * N + x] = acc / c; } }
  return o;
}
// relief shading: multi-directional hillshade + cast shadows + ambient occlusion
function shading(W) {
  if (W._shade) return W._shade;
  const Z = 70, sea = W.P.sea, H = new Float32Array(NN);
  for (let i = 0; i < NN; i++) H[i] = W.ocean[i] ? 0 : W.hy.lake[i] ? (W.hy.surf[i] - sea) * Z : Math.max(0, W.h[i] - sea) * Z;
  const hill = new Float32Array(NN);
  const L = [[-1, -1, 0.62, 0.70], [-1, 0.3, 0.2, 0.9], [0.2, -1, 0.18, 0.9]]; // dir to light (x,y), weight, altitude
  const lights = L.map(([lx, ly, w, alt]) => { const d = Math.hypot(lx, ly); return [lx / d * Math.cos(alt), ly / d * Math.cos(alt), Math.sin(alt), w]; });
  const norm = lights.reduce((a, l) => a + l[3] * l[2], 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const gx = (H[y * N + Math.min(N - 1, x + 1)] - H[y * N + Math.max(0, x - 1)]) / 2;
    const gy = (H[Math.min(N - 1, y + 1) * N + x] - H[Math.max(0, y - 1) * N + x]) / 2;
    const l = Math.hypot(gx, gy, 1), nx = -gx / l, ny = -gy / l, nz = 1 / l;
    let v = 0; for (const [a, b, c, w] of lights) v += w * Math.max(0, nx * a + ny * b + nz * c);
    hill[i] = v / norm;
  }
  // cast shadows from the NW sun (altitude ~28°)
  const hor = new Float32Array(NN), sh = new Float32Array(NN), drop = Math.tan(0.49) * 1.414;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (x > 0 && y > 0) { const j = i - N - 1; hor[i] = Math.max(H[j], hor[j]) - drop; } else hor[i] = 0;
    sh[i] = clamp((hor[i] - H[i]) / 2.5, 0, 1);
  }
  const shadow = boxBlur(sh, 1);
  const blur = boxBlur(H, 7), ao = new Float32Array(NN);
  for (let i = 0; i < NN; i++) ao[i] = clamp(1 - (blur[i] - H[i]) * 0.045, 0.72, 1.08);
  const dLand = distField(i => !W.ocean[i]);
  W._shade = { hill, shadow, ao, dLand };
  return W._shade;
}
function baseImage(sn, mode = "2d") {
  const key = mode + S.layers.base;
  sn.bases = sn.bases || {};
  if (sn.bases[key]) return sn.bases[key];
  const W = sn.W, off = document.createElement("canvas"); off.width = off.height = N;
  const { hill, shadow, ao, dLand } = shading(W);
  const ctx = off.getContext("2d"), img = ctx.createImageData(N, N), d = img.data;
  const tex = mode === "tex", atlas = !tex && S.layers.base === "atlas";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; let c;
    const grain = 1 + (((x * 73856093) ^ (y * 19349663)) % 7) * 0.004;
    if (atlas) {
      // atlas: flat biome tints and a near-uniform sea, like a printed overview map; relief is only a faint tone
      if (W.ocean[i]) { const near = 1 - smooth(0, 6, dLand[i]); c = [70 + 26 * near, 110 + 24 * near, 150 + 14 * near]; }
      else if (W.hy.lake[i]) c = [110, 160, 185];
      else { const rel = W.h[i] - W.P.sea; c = BIOME_RGB[W.biome[i]].map(v => Math.min(255, v * (0.85 + rel * 0.5) * (0.95 + 0.08 * hill[i]))); }
    } else if (W.ocean[i]) {
      const depth = clamp((W.P.sea - W.h[i]) / 0.32, 0, 1), near = smooth(0, 14, dLand[i]);
      const t = clamp(0.35 * depth + 0.65 * near, 0, 1);
      c = [150 - 100 * t, 198 - 98 * t, 200 - 72 * t];
      if (dLand[i] <= 1.5) c = c.map(v => v + 26);
      if (!tex) c = c.map(v => v * (1 - 0.25 * shadow[i]));
    } else if (W.hy.lake[i]) {
      const dep = clamp((W.hy.surf[i] - W.h[i]) / 0.08, 0, 1);
      c = [128 - 50 * dep, 176 - 44 * dep, 186 - 26 * dep];
      if (!tex) c = c.map(v => v * (1 - 0.25 * shadow[i]));
    } else {
      c = S.layers.base !== "elev" ? BIOME_RGB[W.biome[i]] : hyps(W.h[i] - W.P.sea);
      if (S.layers.base !== "elev") { const rel = W.h[i] - W.P.sea; c = c.map(v => v * (0.92 + rel * 0.3)); }
      const lit = tex ? (0.82 + 0.22 * hill[i]) * ao[i] : (0.42 + 0.66 * hill[i]) * (1 - 0.38 * shadow[i]) * ao[i];
      c = c.map(v => v * lit * grain);
    }
    const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  sn.bases[key] = off;
  return off;
}
function riverLabelCells(W) {
  if (W._rl) return W._rl;
  const by = new Map();
  for (let i = 0; i < NN; i++) if (W.hy.channel[i] && !W.hy.lake[i]) { const r = W.hy.riverOfSys.get(W.hy.sys[i]); if (r) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(i); } }
  W._rl = W.hy.rivers.map(r => { const cells = (by.get(r.id) || []).sort((a, b) => W.hy.acc[a] - W.hy.acc[b]); return cells.length ? { r, i: cells[Math.floor(cells.length * 0.55)] } : null; }).filter(Boolean);
  return W._rl;
}
function drawRivers(ctx, W, k, wmul = 1, minBucket = 0) {
  const thr = W.P.riverThr, buckets = [[], [], [], [], [], []];
  for (let i = 0; i < NN; i++) {
    if (!W.hy.channel[i] || W.hy.lake[i]) continue; const d = W.hy.down[i]; if (d < 0) continue;
    buckets[clamp(Math.floor(Math.log2(W.hy.acc[i] / thr)), 0, 5)].push(i, d);
  }
  const c = i => [(i % N + 0.5) * k, (Math.floor(i / N) + 0.5) * k];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  buckets.forEach((arr, b) => {
    if (b < minBucket) return;
    const w = (0.45 + b * 0.5) * wmul;
    for (const [col, extra] of (b >= 2 ? [["rgba(28,58,74,0.28)", 0.9 * wmul], ["#4a86a2", 0]] : [["#5b93ad", 0]])) {
      ctx.strokeStyle = col; ctx.lineWidth = w + extra; ctx.beginPath();
      for (let j = 0; j < arr.length; j += 2) { const [x1, y1] = c(arr[j]), [x2, y2] = c(arr[j + 1]); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    }
  });
}
const INK = "#1f2b2e", FLAG = "#b4235f", LORE = "#a06c10";
function halo(ctx, text, x, y, font, color, align = "left") {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(244,246,240,0.9)"; ctx.lineJoin = "round"; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function renderMap() {
  if (S.view === "3d" && V3 && V3.ok) { update3D(); return; }
  if (S.view === "game" && V3 && V3.ok) { renderGameMap(); return; }
  render2D();
}
function render2D() {
  const cv = $("#map"), ctx = cv.getContext("2d"), SZ = cv.width, k = SZ / N;
  const sn = curSnap();
  ctx.clearRect(0, 0, SZ, SZ);
  if (!sn) { ctx.fillStyle = "#dfe4de"; ctx.fillRect(0, 0, SZ, SZ); halo(ctx, "地图会显示在这里", SZ / 2, SZ / 2, `500 24px ${SERIF}`, INK, "center"); return; }
  const W = sn.W;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(baseImage(sn, "2d"), 0, 0, SZ, SZ);
  const c = i => [(i % N + 0.5) * k, (Math.floor(i / N) + 0.5) * k];
  if (S.layers.grid) {
    ctx.save(); ctx.strokeStyle = "rgba(31,43,46,0.35)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
    for (const t of [1, 2]) { ctx.beginPath(); ctx.moveTo(t * SZ / 3, 0); ctx.lineTo(t * SZ / 3, SZ); ctx.moveTo(0, t * SZ / 3); ctx.lineTo(SZ, t * SZ / 3); ctx.stroke(); }
    ctx.restore();
    REGIONS.forEach((r, j) => halo(ctx, REGION_ZH[r], (j % 3) * SZ / 3 + 8, Math.floor(j / 3) * SZ / 3 + 14, `500 12px ${SANS}`, "rgba(31,43,46,0.6)"));
    // scale bar
    const bkm = 100 * kmOf(W), px = bkm / kmOf(W) * k; ctx.fillStyle = INK; ctx.fillRect(SZ - 24 - px, SZ - 22, px, 4);
    halo(ctx, `${bkm} km`, SZ - 24 - px / 2, SZ - 34, `500 12px ${SANS}`, INK, "center");
  }
  if (S.layers.rivers) {
    drawRivers(ctx, W, k, 1, S.layers.base === "atlas" ? 1 : 0);
    for (const { r, i } of riverLabelCells(W)) { const [x, y] = c(i); halo(ctx, r.name, x + 6, y - 8, `italic 500 13px ${SERIF}`, S.highlight === r.id ? LORE : "#2f5c75"); }
    for (const l of W.hy.lakes.slice(0, 5)) halo(ctx, l.name, (l.cx + 0.5) * k, (l.cy + 0.5) * k, `italic 500 12px ${SERIF}`, "#2f5c75", "center");
    if (W.P.hydro !== "filled") { ctx.fillStyle = "#2f5c75"; for (const s of W.hy.sinks) { const [x, y] = c(s.i); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); } }
  }
  for (const { m, cell } of mountainPeaks(W)) {
    const x = (cell[0] + 0.5) * k, y = (cell[1] + 0.5) * k, hl = S.highlight === m.id;
    ctx.fillStyle = hl ? LORE : INK; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x - 5, y + 3); ctx.closePath(); ctx.fill();
    halo(ctx, m.name, x, y + 16, `600 16px ${SERIF}`, hl ? LORE : INK, "center");
  }
  const ready = plansReady(W);
  if (!ready) schedulePlans(W);
  if (S.layers.settle) for (const hm of hamlets(W)) {
    const x = (hm.x + 0.5) * k, y = (hm.y + 0.5) * k;
    ctx.fillStyle = "#f4f6f0"; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); ctx.stroke();
    halo(ctx, hm.name, x + 6, y, `500 11px ${SERIF}`, "rgba(31,43,46,0.82)");
  }
  if (S.layers.settle && ready) {
    drawRegionalOverlay(ctx, W, k);
    for (const s of W.spec.settlements) {
      const P = cityPlan(W, s), x = P.CX * k, y = P.CY * k, hl = S.highlight === s.id || S.city === s.id;
      if (hl) { ctx.strokeStyle = S.highlight === s.id ? LORE : "rgba(31,43,46,0.7)"; ctx.lineWidth = 2; ctx.setLineDash(S.highlight === s.id ? [] : [4, 3]); ctx.beginPath(); ctx.arc(x, y, P.R * k + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      halo(ctx, s.name, x, y - P.R * k * 0.9 - 8, `700 ${s.type === "city" || s.type === "port" ? 16 : 13}px ${SERIF}`, S.highlight === s.id ? LORE : INK, "center");
    }
  }
  if (S.layers.settle && !ready) for (const s of W.spec.settlements) {
    const [px, py] = W.P.pos[s.id]; const x = (px + 0.5) * k, y = (py + 0.5) * k;
    const hl = S.highlight === s.id;
    if (hl) { ctx.strokeStyle = LORE; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke(); }
    ctx.fillStyle = "#f4f6f0"; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    if (s.type === "fortress") ctx.rect(x - 5.5, y - 5.5, 11, 11);
    else ctx.arc(x, y, s.type === "city" ? 7 : s.type === "town" || s.type === "port" ? 5.5 : 4, 0, 7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    if (s.type === "city") { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    if (s.type === "port") { ctx.beginPath(); ctx.moveTo(x, y - 3.5); ctx.lineTo(x, y + 3.5); ctx.moveTo(x - 3, y + 1); ctx.quadraticCurveTo(x, y + 5, x + 3, y + 1); ctx.lineWidth = 1.4; ctx.stroke(); }
    halo(ctx, s.name, x + 10, y, `600 ${s.type === "city" || s.type === "port" ? 15 : 13}px ${SERIF}`, hl ? LORE : INK);
  }
  if (S.layers.marks) {
    const rep = reportOf(sn);
    const draw = (cc, n, style) => {
      for (const p of cc.at || []) {
        const x = (p[0] + 0.5) * k, y = (p[1] + 0.5) * k, focus = S.focus === cc.id;
        ctx.save();
        ctx.strokeStyle = style === "declared" ? "rgba(31,43,46,0.55)" : FLAG; ctx.lineWidth = focus ? 4 : 2.2;
        if (style === "declared") ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(x, y, focus ? 20 : 13, 0, 7); ctx.stroke();
        ctx.restore();
        const bx = x + 11, by = y - 12;
        ctx.fillStyle = style === "declared" ? "#56666a" : FLAG; ctx.beginPath(); ctx.arc(bx, by, 8, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `600 10px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), bx, by + 0.5);
      }
    };
    rep.checks.filter(x => x.status === "declared").forEach(x => draw(x, "×", "declared"));
    rep.fails.forEach((x, j) => draw(x, j + 1, "fail"));
  }
}
const SERIF = `"Noto Serif SC", "Songti SC", "STSong", serif`;
const SANS = `"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;

// ---------- boot ----------
initControls();
setViewMode(window.THREE ? "3d" : "2d");
renderLore(); updateEditButtonsSafe();
function updateEditButtonsSafe() { S.spec = S.spec || { settlements: [] }; updateEditButtons(); }
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => runAgent({ eng: "offline" }));   // the opening map never spends credit

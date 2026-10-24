// ===================== BENCHMARK HARNESS (shared by the node CLI and the browser) =====================
// Generates a test set, runs one repair loop per trial with a pluggable policy, and records metrics.
// No DOM and no rendering here, so the same code runs in node and in the page.

const BENCH_POOL = 30;        // the canonical test set size; always slice from this pool so T0xx is stable
const BENCH_NAMES = {
  city: ["白石城", "银门", "长风城", "高台城", "落日城", "铁砧城"],
  port: ["盐湾", "北锚", "潮门", "雾港", "鲸背港", "石梁港"],
  town: ["磨坊镇", "枫桥镇", "灰堰", "陶市", "三叉镇", "柳渡"],
  village: ["石屋村", "苇塘村", "松脚村", "冷泉村", "白沙村", "旧窑村"],
  fortress: ["铁门堡", "狼口关", "鹰巢堡", "断墙堡"],
};
const BENCH_MTN = ["鸦脊山", "霜冠岭", "断碑岭", "赤岩岭", "长牙山", "静默山"];

// A trial spec plus the ground truth we can check against (for the contradictory cases).
function makeTestSet(n = 48, seed = 20260101) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
  const out = [];
  const regionsFor = side => REGIONS.filter(x => {
    if (side === "E") return !x.endsWith("E");
    if (side === "W") return !x.endsWith("W") && x !== "W";
    if (side === "N") return !x.startsWith("N") && x !== "N";
    if (side === "S") return !x.startsWith("S") && x !== "S";
    return true;
  });
  const seaRegion = side => ({ E: "E", W: "W", N: "N", S: "S" }[side] || "C");
  for (let i = 0; i < n; i++) {
    const cat = i < n * 0.35 ? "simple" : i < n * 0.75 ? "multi" : "contradictory";
    const side = cat === "contradictory" ? (r() < 0.7 ? "none" : pick(["E", "W", "N", "S"])) : pick(["E", "W", "N", "S", "all", "none"]);
    const wind = pick(["E", "W", "N", "S"]);
    const inland = regionsFor(side);
    const nM = cat === "simple" ? 1 : 1 + Math.floor(r() * 2);
    const mountains = [];
    for (let k = 0; k < nM; k++) mountains.push({ name: BENCH_MTN[(i + k) % BENCH_MTN.length], region: pick(inland), orientation: r() < 0.5 ? "EW" : "NS" });
    const nS = cat === "simple" ? 2 + Math.floor(r() * 3) : 5 + Math.floor(r() * 4);
    const settlements = [], expectUnsat = [];
    const hasSea = side !== "none";
    for (let k = 0; k < nS; k++) {
      const type = k === 0 ? (hasSea && r() < 0.5 ? "port" : "city") : pick(["town", "village", "village", "town", "fortress"]);
      const region = pick(REGIONS);
      const requires = [];
      if (type === "port") requires.push("coast", ...(r() < 0.5 ? ["river_mouth"] : []));
      else if (type === "fortress") requires.push("near_mountain");
      else if (cat !== "simple" && r() < 0.6) requires.push(pick(["on_river", "lakeside", "near_mountain"]));
      settlements.push({ name: BENCH_NAMES[type][(i + k) % BENCH_NAMES[type].length], type, region, requires });
    }
    if (cat === "contradictory") {
      // only one unambiguous ground-truth conflict: a port in a spec with no ocean at all.
      // (Region-vs-coast conflicts also occur by accident in random specs, so they are reviewed by hand instead.)
      const id = "S" + (settlements.length + 1);
      settlements.push({ name: "无潮港", type: "port", region: pick(REGIONS), requires: ["coast"] });
      if (!hasSea) expectUnsat.push(`spec.req.${id}.coast`);
    }
    const spec = normalizeSpec({
      name: `测试${i + 1}`, seed: 1000 + i * 37, ocean_side: side, wind_from: wind,
      mountains, min_major_rivers: cat === "simple" ? 1 : 1 + Math.floor(r() * 3),
      min_lakes: cat === "simple" ? 0 : Math.floor(r() * 2), settlements,
    });
    out.push({ id: `T${String(i + 1).padStart(3, "0")}`, cat, spec, expectUnsat: expectUnsat.filter(Boolean) });
  }
  return out;
}

// policy:    async (W, report, history, iter) => {analysis, actions, stop}
// negotiate: async (W, briefs) => {analysis, actions} — optional conflict-resolution stage; null disables it,
//            which is the ablation condition (the repair policy then has to declare conflicts away by itself)
async function runTrial(trial, policy, opts = {}) {
  const { maxIter = 6, withLore = false, label = "", negotiate = null } = opts;
  const t0 = Date.now();
  let W = derive(trial.spec, initParams(trial.spec));
  let rep = verify(W, null);
  const hist = [], traj = [rep.fails.length];
  const seenFail = new Set(rep.fails.map(f => f.id));
  let flips = 0, regressions = 0, actionsTotal = 0, actionsFailed = 0, wasted = 0, stopped = "";
  let negotiations = 0, negotiateFailed = 0;
  const negotiated = new Set();
  let prevIds = new Set(rep.fails.map(f => f.id));
  const rec = { trial: trial.id, cat: trial.cat, policy: label, init: rep.fails.length };
  for (let it = 1; it <= maxIter; it++) {
    if (!rep.fails.length) { stopped = "converged"; break; }
    // conflict resolution, when enabled, runs before the repair policy and does not consume the iteration
    if (negotiate) {
      const briefs = conflictBriefs(W, rep).filter(b => !negotiated.has(b.key));
      if (briefs.length) {
        briefs.forEach(b => negotiated.add(b.key));
        let dec = null;
        try { dec = await negotiate(W, briefs); }
        catch (e) { stopped = "negotiate_error:" + (e.message || e).slice(0, 60); break; }
        if (dec && dec.actions && dec.actions.length) {
          const r = applyActions(W, dec.actions);
          negotiations++;
          negotiateFailed += r.results.filter(x => !x.ok).length;
          actionsTotal += r.results.length;
          actionsFailed += r.results.filter(x => !x.ok).length;
          hist.push({ actions: dec.actions, results: r.results, analysis: dec.analysis });
          W = r.W; rep = verify(W, null);
          traj.push(rep.fails.length);
          prevIds = new Set(rep.fails.map(f => f.id));
          if (!rep.fails.length) { stopped = "converged"; break; }
        }
      }
    }
    let pol;
    try { pol = await policy(W, rep, hist, it); }
    catch (e) { stopped = "policy_error:" + (e.message || e).slice(0, 60); break; }
    if (!pol || !pol.actions || !pol.actions.length) { stopped = "no_actions"; break; }
    if (pol.stop) { stopped = "agent_stop"; break; }
    const r = applyActions(W, pol.actions);
    hist.push({ actions: pol.actions, results: r.results, analysis: pol.analysis });
    actionsTotal += r.results.length;
    actionsFailed += r.results.filter(x => !x.ok || x.outside).length;
    W = r.W; rep = verify(W, withLore ? null : null);
    traj.push(rep.fails.length);
    const ids = new Set(rep.fails.map(f => f.id));
    for (const id of ids) { if (!prevIds.has(id)) { regressions++; if (seenFail.has(id)) flips++; } seenFail.add(id); }
    if (traj[traj.length - 1] >= traj[traj.length - 2]) wasted++;
    prevIds = ids;
    if (!rep.fails.length) { stopped = "converged"; break; }
  }
  if (!stopped) stopped = "max_iter";
  const declared = W.P.unsat.slice(), relaxed = (W.P.relaxed || []).slice();
  const cores = declared.map(id => {
    const sid = (id.split(".")[2] || "").split(":")[0];
    const st = W.spec.settlements.find(q => q.id === sid);
    const cf = st ? analyseConflict(W, st) : null;
    return `${id}=${cf ? cf.core.join("+") : "?"}`;
  }).join(" ; ");
  const expected = trial.expectUnsat;
  const tp = declared.filter(d => expected.includes(d)).length;
  const lastAnalysis = hist.length ? String(hist[hist.length - 1].analysis || "").slice(0, 160) : "";
  Object.assign(rec, {
    final_codes: [...new Set(rep.fails.map(f => f.code))].join("|"),
    last_analysis: lastAnalysis,
    final: rep.fails.length, iters: traj.length - 1, converged: rep.fails.length === 0 ? 1 : 0,
    rate: +rep.rate.toFixed(3), traj: traj.join(">"), stopped,
    actions: actionsTotal, actions_failed: actionsFailed, wasted_iters: wasted,
    regressions, oscillations: flips,
    declared: declared.length, declared_cores: cores, unsat_expected: expected.length,
    negotiations, negotiate_failed: negotiateFailed,
    relaxed: relaxed.length,
    relaxed_swaps: relaxed.filter(r => r.to).length,
    relaxed_explicit: relaxed.filter(r => { const st = W.spec.settlements.find(q => q.id === r.sid); return st && !(st.proposed || []).includes(r.item); }).length,
    relaxed_items: relaxed.map(r => `${r.sid}:${r.item}>${r.to || "drop"}`).join(" ; "),
    relaxed_reasons: relaxed.map(r => r.reason).join(" ; ").slice(0, 300),
    unsat_tp: tp, unsat_fp: declared.length - tp, unsat_fn: expected.length - tp,
    ms: Date.now() - t0,
  });
  return { rec, W, hist };
}

const SCRIPTED = {
  structured: label => ({ label, fn: async (W, rep, hist) => scriptedStructured(W, rep, hist) }),
  binary: label => ({ label, fn: async (W, rep, hist, it) => scriptedBlind(W, rep, hist, it) }),
  none: label => ({ label, fn: async () => ({ analysis: "", actions: [] }) }),
};
// the offline negotiator, in the shape runTrial expects
const SCRIPTED_NEGOTIATE = async (W, briefs) => scriptedNegotiate(W, briefs);

function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}
function summarise(rows) {
  const by = {};
  for (const r of rows) {
    const k = r.policy + "|" + r.cat;
    (by[k] = by[k] || []).push(r);
  }
  return Object.entries(by).map(([k, rs]) => {
    const mean = f => +(rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(2);
    const [policy, cat] = k.split("|");
    return {
      policy, cat, n: rs.length,
      converged: +(rs.filter(r => r.converged).length / rs.length).toFixed(2),
      init: mean(r => r.init), final: mean(r => r.final), iters: mean(r => r.iters),
      rate: mean(r => r.rate), actions: mean(r => r.actions), failed_actions: mean(r => r.actions_failed),
      wasted: mean(r => r.wasted_iters), regress: mean(r => r.regressions), osc: mean(r => r.oscillations),
      negotiations: mean(r => r.negotiations || 0), relaxed: mean(r => r.relaxed || 0),
      relaxed_swaps: mean(r => r.relaxed_swaps || 0), relaxed_explicit: mean(r => r.relaxed_explicit || 0),
      unsat_tp: rs.reduce((a, r) => a + r.unsat_tp, 0), unsat_fp: rs.reduce((a, r) => a + r.unsat_fp, 0), unsat_fn: rs.reduce((a, r) => a + r.unsat_fn, 0),
      ms: mean(r => r.ms),
    };
  });
}

// ---------- verifier reliability: inject known faults into a converged world ----------
const INJECTIONS = [
  { name: "naive_hydro", expect: "river_sink", apply: P => { P.hydro = "naive"; } },
  { name: "noise_climate", expect: "rain_shadow", apply: P => { P.climate = "noise"; } },
  { name: "flatten_range", expect: "mountain_weak", apply: P => { P.ridges.forEach(r => r.amp = 0.02); } },
  { name: "raise_river_threshold", expect: "few_rivers", apply: (P, W) => {
      if (W.spec.min_major_rivers === 0 || W.hy.rivers.length < W.spec.min_major_rivers) return false;
      P.unsat = (P.unsat || []).filter(id => id !== "spec.rivers"); // test the check, not an earlier waiver
      P.riverThr = Math.max(P.riverThr + 1, Math.round(P.riverThr * 6));
    } },
  { name: "drown_settlement", expect: "underwater", apply: (P, W) => {
      const s = W.spec.settlements[0]; if (!s) return false;
      for (let i = 0; i < NN; i++) if (W.ocean[i]) { P.pos[s.id] = cellXY(i); return true; }
      return false;
    } },
  { name: "settlement_to_peak", expect: "steep", apply: (P, W) => {
      const s = W.spec.settlements[0]; if (!s) return false;
      let best = -1, bs = 0;
      for (let i = 0; i < NN; i++) { if (W.ocean[i]) continue; const sl = slopeAt(W, i); if (sl > bs) { bs = sl; best = i; } }
      if (best < 0) return false; P.pos[s.id] = cellXY(best); return true;
    } },
  { name: "exile_settlement", expect: "wrong_region", apply: (P, W) => {
      const s = W.spec.settlements.find(q => q.region); if (!s) return false;
      const target = REGIONS.find(x => x !== s.region);
      for (let i = 0; i < NN; i++) { const [x, y] = cellXY(i); if (!W.ocean[i] && !W.hy.lake[i] && regionOf(x, y) === target) { P.pos[s.id] = [x, y]; return true; } }
      return false;
    } },
];
function ensureRiverShortage(W, P, injected) {
  // A sixfold threshold may leave enough major rivers. If so, exceed the maximum
  // accumulation to guarantee a real shortage with only one more rebuild.
  if (injected.hy.rivers.length >= W.spec.min_major_rivers) {
    let maxAcc = 0;
    for (const acc of injected.hy.acc) if (acc > maxAcc) maxAcc = acc;
    P.riverThr = Math.max(P.riverThr + 1, Math.ceil(maxAcc) + 1);
    injected = derive(W.spec, P);
  }
  return injected;
}
function injectionTest(trials, opts = {}) {
  const rows = [];
  let skipped = 0;
  for (const t of trials) {
    // start from a repaired (clean) world
    let W = derive(t.spec, initParams(t.spec));
    let rep = verify(W, null);
    for (let it = 0; it < (opts.maxIter || 6) && rep.fails.length; it++) {
      const pol = scriptedStructured(W, rep, []);
      if (!pol.actions.length) break;
      const r = applyActions(W, pol.actions); W = r.W; rep = verify(W, null);
    }
    if (rep.fails.length) { skipped++; continue; }   // only inject into worlds the verifier considers clean
    const baseCodes = new Set(rep.fails.map(f => f.code));
    for (const inj of INJECTIONS) {
      const P = JSON.parse(JSON.stringify(W.P));
      const ok = inj.apply(P, W);
      if (ok === false) continue;
      let W2 = derive(t.spec, P);
      const riverInjection = inj.name === "raise_river_threshold";
      if (riverInjection) W2 = ensureRiverShortage(W, P, W2);
      const faultCreated = riverInjection ? W2.hy.rivers.length < W.spec.min_major_rivers : null;
      const rep2 = verify(W2, null);
      const shadowChecks = inj.name === "noise_climate" ? rep2.checks.filter(c => c.code === "rain_shadow").length : null;
      const codes = new Set(rep2.fails.map(f => f.code));
      const detected = codes.has(inj.expect) && !baseCodes.has(inj.expect);
      const extra = [...codes].filter(c => !baseCodes.has(c) && c !== inj.expect);
      rows.push({ trial: t.id, injection: inj.name, expect: inj.expect, detected: detected ? 1 : 0,
        fault_created: faultCreated == null ? "" : (faultCreated ? 1 : 0),
        major_rivers_before: riverInjection ? W.hy.rivers.length : "",
        major_rivers_after: riverInjection ? W2.hy.rivers.length : "",
        major_rivers_required: riverInjection ? W.spec.min_major_rivers : "",
        river_threshold_after: riverInjection ? P.riverThr : "",
        applicable_shadow_checks: shadowChecks == null ? "" : shadowChecks,
        base_clean: baseCodes.size === 0 ? 1 : 0, extra_codes: extra.join("|") });
    }
  }
  rows.skipped = skipped;
  return rows;
}

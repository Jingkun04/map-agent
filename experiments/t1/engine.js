const { resolveRelationNames } = require('./runtime');
const clone = x => JSON.parse(JSON.stringify(x));

async function planOnce(rt, description) {
  const raw = resolveRelationNames(await rt.llmPlan(description, null));
  const spec = rt.normalizeSpec(raw);
  return { raw, spec: clone(spec), P: clone(rt.initParams(spec)), nameCoverage: rt.quotedNameCoverage(description, spec) };
}

function chooseBest(rt, a, b) { return rt.rankScore(b.score, a.score) < 0 ? b : a; }

// G1 is a simple physical-repair baseline. It runs one scripted pass for
// closed river basins and rain shadows, without semantic/spec repairs,
// negotiation, or an iterative search loop.
function singleRulePass(rt, W) {
  const before = rt.verify(W, null), score = rt.layeredScore(W, before);
  const pol = rt.scriptedStructured(W, before, []);
  const actions = (pol.actions || []).filter(a => ['fill_depressions', 'recompute_climate'].includes(a.tool));
  const trace = [];
  if (actions.length && !pol.stop) {
    const applied = rt.applyActions(W, actions);
    const after = rt.verify(applied.W, null), afterScore = rt.layeredScore(applied.W, after);
    const kept = rt.compareScore(afterScore, score) <= 0;
    trace.push({ round: 1, stage: 'simple_rule_pass', before: before.fails.length,
      after: kept ? after.fails.length : before.fails.length, actions: applied.results, kept });
    if (kept) W = applied.W;
  } else trace.push({ round: 1, stage: 'simple_rule_pass', before: before.fails.length,
    after: before.fails.length, actions: [], kept: false });
  const report = rt.verify(W, null);
  return { W, report, trace, score: rt.layeredScore(W, report) };
}

async function repair(rt, W, { mode, description, maxIter = 6 }) {
  const trace = [], hist = [], negotiated = new Set();
  let rep = rt.verify(W, null), score = rt.layeredScore(W, rep), best = { W, score };
  const llm = mode === 'G2';
  for (let it = 1; it <= maxIter && rep.fails.length; it++) {
    const briefs = rt.conflictBriefs(W, rep).filter(b => !negotiated.has(b.key));
    if (briefs.length) {
      briefs.forEach(b => negotiated.add(b.key));
      let decision;
      try { decision = llm ? await rt.llmNegotiate(W, briefs, description, null) : rt.scriptedNegotiate(W, briefs); }
      catch (e) { trace.push({ round: it, stage: 'negotiate', error: String(e) }); decision = { actions: [] }; }
      if (decision.actions.length) {
        const applied = rt.applyActions(W, decision.actions);
        const nextRep = rt.verify(applied.W, null), nextScore = rt.layeredScore(applied.W, nextRep);
        const kept = rt.compareScore(nextScore, score) <= 0;
        hist.push({ actions: decision.actions, results: applied.results, score: [score, nextScore], kept });
        trace.push({ round: it, stage: 'negotiate', analysis: decision.analysis, before: rep.fails.length,
          after: kept ? nextRep.fails.length : rep.fails.length, actions: applied.results, kept });
        if (kept) { W = applied.W; rep = nextRep; score = nextScore; best = chooseBest(rt, best, { W, score }); }
      }
      if (!rep.fails.length) break;
    }
    let pol;
    try { pol = llm ? await rt.llmRepair(W, rep, hist, 'structured', null) : rt.scriptedStructured(W, rep, hist); }
    catch (e) { trace.push({ round: it, stage: 'repair', error: String(e) }); break; }
    if (!pol.actions.length || pol.stop) { trace.push({ round: it, stage: 'repair', analysis: pol.analysis, stopped: true }); break; }
    let applied = rt.applyActions(W, pol.actions);
    let nextRep = rt.verify(applied.W, null), nextScore = rt.layeredScore(applied.W, nextRep);
    const sa = rt.compareScore(nextScore, score) > 0 ? rt.softAccept(nextScore, score, it, W.P.seed) : null;
    let kept = !sa || sa.ok, partial = false;
    if (!kept) {
      const subset = pol.actions.filter(a => a && ['move_settlement', 'declare_unsatisfiable'].includes(a.tool));
      if (subset.length && subset.length < pol.actions.length) {
        const p = rt.applyActions(W, subset), pr = rt.verify(p.W, null), ps = rt.layeredScore(p.W, pr);
        if (rt.compareScore(ps, score) <= 0 && rt.rankScore(ps, score) < 0) {
          applied = p; nextRep = pr; nextScore = ps; kept = true; partial = true;
        }
      }
    }
    hist.push({ actions: pol.actions, results: applied.results, score: [score, nextScore], kept,
      ...(sa?.ok ? { kept_though_worse: true } : {}) });
    trace.push({ round: it, stage: 'repair', analysis: pol.analysis, before: rep.fails.length,
      after: kept ? nextRep.fails.length : rep.fails.length, actions: applied.results, kept, partial });
    if (kept) { W = applied.W; rep = nextRep; score = nextScore; best = chooseBest(rt, best, { W, score }); }
  }
  W = best.W;
  return { W, report: rt.verify(W, null), trace, score: rt.layeredScore(W, rt.verify(W, null)) };
}

async function runFromPlannedSpec(rt, planned, description, mode, maxIter = 6) {
  let spec = rt.normalizeSpec(clone(planned.spec));
  let W = rt.derive(spec, clone(planned.P));
  const trace = [];
  if (mode === 'G2') {
    try {
      const rels = await rt.llmRelations(W, null);
      if (rels.length) {
        spec = rt.normalizeSpec({ ...clone(spec), relations: clone(rels) });
        W = rt.derive(spec, W.P);
      }
      trace.push({ stage: 'relations', count: rels.length, relations: clone(rels) });
    } catch (e) { trace.push({ stage: 'relations', error: String(e) }); }
    try {
      const review = await rt.llmCritique(W, description, 'pre', null);
      if (review.add.length) {
        const have = new Set((spec.character || []).map(c => c.metric));
        const add = review.add.filter(c => !have.has(c.metric));
        if (add.length) { spec = rt.normalizeSpec({ ...clone(spec), character: [...clone(spec.character || []), ...clone(add)] }); W = rt.derive(spec, W.P); }
      }
      let adopted = false;
      if (review.actions.length) {
        const applied = rt.applyActions(W, review.actions);
        if (rt.compareScore(rt.layeredScore(applied.W, rt.verify(applied.W, null)), rt.layeredScore(W, rt.verify(W, null))) <= 0) {
          W = applied.W; adopted = true;
        }
      }
      trace.push({ stage: 'pre_review', review: clone(review), adopted });
    } catch (e) { trace.push({ stage: 'pre_review', error: String(e) }); }
  }
  const repaired = mode === 'G1' ? singleRulePass(rt, W) : await repair(rt, W, { mode, description, maxIter });
  trace.push(...repaired.trace);
  W = repaired.W;
  let finalReview = null;
  if (mode === 'G2') {
    try { finalReview = clone(await rt.llmCritique(W, description, 'final', null)); }
    catch (e) { trace.push({ stage: 'final_review', error: String(e) }); }
  }
  return { W, spec: clone(W.spec), P: clone(W.P), report: {
    fails: repaired.report.fails.length, rate: repaired.report.rate,
    score: clone(repaired.score), checks: repaired.report.checks.map(c => ({ id: c.id, status: c.status, code: c.code })),
  }, trace, finalReview };
}

module.exports = { planOnce, runFromPlannedSpec, repair, singleRulePass };

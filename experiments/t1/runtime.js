// Run the exact browser core and shared model stages without the DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createRuntime(jsonCall) {
  const root = path.resolve(__dirname, '../..');
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
  for (const file of ['core.js', 'agent-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
  }
  context.LANGN = () => 'Chinese';
  context.llmJSON = async (prompt, stage) => jsonCall(prompt + '\n\nReply with one valid JSON object and nothing else.', stage);
  vm.runInContext(`globalThis.T1 = {
    normalizeSpec, initParams, derive, verify, layeredScore, compareScore, rankScore, softAccept,
    scoreText, applyActions, scriptedStructured, scriptedNegotiate, conflictBriefs,
    llmPlan, llmRelations, llmCritique, llmRepair, llmNegotiate, quotedNameCoverage,
    kmOf, N, NN
  };`, context);
  return context.T1;
}

function resolveRelationNames(raw) {
  if (!raw || !Array.isArray(raw.settlements)) return raw;
  const byName = {};
  raw.settlements.forEach((s, k) => { if (s && s.name) byName[String(s.name).trim()] = 'S' + (k + 1); });
  if (Array.isArray(raw.relations)) raw.relations = raw.relations.map(r => r && ({
    ...r, a: byName[String(r.a).trim()] || r.a, b: byName[String(r.b).trim()] || r.b,
  })).filter(Boolean);
  return raw;
}

module.exports = { createRuntime, resolveRelationNames };

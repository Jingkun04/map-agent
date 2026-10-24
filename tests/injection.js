// Verifier reliability: inject known faults into repaired worlds and check the verifier flags them.
// Usage: node tests/injection.js [nTrials]  -> writes results/injection.csv
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = f => fs.readFileSync(path.join(__dirname, "../src", f), "utf8").replace(/if \(typeof module[^\n]*\n/, "");
const ctx = { console, JSON, Math, Date }; vm.createContext(ctx);
vm.runInContext(src("core.js") + src("presets.js") + src("bench.js") + "\nthis.SCRIPTED = SCRIPTED;", ctx, { filename: "bundle.js" });
const trials = ctx.makeTestSet(+(process.argv[2] || 12));
const rows = ctx.injectionTest(trials);
const dir = path.join(__dirname, "../results"); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "injection.csv"), ctx.toCSV(rows));
const by = {};
for (const r of rows) {
  const b = by[r.injection] = by[r.injection] || { n: 0, valid: 0, hit: 0, extra: 0 };
  b.n++;
  // Only the river injection has an explicit fault oracle at present. A rain-shadow
  // sample is scored only if the injected map has a range that crosses the wind.
  if (r.injection === "raise_river_threshold" && r.fault_created !== 1) continue;
  if (r.injection === "noise_climate" && r.applicable_shadow_checks === 0) continue;
  b.valid++; b.hit += r.detected; b.extra += r.extra_codes ? 1 : 0;
}
console.table(Object.entries(by).map(([k, v]) => ({ injection: k, n: v.n, scored_samples: v.valid,
  invalid_river_faults: k === "raise_river_threshold" ? v.n - v.valid : "",
  inapplicable_shadow_samples: k === "noise_climate" ? v.n - v.valid : "",
  recall: v.valid ? +(v.hit / v.valid).toFixed(2) : null,
  with_side_effects: v.valid ? +(v.extra / v.valid).toFixed(2) : null })));
console.log("River faults are confirmed; rain-shadow samples without an applicable check are excluded. Other fault validity is not independently confirmed.");
console.log("clean base worlds:", trials.length - rows.skipped, "/", trials.length);

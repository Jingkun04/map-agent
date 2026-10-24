const assert = require('assert');
const C = require('../src/core.js');

const h = new Float32Array(C.NN).fill(0.6);
const ocean = new Uint8Array(C.NN);
const lake = new Uint8Array(C.NN);
const biome = Array(C.NN).fill('grassland');
const at = (x, y) => y * C.N + x;
for (const [x, y] of [[20, 20], [20, 21], [21, 20], [21, 21], [30, 30]]) h[at(x, y)] = 0.3;
h[at(0, 0)] = 0.3;
ocean[at(0, 0)] = 1;
lake[at(20, 20)] = 1;
biome[at(20, 21)] = 'playa';
biome[at(21, 20)] = 'desert';

const found = C.subseaLandDiagnostics({ h, ocean, hy: { lake }, biome, P: { sea: 0.4 } });
assert.deepStrictEqual([found.cells, found.dry, found.lake, found.desert], [5, 4, 1, 2]);
assert.deepStrictEqual(found.components.map(c => c.cells), [4, 1]);
assert.strictEqual(found.components[0].lake, 1);
assert.deepStrictEqual(C.subseaLandDiagnostics({
  h: new Float32Array(C.NN).fill(0.6), ocean, hy: { lake: new Uint8Array(C.NN) },
  biome, P: { sea: 0.4 },
}).components, []);

const { PRESETS } = require('../src/presets.js');
const spec = C.normalizeSpec(PRESETS[0].spec);
const report = C.verify(C.derive(spec, C.initParams(spec)));
const diag = report.diagnostics.find(d => d.code === 'subsea_land');
assert(diag && diag.cells === diag.dry + diag.lake);
assert(!report.checks.some(c => c.code === 'subsea_land'));
assert(!report.fails.some(c => c.code === 'subsea_land'));
const counted = report.checks.filter(c => c.status !== 'declared' && c.status !== 'relaxed');
assert.strictEqual(report.rate, counted.filter(c => c.pass).length / counted.length);
console.log('below-sea terrain diagnostics passed');

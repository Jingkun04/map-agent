// Focused geometry check: a diagonal ridge must be sampled across the wind.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8') +
  '\nthis.rainShadow = rainShadow; this.gridSize = N; this.gridCells = NN;', ctx);

const N = ctx.gridSize;
function sampleWorld(angle, wind, useOrientation = false) {
  const moisture = new Float32Array(ctx.gridCells);
  const rad = angle * Math.PI / 180, nx = -Math.sin(rad), ny = Math.cos(rad);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    moisture[y * N + x] = (x - N / 2) * nx + (y - N / 2) * ny > 0 ? 0.8 : 0.2;
  return {
    spec: { wind_from: wind },
    P: { ridges: [{ mid: 'M1', region: 'C', ...(useOrientation ? { orientation: 'NS' } : { angle }) }] },
    ocean: new Uint8Array(ctx.gridCells), hy: { lake: new Uint8Array(ctx.gridCells) }, moist: moisture,
  };
}
const mountain = { id: 'M1', region: 'C' };
const diagonal = ctx.rainShadow(sampleWorld(45, 'W'), mountain);
assert(diagonal.applicable && diagonal.leeward < diagonal.windward * 0.85);
const reversed = ctx.rainShadow(sampleWorld(45, 'E'), mountain);
assert(reversed.applicable && reversed.leeward > reversed.windward);
assert.strictEqual(ctx.rainShadow(sampleWorld(0, 'W'), mountain).applicable, false);
assert(ctx.rainShadow(sampleWorld(90, 'W', true), mountain).applicable);
console.log('rain-shadow angle and wind checks passed');

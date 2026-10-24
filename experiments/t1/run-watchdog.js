#!/usr/bin/env node
// Operational wrapper for the automated study. A stalled stage is recorded as
// a failure after ten minutes; completed stages remain untouched on restart.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const base = __dirname, dataFile = path.join(base, 'auto-descriptions.json'), out = path.join(base, 'auto-runs');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const timeoutMs = 10 * 60 * 1000;
const done = (dir, arm) => fs.existsSync(path.join(dir, `${arm}.json`)) || fs.existsSync(path.join(dir, `${arm}.failed.json`));
function nextPending() {
  for (const d of data) for (let sample = 1; sample <= 3; sample++) {
    const key = `${d.id}-${sample}`, dir = path.join(out, key), planned = fs.existsSync(path.join(dir, 'plan.json'));
    if (!done(dir, 'plan')) return { key, dir, arm:'plan' };
    if (planned && !done(dir, 'S0')) return { key, dir, arm:'S0' };
    if (planned && !done(dir, 'G1')) return { key, dir, arm:'G1' };
    const order = parseInt(crypto.createHash('sha256').update(key).digest('hex').slice(0, 2), 16) % 2 ? ['G0','G2'] : ['G2','G0'];
    for (const arm of order) if ((arm !== 'G2' || planned) && !done(dir, arm)) return { key, dir, arm };
  }
  return null;
}
async function once() {
  return new Promise((resolve, reject) => {
    const command = [path.join(base, 'run.js'), '--automated', '--data', dataFile, '--out', out, '--max-usd', '2'];
    const child = spawn(process.execPath, command, { stdio:['ignore','pipe','pipe'], windowsHide:true });
    let timedOut = null, timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = nextPending();
        console.error(`Stage timed out after ${timeoutMs / 1000}s: ${timedOut?.key || '?'} ${timedOut?.arm || '?'}`);
        child.kill();
      }, timeoutMs);
    };
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]])
      stream.on('data', chunk => { target.write(chunk); reset(); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (!timedOut) return resolve({ code, timeout:false });
      const file = path.join(timedOut.dir, `${timedOut.arm}.failed.json`);
      if (!done(timedOut.dir, timedOut.arm)) {
        fs.mkdirSync(timedOut.dir, { recursive:true });
        fs.writeFileSync(file, JSON.stringify({ error:'stage_timeout', timeout_s:timeoutMs / 1000,
          wall_s:timeoutMs / 1000, note:'Operational watchdog; scored as a failed sample, not replaced.' }, null, 2));
      }
      resolve({ code, timeout:true });
    });
    reset();
  });
}
async function main() {
  for (let restart = 0; restart < 100; restart++) {
    if (!nextPending()) return console.log('All automated generation stages complete.');
    const r = await once();
    if (!r.timeout) {
      if (r.code !== 0) throw new Error(`run.js exited ${r.code}; inspect output before resuming`);
      if (!nextPending()) return console.log('All automated generation stages complete.');
      throw new Error('run.js exited 0 with pending stages');
    }
  }
  throw new Error('Too many timed-out stages');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { nextPending };

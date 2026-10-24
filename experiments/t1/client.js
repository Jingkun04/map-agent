const fs = require('fs');
const path = require('path');
function loadEnv() {
  const file = path.resolve(__dirname, '../..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function parseJSON(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try { return JSON.parse(clean); } catch {}
  const a = clean.search(/[{[]/), b = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (a < 0 || b <= a) throw new Error('invalid_json');
  const body = clean.slice(a, b + 1);
  try { return JSON.parse(body); } catch {}
  const repaired = body.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(repaired); } catch { throw new Error('invalid_json'); }
}
function costEstimate(usage, model) {
  if (!usage || !model.startsWith('deepseek-')) return null;
  const pro = model === 'deepseek-v4-pro';
  const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens || 0) - hit);
  const offpeak = (hit * (pro ? .022 : .003) + miss * (pro ? .66 : .15) + (usage.completion_tokens || 0) * (pro ? 1.98 : .6)) / 1e6;
  return { offpeak_usd: offpeak, peak_usd: offpeak * 2 };
}
function createClient({ model = 'deepseek-flash', temperature = .7, maxTokens = 8000, maxUsd = null, onRecord = () => {} } = {}) {
  loadEnv();
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY missing from .env');
  let estimate = 0, calls = 0;
  async function callOnce(content, stage, { image = false, max_tokens = maxTokens } = {}) {
    if (maxUsd != null && estimate >= maxUsd) {
      const e = new Error(`API spending cap reached: $${maxUsd}`); e.code = 'API_BUDGET_REACHED'; throw e;
    }
    const started = Date.now(); let body, status;
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(180000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, thinking: { type: 'disabled' }, temperature,
          max_tokens, messages: [{ role: 'user', content }] }),
      });
      status = r.status;
      const payload = await r.text();
      try { body = JSON.parse(payload); } catch { body = { error: { message: payload.slice(0, 200) } }; }
    } catch (e) { onRecord({ stage, at: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000,
      error: e.message, status: status || null, usage: null }); throw e; }
    const message = body.choices?.[0]?.message?.content || '';
    const record = { stage, at: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000,
      model: body.model || model, temperature, thinking: 'disabled', status, finish_reason: body.choices?.[0]?.finish_reason,
      usage: body.usage || null, cost_actual: null, cost_estimated: costEstimate(body.usage, model),
      request: image ? { content: '[two local images]', prompt: content.filter(c => c.type === 'text').map(c => c.text).join('\n') } : { prompt: content },
      response: message || null };
    onRecord(record); calls++;
    estimate += record.cost_estimated?.peak_usd || 0; // enforce cap against the higher published rate
    if (!body.choices || !body.choices.length) throw new Error(`DeepSeek HTTP ${status}: ${JSON.stringify(body.error || {}).slice(0, 200)}`);
    if (status < 200 || status >= 300) throw new Error(`DeepSeek HTTP ${status}: ${JSON.stringify(body.error || {}).slice(0, 200)}`);
    return message;
  }
  async function call(content, stage, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await callOnce(content, attempt ? `${stage}:transport_retry${attempt}` : stage, opts); }
      catch (e) {
        const transient = /DeepSeek HTTP (429|500|502|503|504)\b|fetch failed|timeout|aborted/i.test(String(e.message));
        if (!transient || attempt >= 2 || e.code === 'API_BUDGET_REACHED') throw e;
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }
  async function json(prompt, stage, opts = {}) {
    try { return parseJSON(await call(prompt, stage, opts)); }
    catch (e) {
      if (e.message !== 'invalid_json') throw e;
      const note = '\n\nYour last reply was not valid JSON. Reply again with exactly one valid JSON object.';
      const retry = Array.isArray(prompt) ? [...prompt, { type: 'text', text: note }] : prompt + note;
      return parseJSON(await call(retry, stage + ':retry', opts));
    }
  }
  return { json, call, stats: () => ({ calls, conservative_peak_usd: estimate, cap_usd: maxUsd }) };
}
module.exports = { createClient, loadEnv, parseJSON, costEstimate };

// Local dev server: serves the built page and proxies the LLM stages to OpenRouter.
// The API key stays in .env on this machine; the page only ever talks to /api/llm.
//
//   python3 build.py && node server.js     then open http://localhost:8787
//
// .env (git-ignored):
//   OPENROUTER_API_KEY=sk-or-v1-...
//   OPENROUTER_MODEL_DEFAULT=anthropic/claude-sonnet-5.5   (optional)
//   OPENROUTER_MODEL_QUICK=anthropic/claude-haiku-5.5      (optional)
//   PORT=8787                                              (optional)
//   HISTORY_MAX=30                                         (optional: records kept in history/)
//
// It also keeps the page's generation history on disk, one JSON file per run in history/ (git-ignored), so records
// survive a cleared browser or a different browser.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
for (const line of (fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.OPENROUTER_API_KEY;
const PORT = +process.env.PORT || 8787;
const MODELS = {
  default: process.env.OPENROUTER_MODEL_DEFAULT || "anthropic/claude-sonnet-5.5",
  quick: process.env.OPENROUTER_MODEL_QUICK || "anthropic/claude-haiku-5.5",
};
const PAGE = path.join(ROOT, "dist", "region-map-agent.html");
const HIST_DIR = path.join(ROOT, "history");
const HIST_MAX = Math.max(1, +process.env.HISTORY_MAX || 30);

if (!KEY) { console.error("OPENROUTER_API_KEY is not set (put it in .env)"); process.exit(1); }

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Only accept calls from the page this server serves. Requiring a JSON content type forces a CORS preflight, which we
// never answer, so another site open in the same browser cannot spend the credit through localhost.
function sameOrigin(req) {
  const o = req.headers.origin;
  return (!o || o === `http://${req.headers.host}`) && /^application\/json\b/.test(req.headers["content-type"] || "");
}

async function readBody(req, limit = 2e6) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > limit) throw Object.assign(new Error("too_large"), { status: 413 }); }
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}

// ---------- history: one file per record, newest kept, the rest pruned ----------
const histFile = id => /^[a-z0-9]{1,24}$/.test(id) ? path.join(HIST_DIR, id + ".json") : null;
function histList() {
  if (!fs.existsSync(HIST_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(HIST_DIR)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), "utf8"))); } catch { console.warn("[history] unreadable", f); }
  }
  return out.filter(r => r && r.id).sort((a, b) => (b.t || 0) - (a.t || 0));
}
function histPrune() {
  for (const r of histList().slice(HIST_MAX)) { const f = histFile(r.id); if (f) fs.rmSync(f, { force: true }); }
}
async function history(req, res, id) {
  if (req.method === "GET" && !id) return send(res, 200, histList().slice(0, HIST_MAX));
  if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
  if (req.method === "DELETE" && !id) { fs.rmSync(HIST_DIR, { recursive: true, force: true }); return send(res, 200, { ok: true }); }
  const f = histFile(id || "");
  if (!f) return send(res, 400, { error: "bad_id" });
  if (req.method === "DELETE") { fs.rmSync(f, { force: true }); return send(res, 200, { ok: true }); }
  if (req.method === "PUT") {
    const rec = await readBody(req, 8e6);
    if (!rec || rec.id !== id || !rec.spec || !rec.P) return send(res, 400, { error: "bad_record" });
    fs.mkdirSync(HIST_DIR, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec));
    histPrune();
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "method" });
}

async function proxyLLM(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  if (typeof body.prompt !== "string" || !body.prompt) return send(res, 400, { error: "no_prompt" });
  const model = MODELS[body.tier] || MODELS.default;

  const ctl = new AbortController();
  res.on("close", () => ctl.abort());          // the page pressed Stop or went away: stop paying for tokens
  let up;
  try {
    up = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/xenonlyn/region-map-agent", "X-Title": "region-map-agent (DSA4213 group 12)",
      },
      body: JSON.stringify({ model, stream: true, max_tokens: 8000, messages: [{ role: "user", content: body.prompt }] }),
    });
  } catch (e) {
    if (ctl.signal.aborted) return;
    return send(res, 502, { error: "upstream_unreachable", detail: String(e) });
  }
  if (!up.ok) {
    const detail = await up.text();
    console.warn(`[llm] ${model} -> ${up.status} ${detail.slice(0, 300)}`);
    return send(res, up.status, { error: `upstream_${up.status}`, detail });
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Model": model });
  const t0 = Date.now();
  let tail = "", usage = null;
  try {
    for await (const chunk of up.body) {
      res.write(chunk);
      tail = (tail + Buffer.from(chunk).toString("utf8")).slice(-4000);   // the usage record arrives in the last event
    }
  } catch (e) { if (!ctl.signal.aborted) console.warn("[llm] stream broke:", e.message); }
  res.end();
  for (const line of tail.split("\n")) {
    if (line.startsWith("data:") && line.includes('"usage"')) try { usage = JSON.parse(line.slice(5)).usage || usage; } catch {}
  }
  console.log(`[llm] ${model} ${((Date.now() - t0) / 1000).toFixed(1)}s`
    + (usage ? ` in=${usage.prompt_tokens} out=${usage.completion_tokens}${usage.cost != null ? ` $${(+usage.cost).toFixed(5)}` : ""}` : ""));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (!fs.existsSync(PAGE)) return send(res, 500, "dist/region-map-agent.html is missing: run python3 build.py first", "text/plain");
    return send(res, 200, fs.readFileSync(PAGE), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/api/llm/health") return send(res, 200, { ok: true, provider: "openrouter", models: MODELS });
  const hm = url.pathname.match(/^\/api\/history(?:\/([^/]+))?$/);
  if (hm) return history(req, res, hm[1]).catch(e => { console.error("[history]", e.message); if (!res.headersSent) send(res, e.status || 500, { error: e.message }); });
  if (req.method === "POST" && url.pathname === "/api/llm") {
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    return proxyLLM(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: "proxy_failed" }); });
  }
  send(res, 404, { error: "not_found" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`region-map-agent on http://localhost:${PORT}  (default=${MODELS.default}, quick=${MODELS.quick})`);
});

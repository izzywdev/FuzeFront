#!/usr/bin/env node
/**
 * Shopify Navigator — self-hosted server.
 *
 * Zero-dependency Node.js (>=18) server that:
 *   1. Serves the PWA statically (STATIC_DIR).
 *   2. Proxies Claude calls at POST /api/message using a server-held
 *      ANTHROPIC_API_KEY, so end users don't need their own key.
 *      A client-supplied `x-user-api-key` header always takes precedence.
 *   3. Scans registered stores in the background every SCAN_INTERVAL_MS
 *      (default 10 min) and serves the resulting store profiles — this is the
 *      "real background scan" a pure PWA cannot do.
 *
 * Keyless-access policy: requests without `x-user-api-key` are served with the
 * server key only when the browser Origin is absent or matches this host —
 * i.e. the app this server itself serves (including the Android TWA). Other
 * web origins must bring their own key. Combined with per-IP rate limits and
 * a strict payload whitelist, this bounds abuse of the server-held key.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

/* ------------------------------ configuration ------------------------------ */
const PORT = parseInt(process.env.PORT || "8787", 10);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, ".."));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
const ANTHROPIC_VERSION = "2023-06-01";
const SCAN_MODEL = process.env.SCAN_MODEL || "claude-sonnet-5";
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || String(10 * 60 * 1000), 10);
const RATE_PER_MIN = parseInt(process.env.RATE_PER_MIN || "30", 10);          // per IP, /api/message
const SCAN_RATE_PER_MIN = parseInt(process.env.SCAN_RATE_PER_MIN || "6", 10); // per IP, scan endpoints
const GLOBAL_RATE_PER_MIN = parseInt(process.env.GLOBAL_RATE_PER_MIN || "300", 10);
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_STORES = 300;
const STORE_IDLE_EVICT_MS = 7 * 24 * 60 * 60 * 1000; // stop rescanning stores untouched for 7 days
const MAX_SCAN_FAILURES = 5;
const MAX_SCAN_QUEUE = 40; // bound the scan backlog so it can't grow without limit
// Trusted reverse-proxy hops in front of this server. The real client IP is the
// XFF entry `TRUST_PROXY` positions from the right (the value your own proxy
// appended). Behind the shipped Caddy stack this is 1. Set 0 for direct exposure
// (then X-Forwarded-For is ignored entirely and only the socket IP is used).
const TRUST_PROXY = parseInt(process.env.TRUST_PROXY || "1", 10);

const MODEL_ALLOWLIST = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "claude-opus-4-8",
]);
const TOOL_TYPE_ALLOWLIST = new Set(["web_search_20260209", "web_fetch_20260209"]);

/* --------------------------------- helpers --------------------------------- */
function log(...args) { console.log(new Date().toISOString(), ...args); }

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  }, extraHeaders || {}));
  res.end(body);
}

/* CORS for /api/*: cross-origin browsers MAY call the API, but the handlers
 * only honour the server-held key for same-origin requests — foreign origins
 * must send their own x-user-api-key. CORS here just unblocks that flow
 * (e.g. a Netlify-hosted copy of the app pointing at this server). */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-api-key",
  "access-control-max-age": "86400",
};

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function clientIp(req) {
  const sock = req.socket.remoteAddress || "unknown";
  if (TRUST_PROXY <= 0) return sock; // not behind a proxy — never trust XFF
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf !== "string" || !xf.length) return sock;
  // Take the entry our own trusted proxy appended (Nth from the right). Entries
  // to the left of it are client-supplied and must not be trusted for rate keys.
  const parts = xf.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return sock;
  const idx = parts.length - TRUST_PROXY;
  return parts[idx >= 0 ? idx : 0] || sock;
}

/* Origin is same-host when absent (native apps, curl, same-origin GET) or when
 * its host equals the Host header. Browsers always attach Origin to
 * cross-origin fetches, so foreign websites cannot pass this check. */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = String(req.headers.host || "").toLowerCase();
    return o.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/* ------------------------------- rate limiting ------------------------------ */
const rateBuckets = new Map(); // key -> array of timestamps (ms)
function rateLimited(key, perMin) {
  const now = Date.now();
  let arr = rateBuckets.get(key);
  if (!arr) { arr = []; rateBuckets.set(key, arr); }
  while (arr.length && now - arr[0] > 60_000) arr.shift();
  if (arr.length >= perMin) return true;
  arr.push(now);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of rateBuckets) {
    while (arr.length && now - arr[0] > 60_000) arr.shift();
    if (!arr.length) rateBuckets.delete(k);
  }
}, 5 * 60_000).unref();

/* ----------------------------- anthropic client ---------------------------- */
/* Fetch AND fully read the upstream body under a single deadline. The timer
 * must cover the body read too — clearing it once headers arrive leaves the
 * body stream able to hang forever (a slow/stuck upstream would pin the socket).
 * Returns { status, contentType, text }. */
async function anthropicRequest(payload, apiKey, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_BASE_URL + "/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, contentType: res.headers.get("content-type"), text };
  } finally {
    clearTimeout(timer);
  }
}

/* Full tool turn: follows pause_turn until end_turn (used by the store scan). */
async function anthropicToolTurn({ system, messages, max_tokens, tools, model, apiKey }) {
  let msgs = messages.slice();
  let data = null;
  for (let hop = 0; hop < 8; hop++) {
    const r = await anthropicRequest({ model, system, messages: msgs, max_tokens, tools }, apiKey, 180_000);
    try { data = JSON.parse(r.text); } catch { data = null; }
    if (!r.ok) {
      throw Object.assign(new Error((data && data.error && data.error.message) || `upstream ${r.status}`), { status: r.status });
    }
    if (data && data.stop_reason === "pause_turn") {
      msgs.push({ role: "assistant", content: data.content });
      continue;
    }
    return data; // terminal stop (end_turn / max_tokens / etc.)
  }
  // Ran out of hops while still paused — do not treat the partial as complete.
  throw new Error("tool turn did not converge (max hops reached)");
}

function textFromData(data) {
  return ((data && data.content) || []).map((b) => (b && b.type === "text" && b.text) || "").join("");
}

function extractJson(text) {
  let clean = String(text).replace(/```json|```/g, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}

/* ------------------------------ /api/message ------------------------------- */
function sanitizeMessagePayload(raw) {
  if (!raw || typeof raw !== "object") throw Object.assign(new Error("invalid payload"), { status: 400 });
  const model = String(raw.model || "");
  if (!MODEL_ALLOWLIST.has(model)) throw Object.assign(new Error("model not allowed"), { status: 400 });
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > 50) {
    throw Object.assign(new Error("invalid messages"), { status: 400 });
  }
  const out = { model, messages: raw.messages };
  // Coerce with Number() (not parseInt, which turns 1e21 -> 1 via "1e+21").
  let maxTokens = Math.floor(Number(raw.max_tokens));
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = 1024;
  out.max_tokens = Math.min(maxTokens, 4096);
  if (raw.system != null) {
    if (typeof raw.system !== "string" || raw.system.length > 60_000) {
      throw Object.assign(new Error("invalid system"), { status: 400 });
    }
    out.system = raw.system;
  }
  if (raw.tools != null) {
    if (!Array.isArray(raw.tools) || raw.tools.length > 4) throw Object.assign(new Error("invalid tools"), { status: 400 });
    out.tools = raw.tools.map((t) => {
      if (!t || !TOOL_TYPE_ALLOWLIST.has(t.type)) throw Object.assign(new Error("tool not allowed"), { status: 400 });
      const tool = { type: t.type, name: t.type === "web_search_20260209" ? "web_search" : "web_fetch" };
      const uses = Math.floor(Number(t.max_uses));
      tool.max_uses = Number.isFinite(uses) && uses >= 1 ? Math.min(uses, 8) : 6;
      return tool;
    });
  }
  return out;
}

async function handleMessage(req, res) {
  const ip = clientIp(req);
  if (rateLimited("global", GLOBAL_RATE_PER_MIN) || rateLimited("msg:" + ip, RATE_PER_MIN)) {
    return sendJson(res, 429, { error: { type: "rate_limit_error", message: "Too many requests — try again in a minute." } });
  }

  const userKey = typeof req.headers["x-user-api-key"] === "string" ? req.headers["x-user-api-key"].trim() : "";
  let apiKey = userKey;
  if (!apiKey) {
    if (!isSameOrigin(req)) {
      return sendJson(res, 401, { error: { type: "authentication_error", message: "Cross-origin requests must supply x-user-api-key." } });
    }
    apiKey = ANTHROPIC_API_KEY;
  }
  if (!apiKey) {
    return sendJson(res, 503, { error: { type: "api_error", message: "Server has no ANTHROPIC_API_KEY configured." } });
  }

  let payload;
  try {
    const body = await readBody(req, MAX_BODY_BYTES);
    payload = sanitizeMessagePayload(JSON.parse(body.toString("utf8")));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: { type: "invalid_request_error", message: err.message || "bad request" } });
  }

  try {
    const upstream = await anthropicRequest(payload, apiKey, 150_000);
    res.writeHead(upstream.status, {
      "content-type": upstream.contentType || "application/json",
      "cache-control": "no-store",
    });
    res.end(upstream.text);
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    sendJson(res, 502, { error: { type: "api_error", message: aborted ? "Upstream timeout." : "Upstream request failed." } });
  }
}

/* ------------------------------- store registry ----------------------------- */
const STORES_FILE = path.join(DATA_DIR, "stores.json");
/** url -> { url, lang, profile, scannedAt, lastAccess, failures } */
const stores = new Map();
let storesDirty = false;

function normalizeStoreUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function loadStores() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORES_FILE, "utf8"));
    for (const rec of raw) if (rec && rec.url) stores.set(rec.url, rec);
    log(`loaded ${stores.size} store profile(s)`);
  } catch { /* first run */ }
}

let saveTimer = null;
let saveInFlight = false;
async function flushStores() {
  // Serialize writes: if one is running, mark dirty and let it re-run.
  if (saveInFlight) { storesDirty = true; return; }
  saveInFlight = true;
  try {
    do {
      storesDirty = false;
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = STORES_FILE + "." + process.pid + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify([...stores.values()], null, 1));
      await fsp.rename(tmp, STORES_FILE);
    } while (storesDirty); // another change landed mid-write — write again
  } catch (err) {
    log("store save failed:", err.message);
  } finally {
    saveInFlight = false;
  }
}
function scheduleSaveStores() {
  storesDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; if (storesDirty) flushStores(); }, 2000);
}
function flushStoresSync() {
  // Best-effort synchronous flush for shutdown — the async debounce would be
  // killed by process.exit before its timer fires.
  if (!storesDirty && !saveTimer) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORES_FILE + "." + process.pid + ".sync.tmp";
    fs.writeFileSync(tmp, JSON.stringify([...stores.values()], null, 1));
    fs.renameSync(tmp, STORES_FILE);
  } catch (err) {
    log("store sync-save failed:", err.message);
  }
}

function touchStore(url, lang) {
  let rec = stores.get(url);
  if (!rec) {
    if (stores.size >= MAX_STORES) {
      let oldest = null;
      for (const r of stores.values()) if (!oldest || (r.lastAccess || 0) < (oldest.lastAccess || 0)) oldest = r;
      if (oldest) stores.delete(oldest.url);
    }
    rec = { url, lang: lang || "English", profile: null, scannedAt: null, lastAccess: 0, failures: 0 };
    stores.set(url, rec);
  }
  if (lang) rec.lang = lang;
  rec.lastAccess = Date.now();
  scheduleSaveStores();
  return rec;
}

function scanSystemPrompt(lang) {
  const language = lang || "English";
  return `You analyze a Shopify (or general e-commerce) online store and produce a compact structured profile of it, used to tailor product suggestions.

Use the web_fetch tool to open the given store URL, and web_search if needed to learn more about the brand. Look at the homepage, product listings, and overall branding.

Respond ONLY with valid JSON, no markdown, no extra text:
{
  "niche": "the store's niche / product category",
  "style": "visual & brand style in a few words (e.g. minimalist, playful, luxury)",
  "colors": ["main brand colors, e.g. #hex or names"],
  "tone": "brand voice / tone",
  "audience": "target audience",
  "categories": ["product categories the store sells"],
  "exampleProducts": ["a few example products currently sold"],
  "summary": "2-3 sentence summary of the store for tailoring new product ideas"
}

If the site cannot be reached or is not an online store, still return your best guess from the name/URL and set summary to note the limitation. All descriptive text in ${language}.`;
}

/* Scans are serialized through a single chain (bounds token burn) and deduped by
 * URL. A bounded queue prevents unbounded backlog growth; per-URL waiter promises
 * let the sync endpoint await an already-queued scan instead of enqueuing a dup. */
let scanChain = Promise.resolve();
const scanQueued = new Map(); // url -> { promise, resolve, reject }

async function doScan(rec) {
  if (!ANTHROPIC_API_KEY) throw Object.assign(new Error("Server has no ANTHROPIC_API_KEY configured."), { status: 503 });
  // The record may have been LRU-evicted or replaced while queued — skip if so.
  if (stores.get(rec.url) !== rec) throw new Error("store no longer registered");
  const data = await anthropicToolTurn({
    model: SCAN_MODEL,
    system: scanSystemPrompt(rec.lang),
    messages: [{ role: "user", content: `Analyze this store and produce its profile: ${rec.url}` }],
    max_tokens: 2000,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 6 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
    ],
    apiKey: ANTHROPIC_API_KEY,
  });
  const text = textFromData(data);
  let profile;
  try { profile = extractJson(text); }
  catch { profile = { summary: text, niche: "", style: "", colors: [], tone: "", categories: [], exampleProducts: [] }; }
  profile.url = rec.url;
  rec.profile = profile;
  rec.scannedAt = new Date().toISOString();
  rec.failures = 0;
  scheduleSaveStores();
  log("scanned store:", rec.url);
  return rec;
}

/* Enqueue a scan for rec. Returns a promise that resolves/rejects with the scan
 * result. Coalesces duplicate requests for the same URL and rejects when the
 * queue is full (so a flood can't grow the backlog without bound). */
function runScan(rec) {
  const existing = scanQueued.get(rec.url);
  if (existing) return existing.promise;
  if (scanQueued.size >= MAX_SCAN_QUEUE) {
    return Promise.reject(Object.assign(new Error("scan queue full"), { status: 503 }));
  }
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  scanQueued.set(rec.url, { promise, resolve, reject });
  scanChain = scanChain.then(async () => {
    scanQueued.delete(rec.url); // free the slot before running so a fresh request can re-queue
    try {
      resolve(await doScan(rec));
    } catch (err) {
      rec.failures = (rec.failures || 0) + 1;
      log("scan failed:", rec.url, err.message);
      reject(err);
    }
  });
  // swallow at the chain level so one rejection can't break the chain
  scanChain = scanChain.catch(() => {});
  return promise;
}

function backgroundRescan() {
  if (!ANTHROPIC_API_KEY) return; // nothing to scan with — don't churn failures
  const now = Date.now();
  for (const rec of stores.values()) {
    if (now - (rec.lastAccess || 0) > STORE_IDLE_EVICT_MS) continue;
    if ((rec.failures || 0) >= MAX_SCAN_FAILURES) continue;
    if (scanQueued.has(rec.url)) continue; // already queued/running
    if (scanQueued.size >= MAX_SCAN_QUEUE) break; // don't overfill the queue
    runScan(rec).catch(() => {});
  }
}
setInterval(backgroundRescan, SCAN_INTERVAL_MS).unref();

async function handleStoreScan(req, res, sync) {
  const ip = clientIp(req);
  if (rateLimited("global", GLOBAL_RATE_PER_MIN) || rateLimited("scan:" + ip, SCAN_RATE_PER_MIN)) {
    return sendJson(res, 429, { error: "Too many scan requests — try again in a minute." });
  }
  // Same keyless policy as /api/message: these endpoints always spend the SERVER
  // key (there is no per-request user-key path for scanning), so a foreign browser
  // origin must not be able to trigger them. curl/native apps (no Origin) and the
  // app's own same-origin requests are allowed.
  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { error: "Cross-origin scan requests are not allowed." });
  }
  if (!ANTHROPIC_API_KEY) return sendJson(res, 503, { error: "Server has no ANTHROPIC_API_KEY configured." });
  let body;
  try { body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8")); }
  catch (err) { return sendJson(res, err.status || 400, { error: "bad request" }); }
  const url = normalizeStoreUrl(body && body.url);
  if (!url) return sendJson(res, 400, { error: "invalid store url" });
  const rec = touchStore(url, typeof body.lang === "string" ? body.lang.slice(0, 40) : undefined);
  rec.failures = 0; // manual request resets the failure breaker
  if (!sync) {
    runScan(rec).catch(() => {});
    return sendJson(res, 202, { ok: true, registered: url });
  }
  try {
    await runScan(rec);
    return sendJson(res, 200, { profile: rec.profile, scannedAt: rec.scannedAt });
  } catch (err) {
    return sendJson(res, err.status === 503 ? 503 : 502, { error: "scan failed" });
  }
}

function handleStoreProfile(req, res, query) {
  const url = normalizeStoreUrl(query.get("url"));
  if (!url) return sendJson(res, 400, { error: "invalid store url" });
  const rec = stores.get(url);
  if (rec) { rec.lastAccess = Date.now(); scheduleSaveStores(); }
  if (!rec || !rec.profile) return sendJson(res, 404, { error: "no profile yet" });
  return sendJson(res, 200, { profile: rec.profile, scannedAt: rec.scannedAt });
}

/* -------------------------------- static files ------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".woff2": "font/woff2",
};
// never serve these repo folders/files even if STATIC_DIR points at the app root
const STATIC_BLOCKLIST = new Set(["server", "deploy", "android", ".env", ".git"]);

async function handleStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "method not allowed" });
  }
  let rel;
  try { rel = decodeURIComponent(pathname); }
  catch { return sendJson(res, 400, { error: "bad path" }); } // malformed %-encoding
  if (rel.includes("\0")) return sendJson(res, 400, { error: "bad path" });
  if (rel === "/" || rel === "") rel = "/index.html";
  // Resolve to an absolute path FIRST (collapses any ../ and %2f-decoded
  // traversal), then derive the first path segment for the blocklist — checking
  // the raw segment before normalization let "a%2f..%2f.env" slip past it.
  const abs = path.normalize(path.join(STATIC_DIR, rel));
  if (!abs.startsWith(STATIC_DIR + path.sep) && abs !== STATIC_DIR) {
    return sendJson(res, 404, { error: "not found" });
  }
  const relResolved = abs === STATIC_DIR ? "" : abs.slice(STATIC_DIR.length + 1);
  const first = relResolved.split(path.sep).filter(Boolean)[0] || "";
  if (STATIC_BLOCKLIST.has(first)) return sendJson(res, 404, { error: "not found" });
  let stat;
  try { stat = await fsp.stat(abs); } catch { stat = null; }
  let file = abs;
  if (!stat || stat.isDirectory()) {
    // SPA-ish fallback: unknown paths get the app shell
    file = path.join(STATIC_DIR, "index.html");
    try { stat = await fsp.stat(file); } catch { return sendJson(res, 404, { error: "not found" }); }
  }
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const noCache = base === "index.html" || base === "sw.js" || base === "assetlinks.json";
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": noCache ? "no-cache" : "public, max-age=86400",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------------------------------- routing --------------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;
    if (p.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }
      // attach CORS headers to every API response
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = (status, headers) => origWriteHead(status, Object.assign({}, CORS_HEADERS, headers || {}));
      if (p === "/api/health") return sendJson(res, 200, { ok: true, service: "shopify-nav", keyed: !!ANTHROPIC_API_KEY });
      if (p === "/api/message" && req.method === "POST") return await handleMessage(req, res);
      if (p === "/api/store/scan" && req.method === "POST") return await handleStoreScan(req, res, true);
      if (p === "/api/store/register" && req.method === "POST") return await handleStoreScan(req, res, false);
      if (p === "/api/store/profile" && req.method === "GET") return handleStoreProfile(req, res, u.searchParams);
      return sendJson(res, 404, { error: "not found" });
    }
    return await handleStatic(req, res, p);
  } catch (err) {
    log("request error:", err.message);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.end();
  }
});

loadStores();
server.listen(PORT, () => {
  log(`shopify-nav server on :${PORT}`);
  log(`static: ${STATIC_DIR}`);
  log(`data:   ${DATA_DIR}`);
  log(`server key: ${ANTHROPIC_API_KEY ? "configured" : "MISSING (users must bring their own key)"}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down...");
  flushStoresSync(); // synchronous — the debounced async save would be lost on exit
  const done = () => process.exit(0);
  const t = setTimeout(done, 2500);
  t.unref();
  server.close(done);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

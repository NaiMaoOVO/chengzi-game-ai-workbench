const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
require("./lib/env-file").loadProjectEnv(__dirname);
const { parseRequestUrl } = require("./lib/safe-request-url");
const { createRateLimiter } = require("./lib/http-guards");

const PORT = Number(process.env.ARCHIVE_PORT) || 8796;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGIN || "null,http://localhost:3000,http://localhost:5173,http://localhost:8793,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8793").split(",").map((value) => value.trim()).filter(Boolean));
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.ARCHIVE_RATE_LIMIT_MAX || 120));
const checkRateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX, trustProxy: process.env.TRUST_PROXY === "1" });
const MORNING_SCHEDULE = (process.env.MORNING_SCHEDULE || "09:00").trim();
const MORNING_GAMES = (process.env.MORNING_GAMES || "").split(",").map((value) => value.trim()).filter(Boolean);
const MORNING_PLATFORM = process.env.MORNING_PLATFORM || "B站";
const HOTSPOT_SOURCE_URL = process.env.HOTSPOT_SOURCE_URL || "http://127.0.0.1:8790";

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowed = ALLOWED_ORIGINS.has("*") || !origin || origin === "null" || ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (ALLOWED_ORIGINS.has("*") ? "*" : (origin === "null" ? "null" : (origin || "null"))) : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function dayKey(iso) {
  return String(iso).slice(0, 10);
}

function computeStats(kind, days, game) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = game
    ? db.prepare("SELECT payload, source, created_at FROM snapshots WHERE kind = ? AND game = ? AND created_at >= ? ORDER BY created_at ASC").all(kind, game, since)
    : db.prepare("SELECT payload, source, created_at FROM snapshots WHERE kind = ? AND created_at >= ? ORDER BY created_at ASC").all(kind, since);
  const byDay = new Map();
  for (const row of rows) {
    const key = dayKey(row.created_at);
    if (!byDay.has(key)) byDay.set(key, { date: key, count: 0, realCount: 0, extra: { negative: 0, samples: 0, highRisk: 0, topics: 0 } });
    const entry = byDay.get(key);
    entry.count += 1;
    if (row.source === "real") entry.realCount += 1;
    const p = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload || {});
    if (kind === "feedback") {
      const s = p.sentiment || {};
      const total = (s["正向"] || 0) + (s["中性"] || 0) + (s["负向"] || 0);
      entry.extra.samples += total;
      entry.extra.negative += s["负向"] || 0;
      const rk = p.risk || {};
      entry.extra.highRisk += rk["高风险"] || 0;
    }
    if (kind === "trending" || kind === "morning-trending") {
      entry.extra.topics += Array.isArray(p.topics) ? p.topics.length : 0;
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isOriginAllowed(request) {
  const origin = request.headers.origin;
  return ALLOWED_ORIGINS.has("*") || !origin || origin === "null" || ALLOWED_ORIGINS.has(origin);
}

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

let db;
let dbPath;
try {
  dbPath = process.env.ARCHIVE_DB_PATH ? path.resolve(process.env.ARCHIVE_DB_PATH) : path.join(os.homedir(), ".gameops", "archive.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
} catch (error) {
  console.error("存档服务无法打开数据文件：" + error.message);
  console.error("可通过环境变量 ARCHIVE_DB_PATH 指定其他可写路径后重启。");
  process.exit(1);
}
db.exec(`
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sample',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_kind_time ON snapshots(kind, created_at);
CREATE TABLE IF NOT EXISTS project_profiles (
  game TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const insertStatement = db.prepare("INSERT INTO snapshots (kind, game, source, payload, created_at) VALUES (?, ?, ?, ?, ?)");

const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;

function listSnapshots(url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!KIND_PATTERN.test(kind)) throw new Error("kind 参数不合法");
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
  const game = (url.searchParams.get("game") || "").trim();
  const rows = game
    ? db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE kind = ? AND game = ? ORDER BY id DESC LIMIT ?").all(kind, game, limit)
    : db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE kind = ? ORDER BY id DESC LIMIT ?").all(kind, limit);
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

function latestSnapshot(url) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!KIND_PATTERN.test(kind)) throw new Error("kind 参数不合法");
  const game = (url.searchParams.get("game") || "").trim();
  const row = game
    ? db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE kind = ? AND game = ? ORDER BY id DESC LIMIT 1").get(kind, game)
    : db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind);
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
}

const server = http.createServer((request, response) => {
  if (!isOriginAllowed(request)) {
    sendJson(request, response, 403, { error: "origin not allowed" });
    return;
  }
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    sendJson(request, response, 429, { error: "rate_limited" }, { "Retry-After": String(rateLimit.retryAfter) });
    return;
  }
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }
  const url = parseRequestUrl(request);
  if (!url) {
    sendJson(request, response, 400, { ok: false, error: "invalid_request_url" });
    return;
  }
  if (request.method === "GET" && request.url === "/live") {
    sendJson(request, response, 200, { ok: true, service: "gameops-archive" });
    return;
  }
  if (request.method === "GET" && (request.url === "/health" || request.url === "/ready")) {
    sendJson(request, response, 200, { ok: true, service: "gameops-archive", storage: path.basename(dbPath) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/snapshots") {
    try {
      sendJson(request, response, 200, { ok: true, items: listSnapshots(url) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/stats") {
    try {
      const kind = url.searchParams.get("kind") || "feedback";
      const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get("days"), 10) || 14));
      const game = (url.searchParams.get("game") || "").trim();
      sendJson(request, response, 200, { ok: true, kind, days, series: computeStats(kind, days, game) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/profiles") {
    const rows = db.prepare("SELECT game, payload, updated_at FROM project_profiles ORDER BY updated_at DESC").all();
    sendJson(request, response, 200, { ok: true, profiles: rows.map((row) => ({ game: row.game, updated_at: row.updated_at, payload: JSON.parse(row.payload) })) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/profile") {
    const game = (url.searchParams.get("game") || "").trim();
    if (!game) { sendJson(request, response, 400, { ok: false, error: "game 参数必填" }); return; }
    const row = db.prepare("SELECT payload, updated_at FROM project_profiles WHERE game = ?").get(game);
    sendJson(request, response, 200, { ok: true, game, profile: row ? JSON.parse(row.payload) : null, updated_at: row ? row.updated_at : null });
    return;
  }
  if (request.method === "GET" && url.pathname === "/latest") {
    try {
      sendJson(request, response, 200, { ok: true, snapshot: latestSnapshot(url) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "PUT" && url.pathname === "/profile") {
    const chunksP = [];
    let recvP = 0;
    let rejP = false;
    request.on("data", (chunk) => {
      if (rejP) return;
      recvP += chunk.length;
      if (recvP > MAX_BODY_BYTES) { rejP = true; sendJson(request, response, 413, { error: "档案内容过大" }); request.resume(); return; }
      chunksP.push(chunk);
    });
    request.on("end", () => {
      if (rejP) return;
      try {
        const body = JSON.parse(Buffer.concat(chunksP).toString("utf8"));
        const game = typeof body.game === "string" ? body.game.trim().slice(0, 60) : "";
        if (!game) { sendJson(request, response, 400, { error: "game 必填" }); return; }
        if (!body.profile || typeof body.profile !== "object") { sendJson(request, response, 400, { error: "profile 必须是对象" }); return; }
        db.prepare("INSERT INTO project_profiles (game, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(game) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
          .run(game, JSON.stringify(body.profile), new Date().toISOString());
        sendJson(request, response, 200, { ok: true, game });
      } catch (error) {
        sendJson(request, response, 400, { error: error.message });
      }
    });
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/snapshots") {
    sendJson(request, response, 404, { error: "not found" });
    return;
  }
  const chunks = [];
  let received = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    if (rejected) return;
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      rejected = true;
      sendJson(request, response, 413, { error: "存档内容过大（上限 5MB）" });
      request.resume();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (rejected) return;
    if (rejected) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (_error) {
      sendJson(request, response, 400, { error: "请求体不是合法 JSON" });
      return;
    }
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    if (!KIND_PATTERN.test(kind)) {
      sendJson(request, response, 400, { error: "kind 不合法（小写字母开头的短标识）" });
      return;
    }
    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      sendJson(request, response, 400, { error: "payload 必须是对象" });
      return;
    }
    let serialized;
    try {
      serialized = JSON.stringify(body.payload);
    } catch (_error) {
      sendJson(request, response, 400, { error: "payload 无法序列化" });
      return;
    }
    const game = typeof body.game === "string" ? body.game.slice(0, 60) : "";
    const source = body.source === "real" ? "real" : "sample";
    const info = insertStatement.run(kind, game, source, serialized, new Date().toISOString());
    sendJson(request, response, 201, { ok: true, id: Number(info.lastInsertRowid) });
  });
});

server.on("error", (error) => {
  console.error("存档服务启动失败：" + error.message);
  process.exit(1);
});

server.requestTimeout = 30000;
server.headersTimeout = 10000;

server.listen(PORT, "127.0.0.1", () => {
  console.log("🗄 存档服务已启动 → http://127.0.0.1:" + PORT);
  console.log("   数据文件: " + dbPath);
  console.log("   健康检查: http://127.0.0.1:" + PORT + "/health");
});

/* ---- 定时晨报抓取：每天 MORNING_SCHEDULE 抓取各游戏今日热点并落库 ---- */

let lastMorningRunDate = "";
let morningRunning = false;

async function runMorningFetch() {
  if (!MORNING_GAMES.length) return;
  morningRunning = true;
  try {
    for (const game of MORNING_GAMES) {
      const params = new URLSearchParams({ game, platform: MORNING_PLATFORM, range: "today", limit: "10" });
      const response = await fetch(HOTSPOT_SOURCE_URL + "/hotspots?" + params.toString(), { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("hotspot HTTP " + response.status);
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const source = items.length && payload.source === "real" ? "real" : "sample";
      insertStatement.run(
        "morning-trending",
        game,
        source,
        JSON.stringify({
          platform: MORNING_PLATFORM,
          topics: items.slice(0, 10).map((item, index) => ({
            rank: item.rank || index + 1,
            title: item.title,
            tag: item.tag || "",
            heat: item.heat || "",
            risk: item.risk?.level || "正常",
            author: item.author || ""
          }))
        }),
        new Date().toISOString()
      );
      console.log("晨报抓取完成：" + game + "（" + source + "，" + items.length + " 条）");
    }
  } catch (error) {
    console.error("晨报抓取失败（下一分钟自动重试）：" + error.message);
  } finally {
    morningRunning = false;
  }
}

setInterval(() => {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const today = now.toISOString().slice(0, 10);
  if (hhmm < MORNING_SCHEDULE || lastMorningRunDate === today || morningRunning) return;
  if (!MORNING_GAMES.length) return;
  lastMorningRunDate = today;
  runMorningFetch();
}, 60000).unref?.();
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
require("./lib/env-file").loadProjectEnv(__dirname);
const { parseRequestUrl } = require("./lib/safe-request-url");
const { createRateLimiter } = require("./lib/http-guards");
const { createCors } = require("./lib/cors");
const { createArchiveAuth } = require("./lib/archive-auth");
const { businessDate, businessTime } = require("./lib/business-date");

const PORT = Number(process.env.ARCHIVE_PORT) || 8796;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const cors = createCors({ allowedOrigins: process.env.ALLOWED_ORIGIN, methods: "GET, POST, PUT, DELETE, OPTIONS", allowFileOrigin: process.env.ALLOW_FILE_ORIGIN === "1" || process.env.NODE_ENV !== "production" });
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.ARCHIVE_RATE_LIMIT_MAX || 120));
const checkRateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX, trustProxy: process.env.TRUST_PROXY === "1" });
const ARCHIVE_AUTH_ENABLED = process.env.ARCHIVE_AUTH_ENABLED === "1";
const checkLoginRateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: Math.max(1, Number(process.env.ARCHIVE_AUTH_RATE_LIMIT_MAX || 8)), trustProxy: process.env.TRUST_PROXY === "1" });
const MORNING_SCHEDULE = (process.env.MORNING_SCHEDULE || "09:00").trim();
const MORNING_GAMES = (process.env.MORNING_GAMES || "").split(",").map((value) => value.trim()).filter(Boolean);
const MORNING_PLATFORM = process.env.MORNING_PLATFORM || "B站";
const HOTSPOT_SOURCE_URL = process.env.HOTSPOT_SOURCE_URL || "http://127.0.0.1:8790";

const corsHeaders = cors.corsHeaders;
const isOriginAllowed = cors.isOriginAllowed;

function dayKey(iso) {
  return businessDate(new Date(iso));
}

function computeStats(kind, days, game, ownerKey) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = game
    ? db.prepare("SELECT payload, source, created_at FROM snapshots WHERE owner_key = ? AND kind = ? AND game = ? AND created_at >= ? ORDER BY created_at ASC").all(ownerKey, kind, game, since)
    : db.prepare("SELECT payload, source, created_at FROM snapshots WHERE owner_key = ? AND kind = ? AND created_at >= ? ORDER BY created_at ASC").all(ownerKey, kind, since);
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

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, response, onBody) {
  const chunks = [];
  let received = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    if (rejected) return;
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      rejected = true;
      sendJson(request, response, 413, { ok: false, error: "请求内容过大（上限 5MB）" });
      request.resume();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (rejected) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是 JSON 对象");
      onBody(body);
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message || "请求体不是合法 JSON" });
    }
  });
}

function textValue(value, field, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (text.length > maxLength) throw new Error(field + " 不能超过 " + maxLength + " 个字符");
  return text;
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
  owner_key TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sample',
  payload TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_profiles (
  owner_key TEXT NOT NULL DEFAULT 'default',
  game TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, game)
);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL DEFAULT 'default',
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  related_topic TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL DEFAULT 'default',
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '评论分析',
  level TEXT NOT NULL DEFAULT '中',
  url TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL DEFAULT 'default',
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  due_date TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  link_view TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_libraries (
  owner_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS morning_runs (
  owner_key TEXT NOT NULL DEFAULT 'default',
  run_date TEXT NOT NULL,
  game TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_date, game, platform)
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`);

function hasColumn(table, column) {
  return db.prepare("PRAGMA table_info(" + table + ")").all().some((item) => item.name === column);
}

function migrateOwnerColumns() {
  for (const table of ["snapshots", "publications", "risk_events", "daily_todos"]) {
    if (!hasColumn(table, "owner_key")) db.exec("ALTER TABLE " + table + " ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'default'");
    if (!hasColumn(table, "request_id")) db.exec("ALTER TABLE " + table + " ADD COLUMN request_id TEXT");
  }
  if (!hasColumn("morning_runs", "owner_key")) db.exec("ALTER TABLE morning_runs ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'default'");
  if (!hasColumn("project_profiles", "owner_key")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE project_profiles_next (
          owner_key TEXT NOT NULL DEFAULT 'default',
          game TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_key, game)
        );
        INSERT INTO project_profiles_next (owner_key, game, payload, updated_at)
          SELECT 'default', game, payload, updated_at FROM project_profiles;
        DROP TABLE project_profiles;
        ALTER TABLE project_profiles_next RENAME TO project_profiles;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_owner_kind_time ON snapshots(owner_key, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_publications_owner_game ON publications(owner_key, game);
    CREATE INDEX IF NOT EXISTS idx_risk_events_owner_game ON risk_events(owner_key, game);
    CREATE INDEX IF NOT EXISTS idx_risk_events_owner_status ON risk_events(owner_key, status);
    CREATE INDEX IF NOT EXISTS idx_daily_todos_owner_status ON daily_todos(owner_key, status);
    CREATE INDEX IF NOT EXISTS idx_daily_todos_owner_game ON daily_todos(owner_key, game);
    CREATE INDEX IF NOT EXISTS idx_daily_todos_owner_due ON daily_todos(owner_key, due_date);
    CREATE INDEX IF NOT EXISTS idx_morning_runs_owner_date ON morning_runs(owner_key, run_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_owner_request ON snapshots(owner_key, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_owner_request ON publications(owner_key, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_events_owner_request ON risk_events(owner_key, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_todos_owner_request ON daily_todos(owner_key, request_id) WHERE request_id IS NOT NULL;
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
    .run("2026-09-owner-isolation-and-idempotency", new Date().toISOString());
}

migrateOwnerColumns();

let archiveAuth;
try {
  archiveAuth = createArchiveAuth(db, {
    enabled: ARCHIVE_AUTH_ENABLED,
    adminUsername: process.env.ARCHIVE_ADMIN_USERNAME || "admin",
    adminPassword: process.env.ARCHIVE_ADMIN_PASSWORD || "",
    secureCookie: process.env.ARCHIVE_COOKIE_SECURE !== "0",
    sessionHours: Number(process.env.ARCHIVE_SESSION_HOURS) || 12
  });
} catch (error) {
  console.error("存档服务认证配置无效：" + error.message);
  process.exit(1);
}

function recordOwner(session) {
  if (!archiveAuth.enabled) return "default";
  return session?.user?.id ? `user:${session.user.id}` : `user:${archiveAuth.adminUserId}`;
}

if (archiveAuth.enabled && archiveAuth.adminUserId) {
  const legacyOwner = `user:${archiveAuth.adminUserId}`;
  for (const table of ["snapshots", "project_profiles", "publications", "risk_events", "daily_todos", "creator_libraries", "morning_runs"]) {
    db.prepare("UPDATE " + table + " SET owner_key = ? WHERE owner_key = 'default'").run(legacyOwner);
  }
}

const insertStatement = db.prepare("INSERT INTO snapshots (owner_key, kind, game, source, payload, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const insertMorningSnapshotStatement = db.prepare("INSERT OR IGNORE INTO snapshots (owner_key, kind, game, source, payload, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const findSnapshotByRequestStatement = db.prepare("SELECT id FROM snapshots WHERE owner_key = ? AND request_id = ?");

const insertPublicationStatement = db.prepare("INSERT INTO publications (owner_key, game, title, channel, url, related_topic, published_at, metrics_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const updatePublicationStatement = db.prepare("UPDATE publications SET game = ?, title = ?, channel = ?, url = ?, related_topic = ?, published_at = ?, metrics_json = ?, updated_at = ? WHERE id = ? AND owner_key = ?");
const getPublicationStatement = db.prepare("SELECT id, game, title, channel, url, related_topic, published_at, metrics_json, created_at, updated_at FROM publications WHERE id = ? AND owner_key = ?");
const deletePublicationStatement = db.prepare("DELETE FROM publications WHERE id = ? AND owner_key = ?");
const findPublicationByRequestStatement = db.prepare("SELECT id, game, title, channel, url, related_topic, published_at, metrics_json, created_at, updated_at FROM publications WHERE owner_key = ? AND request_id = ?");
const getCreatorLibraryStatement = db.prepare("SELECT payload, updated_at FROM creator_libraries WHERE owner_key = ?");
const upsertCreatorLibraryStatement = db.prepare("INSERT INTO creator_libraries (owner_key, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at");

const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;

function listSnapshots(url, ownerKey) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!KIND_PATTERN.test(kind)) throw new Error("kind 参数不合法");
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
  const game = (url.searchParams.get("game") || "").trim();
  const rows = game
    ? db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE owner_key = ? AND kind = ? AND game = ? ORDER BY id DESC LIMIT ?").all(ownerKey, kind, game, limit)
    : db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE owner_key = ? AND kind = ? ORDER BY id DESC LIMIT ?").all(ownerKey, kind, limit);
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

function latestSnapshot(url, ownerKey) {
  const kind = (url.searchParams.get("kind") || "").trim();
  if (!KIND_PATTERN.test(kind)) throw new Error("kind 参数不合法");
  const game = (url.searchParams.get("game") || "").trim();
  const row = game
    ? db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE owner_key = ? AND kind = ? AND game = ? ORDER BY id DESC LIMIT 1").get(ownerKey, kind, game)
    : db.prepare("SELECT id, kind, game, source, payload, created_at FROM snapshots WHERE owner_key = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(ownerKey, kind);
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
}

function creatorLibraryOwner(session) { return recordOwner(session); }

function readCreatorLibraryRow(ownerKey) {
  const row = getCreatorLibraryStatement.get(ownerKey);
  if (!row) return { library: {}, updated_at: null };
  try {
    const library = JSON.parse(row.payload);
    return { library: library && typeof library === "object" && !Array.isArray(library) ? library : {}, updated_at: row.updated_at };
  } catch (_error) {
    return { library: {}, updated_at: row.updated_at };
  }
}

/* ---- 发布台账（P-2）：记录内容发布与效果数据回流 ---- */

function publicationIdOf(pathname) {
  const match = /^\/publications\/(\d{1,15})$/.exec(pathname);
  return match ? Number.parseInt(match[1], 10) : null;
}

function serializeMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("metrics_json 必须是对象");
  try {
    return JSON.stringify(value);
  } catch (_error) {
    throw new Error("metrics_json 无法序列化");
  }
}

function formatPublication(row) {
  let metrics;
  try {
    metrics = JSON.parse(row.metrics_json || "{}");
  } catch (_error) {
    metrics = {};
  }
  return { ...row, metrics_json: metrics };
}

function listPublications(url, ownerKey) {
  const game = (url.searchParams.get("game") || "").trim();
  const channel = (url.searchParams.get("channel") || "").trim();
  const filters = [];
  const params = [];
  filters.push("owner_key = ?"); params.push(ownerKey);
  if (game) { filters.push("game = ?"); params.push(game); }
  if (channel) { filters.push("channel = ?"); params.push(channel); }
  const whereSql = filters.length ? " WHERE " + filters.join(" AND ") : "";
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 20;
  const offsetRaw = Number.parseInt(url.searchParams.get("offset"), 10);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const total = db.prepare("SELECT COUNT(*) AS count FROM publications" + whereSql).get(...params).count;
  const rows = db.prepare("SELECT id, game, title, channel, url, related_topic, published_at, metrics_json, created_at, updated_at FROM publications" + whereSql + " ORDER BY id DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
  return { items: rows.map(formatPublication), total };
}

/* ---- 风险事件工单（P-8）：评论/舆情风险按 open → processing → resolved 三态跟踪 ---- */

const RISK_EVENT_LEVELS = new Set(["低", "中", "高"]);
const RISK_EVENT_STATUSES = new Set(["open", "processing", "resolved", "dropped"]);

const insertRiskEventStatement = db.prepare("INSERT INTO risk_events (owner_key, game, title, source, url, detail, level, status, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const updateRiskEventStatement = db.prepare("UPDATE risk_events SET title = ?, url = ?, detail = ?, level = ?, status = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_key = ?");
const getRiskEventStatement = db.prepare("SELECT id, game, title, source, url, detail, level, status, notes, created_at, updated_at FROM risk_events WHERE id = ? AND owner_key = ?");
const deleteRiskEventStatement = db.prepare("DELETE FROM risk_events WHERE id = ? AND owner_key = ?");
const findRiskEventByRequestStatement = db.prepare("SELECT id, game, title, source, url, detail, level, status, notes, created_at, updated_at FROM risk_events WHERE owner_key = ? AND request_id = ?");

/* ---- 每日工作台待办：手动任务与跨模块自动待办共用一条时间线 ---- */

const DAILY_TODO_PRIORITIES = new Set(["low", "medium", "high"]);
const DAILY_TODO_STATUSES = new Set(["open", "done", "dropped"]);

const insertDailyTodoStatement = db.prepare("INSERT INTO daily_todos (owner_key, game, title, priority, status, due_date, notes, source, link_view, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const updateDailyTodoStatement = db.prepare("UPDATE daily_todos SET title = ?, priority = ?, status = ?, due_date = ?, completed_at = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_key = ?");
const getDailyTodoStatement = db.prepare("SELECT id, game, title, priority, status, due_date, completed_at, notes, source, link_view, created_at, updated_at FROM daily_todos WHERE id = ? AND owner_key = ?");
const deleteDailyTodoStatement = db.prepare("DELETE FROM daily_todos WHERE id = ? AND owner_key = ?");
const findDailyTodoByRequestStatement = db.prepare("SELECT id, game, title, priority, status, due_date, completed_at, notes, source, link_view, created_at, updated_at FROM daily_todos WHERE owner_key = ? AND request_id = ?");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

function requestIdOf(request, body) {
  const header = String(request.headers["idempotency-key"] || "").trim();
  const fromBody = typeof body?.request_id === "string" ? body.request_id.trim() : "";
  const value = header || fromBody;
  if (!value) return null;
  if (!REQUEST_ID_PATTERN.test(value)) throw new Error("Idempotency-Key 必须为 8-100 位字母、数字或 ._:-");
  return value;
}

function dailyTodoIdOf(pathname) {
  const match = /^\/daily-todos\/(\d{1,15})$/.exec(pathname);
  return match ? Number.parseInt(match[1], 10) : null;
}

function listDailyTodos(url, ownerKey) {
  const game = (url.searchParams.get("game") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();
  const dueDate = (url.searchParams.get("due_date") || "").trim();
  const filters = [];
  const params = [];
  filters.push("owner_key = ?"); params.push(ownerKey);
  if (game) { filters.push("game = ?"); params.push(game); }
  if (status) { filters.push("status = ?"); params.push(status); }
  if (dueDate) { filters.push("(due_date IS NULL OR due_date = ?)"); params.push(dueDate); }
  const whereSql = filters.length ? " WHERE " + filters.join(" AND ") : "";
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
  const offsetRaw = Number.parseInt(url.searchParams.get("offset"), 10);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const total = db.prepare("SELECT COUNT(*) AS count FROM daily_todos" + whereSql).get(...params).count;
  const rows = db.prepare("SELECT id, game, title, priority, status, due_date, completed_at, notes, source, link_view, created_at, updated_at FROM daily_todos" + whereSql + " ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
  return { items: rows, total };
}

function validateDailyTodo(body, current) {
  const title = textValue(body?.title, "title", 200, current?.title || "");
  if (!title) throw new Error("title 必填");
  const priority = typeof body?.priority === "string" && body.priority.trim() ? body.priority.trim() : current?.priority || "medium";
  if (!DAILY_TODO_PRIORITIES.has(priority)) throw new Error("priority 不合法（允许：low、medium、high）");
  const status = typeof body?.status === "string" && body.status.trim() ? body.status.trim() : current?.status || "open";
  if (!DAILY_TODO_STATUSES.has(status)) throw new Error("status 不合法（允许：open、done、dropped）");
  const dueDate = typeof body?.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : current?.due_date || null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("due_date 不合法（格式：YYYY-MM-DD）");
  return {
    title,
    priority,
    status,
    dueDate,
    completedAt: status === "done" ? current?.completed_at || new Date().toISOString() : null,
    notes: textValue(body?.notes, "notes", 2000, current?.notes || "")
  };
}

function riskEventIdOf(pathname) {
  const match = /^\/risk-events\/(\d{1,15})$/.exec(pathname);
  return match ? Number.parseInt(match[1], 10) : null;
}

function listRiskEvents(url, ownerKey) {
  const game = (url.searchParams.get("game") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();
  const level = (url.searchParams.get("level") || "").trim();
  const filters = [];
  const params = [];
  filters.push("owner_key = ?"); params.push(ownerKey);
  if (game) { filters.push("game = ?"); params.push(game); }
  if (status) { filters.push("status = ?"); params.push(status); }
  if (level) { filters.push("level = ?"); params.push(level); }
  const whereSql = filters.length ? " WHERE " + filters.join(" AND ") : "";
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 20;
  const offsetRaw = Number.parseInt(url.searchParams.get("offset"), 10);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const total = db.prepare("SELECT COUNT(*) AS count FROM risk_events" + whereSql).get(...params).count;
  const rows = db.prepare("SELECT id, game, title, source, url, detail, level, status, notes, created_at, updated_at FROM risk_events" + whereSql + " ORDER BY id DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
  return { items: rows, total };
}

function listMorningRuns(url, ownerKey) {
  const limitRaw = Number.parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
  const rows = db.prepare("SELECT run_date, game, platform, status, started_at, finished_at, error FROM morning_runs WHERE owner_key = ? ORDER BY run_date DESC, started_at DESC LIMIT ?").all(ownerKey, limit);
  return { items: rows };
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
    sendJson(request, response, 200, { ok: true, service: "gameops-archive", storage: path.basename(dbPath), auth_required: archiveAuth.enabled });
    return;
  }
  if (request.method === "POST" && url.pathname === "/auth/login") {
    if (!archiveAuth.enabled) {
      sendJson(request, response, 409, { ok: false, error: "当前服务未启用线上认证" });
      return;
    }
    const loginRate = checkLoginRateLimit(request);
    if (!loginRate.allowed) {
      sendJson(request, response, 429, { ok: false, error: "登录尝试过于频繁" }, { "Retry-After": String(loginRate.retryAfter) });
      return;
    }
    readJsonBody(request, response, (body) => {
      try {
        const session = archiveAuth.login(body);
        if (!session) {
          sendJson(request, response, 401, { ok: false, error: "用户名或密码错误" });
          return;
        }
        sendJson(request, response, 200, {
          ok: true,
          user: session.user,
          csrf_token: session.csrfToken,
          expires_at: session.expiresAt
        }, { "Set-Cookie": archiveAuth.sessionCookie(session.token, session.expiresAt) });
      } catch (_error) {
        sendJson(request, response, 401, { ok: false, error: "用户名或密码错误" });
      }
    });
    return;
  }

  const session = archiveAuth.authenticate(request);
  const stateChanging = !["GET", "HEAD", "OPTIONS"].includes(request.method || "");
  if (archiveAuth.enabled && !session) {
    sendJson(request, response, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (archiveAuth.enabled && stateChanging && !archiveAuth.matchesCsrf(request, session)) {
    sendJson(request, response, 403, { ok: false, error: "csrf_invalid" });
    return;
  }
  const ownerKey = recordOwner(session);
  if (request.method === "GET" && url.pathname === "/auth/session") {
    sendJson(request, response, 200, archiveAuth.enabled
      ? { ok: true, auth_required: true, user: session.user, csrf_token: session.csrfToken }
      : { ok: true, auth_required: false, user: null });
    return;
  }
  if (request.method === "POST" && url.pathname === "/auth/logout") {
    if (archiveAuth.enabled) archiveAuth.deleteSession(session.tokenHash);
    sendJson(request, response, 200, { ok: true }, { "Set-Cookie": archiveAuth.clearSessionCookie() });
    return;
  }
  if (url.pathname === "/auth/users") {
    if (!archiveAuth.enabled || session.user.role !== "admin") {
      sendJson(request, response, 403, { ok: false, error: "admin_required" });
      return;
    }
    if (request.method === "GET") {
      const users = db.prepare("SELECT id, username, role, created_at, updated_at FROM archive_users ORDER BY id ASC").all();
      sendJson(request, response, 200, { ok: true, users });
      return;
    }
    if (request.method === "POST") {
      readJsonBody(request, response, (body) => {
        try {
          const user = archiveAuth.createUser(body);
          sendJson(request, response, 201, { ok: true, user });
        } catch (error) {
          sendJson(request, response, 400, { ok: false, error: error.message });
        }
      });
      return;
    }
  }
  if (url.pathname === "/creator-library") {
    const ownerKey = creatorLibraryOwner(session);
    if (request.method === "GET") {
      const current = readCreatorLibraryRow(ownerKey);
      sendJson(request, response, 200, { ok: true, ...current });
      return;
    }
    if (request.method === "PUT") {
      readJsonBody(request, response, (body) => {
        try {
          if (!body.library || typeof body.library !== "object" || Array.isArray(body.library)) throw new Error("library 必须是对象");
          const serialized = JSON.stringify(body.library);
          if (Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) throw new Error("个人库内容过大");
          const current = readCreatorLibraryRow(ownerKey);
          const base = body.base_updated_at === null || body.base_updated_at === undefined ? null : String(body.base_updated_at);
          if (current.updated_at && base !== current.updated_at) {
            sendJson(request, response, 409, { ok: false, error: "creator_library_conflict", library: current.library, updated_at: current.updated_at });
            return;
          }
          const updatedAt = new Date().toISOString();
          upsertCreatorLibraryStatement.run(ownerKey, serialized, updatedAt);
          sendJson(request, response, 200, { ok: true, updated_at: updatedAt });
        } catch (error) {
          sendJson(request, response, 400, { ok: false, error: error.message || "个人库保存失败" });
        }
      });
      return;
    }
  }
  if (request.method === "GET" && url.pathname === "/snapshots") {
    try {
      sendJson(request, response, 200, { ok: true, items: listSnapshots(url, ownerKey) });
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
      sendJson(request, response, 200, { ok: true, kind, days, series: computeStats(kind, days, game, ownerKey) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/morning-runs") {
    try {
      sendJson(request, response, 200, { ok: true, ...listMorningRuns(url, ownerKey) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/profiles") {
    const rows = db.prepare("SELECT game, payload, updated_at FROM project_profiles WHERE owner_key = ? ORDER BY updated_at DESC").all(ownerKey);
    sendJson(request, response, 200, { ok: true, profiles: rows.map((row) => ({ game: row.game, updated_at: row.updated_at, payload: JSON.parse(row.payload) })) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/profile") {
    const game = (url.searchParams.get("game") || "").trim();
    if (!game) { sendJson(request, response, 400, { ok: false, error: "game 参数必填" }); return; }
    const row = db.prepare("SELECT payload, updated_at FROM project_profiles WHERE owner_key = ? AND game = ?").get(ownerKey, game);
    sendJson(request, response, 200, { ok: true, game, profile: row ? JSON.parse(row.payload) : null, updated_at: row ? row.updated_at : null });
    return;
  }
  if (request.method === "GET" && url.pathname === "/latest") {
    try {
      sendJson(request, response, 200, { ok: true, snapshot: latestSnapshot(url, ownerKey) });
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
        const game = textValue(body.game, "game", 60);
        if (!game) { sendJson(request, response, 400, { error: "game 必填" }); return; }
        if (!body.profile || typeof body.profile !== "object") { sendJson(request, response, 400, { error: "profile 必须是对象" }); return; }
        db.prepare("INSERT INTO project_profiles (owner_key, game, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_key, game) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
          .run(ownerKey, game, JSON.stringify(body.profile), new Date().toISOString());
        sendJson(request, response, 200, { ok: true, game });
      } catch (error) {
        sendJson(request, response, 400, { error: error.message });
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/publications") {
    try {
      sendJson(request, response, 200, { ok: true, ...listPublications(url, ownerKey) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "DELETE" && publicationIdOf(url.pathname) !== null) {
    const info = deletePublicationStatement.run(publicationIdOf(url.pathname), ownerKey);
    if (Number(info.changes) === 0) {
      sendJson(request, response, 404, { ok: false, error: "发布记录不存在" });
      return;
    }
    sendJson(request, response, 200, { ok: true });
    return;
  }
  if (request.method === "PUT" && publicationIdOf(url.pathname) !== null) {
    const chunksUpd = [];
    let receivedUpd = 0;
    let rejectedUpd = false;
    request.on("data", (chunk) => {
      if (rejectedUpd) return;
      receivedUpd += chunk.length;
      if (receivedUpd > MAX_BODY_BYTES) {
        rejectedUpd = true;
        sendJson(request, response, 413, { error: "台账内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksUpd.push(chunk);
    });
    request.on("end", () => {
      if (rejectedUpd) return;
      try {
        const body = JSON.parse(Buffer.concat(chunksUpd).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendJson(request, response, 400, { ok: false, error: "请求体必须是 JSON 对象" });
          return;
        }
        const id = publicationIdOf(url.pathname);
        const current = getPublicationStatement.get(id, ownerKey);
        if (!current) {
          sendJson(request, response, 404, { ok: false, error: "发布记录不存在" });
          return;
        }
        updatePublicationStatement.run(
          textValue(body.game, "game", 60, current.game) || current.game,
          textValue(body.title, "title", 200, current.title) || current.title,
          textValue(body.channel, "channel", 60, current.channel) || current.channel,
          textValue(body.url, "url", 2048, current.url),
          textValue(body.related_topic, "related_topic", 200, current.related_topic),
          textValue(body.published_at, "published_at", 80, current.published_at),
          Object.hasOwn(body, "metrics_json") ? serializeMetrics(body.metrics_json) : current.metrics_json,
          new Date().toISOString(),
          id,
          ownerKey
        );
        sendJson(request, response, 200, { ok: true, publication: formatPublication(getPublicationStatement.get(id, ownerKey)) });
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/publications") {
    const chunksPub = [];
    let receivedPub = 0;
    let rejectedPub = false;
    request.on("data", (chunk) => {
      if (rejectedPub) return;
      receivedPub += chunk.length;
      if (receivedPub > MAX_BODY_BYTES) {
        rejectedPub = true;
        sendJson(request, response, 413, { error: "台账内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksPub.push(chunk);
    });
    request.on("end", () => {
      if (rejectedPub) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunksPub).toString("utf8"));
      } catch (_error) {
        sendJson(request, response, 400, { ok: false, error: "请求体不是合法 JSON" });
        return;
      }
      const game = textValue(body?.game, "game", 60);
      const title = textValue(body?.title, "title", 200);
      const channel = textValue(body?.channel, "channel", 60);
      const missing = [!game && "game", !title && "title", !channel && "channel"].filter(Boolean);
      if (missing.length) {
        sendJson(request, response, 400, { ok: false, error: "缺少必填字段：" + missing.join("、") });
        return;
      }
      let metricsJson;
      try {
        metricsJson = serializeMetrics(body?.metrics_json ?? {});
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
        return;
      }
      let requestId;
      try {
        requestId = requestIdOf(request, body);
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
        return;
      }
      if (requestId) {
        const existing = findPublicationByRequestStatement.get(ownerKey, requestId);
        if (existing) {
          sendJson(request, response, 200, { ok: true, publication: formatPublication(existing), idempotent: true });
          return;
        }
      }
      const now = new Date().toISOString();
      let info;
      try {
        info = insertPublicationStatement.run(
          ownerKey,
          game,
          title,
          channel,
          textValue(body?.url, "url", 2048),
          textValue(body?.related_topic, "related_topic", 200),
          textValue(body?.published_at, "published_at", 80) || null,
          metricsJson,
          requestId,
          now,
          now
        );
      } catch (error) {
        const existing = requestId ? findPublicationByRequestStatement.get(ownerKey, requestId) : null;
        if (!existing) throw error;
        sendJson(request, response, 200, { ok: true, publication: formatPublication(existing), idempotent: true });
        return;
      }
      sendJson(request, response, 201, { ok: true, publication: formatPublication(getPublicationStatement.get(Number(info.lastInsertRowid), ownerKey)) });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/risk-events") {
    try {
      sendJson(request, response, 200, { ok: true, ...listRiskEvents(url, ownerKey) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/daily-todos") {
    try {
      sendJson(request, response, 200, { ok: true, ...listDailyTodos(url, ownerKey) });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error.message });
    }
    return;
  }
  if (request.method === "DELETE" && dailyTodoIdOf(url.pathname) !== null) {
    const info = deleteDailyTodoStatement.run(dailyTodoIdOf(url.pathname), ownerKey);
    if (Number(info.changes) === 0) {
      sendJson(request, response, 404, { ok: false, error: "待办不存在" });
      return;
    }
    sendJson(request, response, 200, { ok: true });
    return;
  }
  if (request.method === "PUT" && dailyTodoIdOf(url.pathname) !== null) {
    const chunksTodoUpd = [];
    let receivedTodoUpd = 0;
    let rejectedTodoUpd = false;
    request.on("data", (chunk) => {
      if (rejectedTodoUpd) return;
      receivedTodoUpd += chunk.length;
      if (receivedTodoUpd > MAX_BODY_BYTES) {
        rejectedTodoUpd = true;
        sendJson(request, response, 413, { ok: false, error: "待办内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksTodoUpd.push(chunk);
    });
    request.on("end", () => {
      if (rejectedTodoUpd) return;
      try {
        const body = JSON.parse(Buffer.concat(chunksTodoUpd).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是 JSON 对象");
        const id = dailyTodoIdOf(url.pathname);
        const current = getDailyTodoStatement.get(id, ownerKey);
        if (!current) {
          sendJson(request, response, 404, { ok: false, error: "待办不存在" });
          return;
        }
        const next = validateDailyTodo(body, current);
        updateDailyTodoStatement.run(next.title, next.priority, next.status, next.dueDate, next.completedAt, next.notes, new Date().toISOString(), id, ownerKey);
        sendJson(request, response, 200, { ok: true, daily_todo: getDailyTodoStatement.get(id, ownerKey) });
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/daily-todos") {
    const chunksTodo = [];
    let receivedTodo = 0;
    let rejectedTodo = false;
    request.on("data", (chunk) => {
      if (rejectedTodo) return;
      receivedTodo += chunk.length;
      if (receivedTodo > MAX_BODY_BYTES) {
        rejectedTodo = true;
        sendJson(request, response, 413, { ok: false, error: "待办内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksTodo.push(chunk);
    });
    request.on("end", () => {
      if (rejectedTodo) return;
      try {
        const body = JSON.parse(Buffer.concat(chunksTodo).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是 JSON 对象");
        const game = textValue(body.game, "game", 60);
        if (!game) throw new Error("game 必填");
        const linkView = typeof body.link_view === "string" && /^[a-z][a-z0-9_-]{0,30}$/.test(body.link_view.trim()) ? body.link_view.trim() : "";
        const next = validateDailyTodo(body, null);
        const requestId = requestIdOf(request, body);
        if (requestId) {
          const existing = findDailyTodoByRequestStatement.get(ownerKey, requestId);
          if (existing) {
            sendJson(request, response, 200, { ok: true, daily_todo: existing, idempotent: true });
            return;
          }
        }
        const now = new Date().toISOString();
        let info;
        try {
          const source = textValue(body.source, "source", 60, "manual") || "manual";
          info = insertDailyTodoStatement.run(ownerKey, game, next.title, next.priority, next.status, next.dueDate, next.notes, source, linkView, requestId, now, now);
        } catch (error) {
          const existing = requestId ? findDailyTodoByRequestStatement.get(ownerKey, requestId) : null;
          if (!existing) throw error;
          sendJson(request, response, 200, { ok: true, daily_todo: existing, idempotent: true });
          return;
        }
        sendJson(request, response, 201, { ok: true, daily_todo: getDailyTodoStatement.get(Number(info.lastInsertRowid), ownerKey) });
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }
  if (request.method === "DELETE" && riskEventIdOf(url.pathname) !== null) {
    const info = deleteRiskEventStatement.run(riskEventIdOf(url.pathname), ownerKey);
    if (Number(info.changes) === 0) {
      sendJson(request, response, 404, { ok: false, error: "风险事件不存在" });
      return;
    }
    sendJson(request, response, 200, { ok: true });
    return;
  }
  if (request.method === "PUT" && riskEventIdOf(url.pathname) !== null) {
    const chunksRiskUpd = [];
    let receivedRiskUpd = 0;
    let rejectedRiskUpd = false;
    request.on("data", (chunk) => {
      if (rejectedRiskUpd) return;
      receivedRiskUpd += chunk.length;
      if (receivedRiskUpd > MAX_BODY_BYTES) {
        rejectedRiskUpd = true;
        sendJson(request, response, 413, { ok: false, error: "风险事件内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksRiskUpd.push(chunk);
    });
    request.on("end", () => {
      if (rejectedRiskUpd) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunksRiskUpd).toString("utf8"));
      } catch (_error) {
        sendJson(request, response, 400, { ok: false, error: "请求体不是合法 JSON" });
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendJson(request, response, 400, { ok: false, error: "请求体必须是 JSON 对象" });
        return;
      }
      const id = riskEventIdOf(url.pathname);
      const current = getRiskEventStatement.get(id, ownerKey);
      if (!current) {
        sendJson(request, response, 404, { ok: false, error: "风险事件不存在" });
        return;
      }
      let level = current.level;
      if (Object.hasOwn(body, "level")) {
        const raw = typeof body.level === "string" ? body.level.trim() : "";
        if (!RISK_EVENT_LEVELS.has(raw)) {
          sendJson(request, response, 400, { ok: false, error: "level 不合法（允许：低、中、高）" });
          return;
        }
        level = raw;
      }
      let status = current.status;
      if (Object.hasOwn(body, "status")) {
        const raw = typeof body.status === "string" ? body.status.trim() : "";
        if (!RISK_EVENT_STATUSES.has(raw)) {
          sendJson(request, response, 400, { ok: false, error: "status 不合法（允许：open、processing、resolved、dropped）" });
          return;
        }
        status = raw;
      }
      updateRiskEventStatement.run(
        textValue(body.title, "title", 200, current.title) || current.title,
        textValue(body.url, "url", 2048, current.url),
        textValue(body.detail, "detail", 4000, current.detail),
        level,
        status,
        textValue(body.notes, "notes", 2000, current.notes),
        new Date().toISOString(),
        id,
        ownerKey
      );
      sendJson(request, response, 200, { ok: true, risk_event: getRiskEventStatement.get(id, ownerKey) });
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/risk-events") {
    const chunksRisk = [];
    let receivedRisk = 0;
    let rejectedRisk = false;
    request.on("data", (chunk) => {
      if (rejectedRisk) return;
      receivedRisk += chunk.length;
      if (receivedRisk > MAX_BODY_BYTES) {
        rejectedRisk = true;
        sendJson(request, response, 413, { ok: false, error: "风险事件内容过大（上限 5MB）" });
        request.resume();
        return;
      }
      chunksRisk.push(chunk);
    });
    request.on("end", () => {
      if (rejectedRisk) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunksRisk).toString("utf8"));
      } catch (_error) {
        sendJson(request, response, 400, { ok: false, error: "请求体不是合法 JSON" });
        return;
      }
      const game = textValue(body?.game, "game", 60);
      const title = textValue(body?.title, "title", 200);
      const missing = [!game && "game", !title && "title"].filter(Boolean);
      if (missing.length) {
        sendJson(request, response, 400, { ok: false, error: "缺少必填字段：" + missing.join("、") });
        return;
      }
      const level = typeof body?.level === "string" ? body.level.trim() : "";
      if (level && !RISK_EVENT_LEVELS.has(level)) {
        sendJson(request, response, 400, { ok: false, error: "level 不合法（允许：低、中、高）" });
        return;
      }
      const status = typeof body?.status === "string" ? body.status.trim() : "";
      if (status && !RISK_EVENT_STATUSES.has(status)) {
        sendJson(request, response, 400, { ok: false, error: "status 不合法（允许：open、processing、resolved、dropped）" });
        return;
      }
      let requestId;
      try {
        requestId = requestIdOf(request, body);
      } catch (error) {
        sendJson(request, response, 400, { ok: false, error: error.message });
        return;
      }
      if (requestId) {
        const existing = findRiskEventByRequestStatement.get(ownerKey, requestId);
        if (existing) {
          sendJson(request, response, 200, { ok: true, risk_event: existing, idempotent: true });
          return;
        }
      }
      const now = new Date().toISOString();
      let info;
      try {
        info = insertRiskEventStatement.run(
          ownerKey,
          game,
          title,
          textValue(body?.source, "source", 60, "评论分析") || "评论分析",
          textValue(body?.url, "url", 2048),
          textValue(body?.detail, "detail", 4000),
          level || "中",
          status || "open",
          requestId,
          now,
          now
        );
      } catch (error) {
        const existing = requestId ? findRiskEventByRequestStatement.get(ownerKey, requestId) : null;
        if (!existing) throw error;
        sendJson(request, response, 200, { ok: true, risk_event: existing, idempotent: true });
        return;
      }
      sendJson(request, response, 201, { ok: true, risk_event: getRiskEventStatement.get(Number(info.lastInsertRowid), ownerKey) });
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
    const game = textValue(body.game, "game", 60);
    const source = body.source === "real" ? "real" : "sample";
    let requestId;
    try {
      requestId = requestIdOf(request, body);
    } catch (error) {
      sendJson(request, response, 400, { error: error.message });
      return;
    }
    if (requestId) {
      const existing = findSnapshotByRequestStatement.get(ownerKey, requestId);
      if (existing) {
        sendJson(request, response, 200, { ok: true, id: Number(existing.id), idempotent: true });
        return;
      }
    }
    try {
      const info = insertStatement.run(ownerKey, kind, game, source, serialized, requestId, new Date().toISOString());
      sendJson(request, response, 201, { ok: true, id: Number(info.lastInsertRowid) });
    } catch (error) {
      const existing = requestId ? findSnapshotByRequestStatement.get(ownerKey, requestId) : null;
      if (!existing) throw error;
      sendJson(request, response, 200, { ok: true, id: Number(existing.id), idempotent: true });
    }
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

let morningRunning = false;
const claimMorningRunStatement = db.prepare(`
  INSERT INTO morning_runs (owner_key, run_date, game, platform, status, started_at, finished_at, error)
  VALUES (?, ?, ?, ?, 'running', ?, NULL, '')
  ON CONFLICT(run_date, game, platform) DO UPDATE SET
    owner_key = excluded.owner_key,
    status = 'running', started_at = excluded.started_at, finished_at = NULL, error = ''
  WHERE morning_runs.status = 'failed'
    OR (morning_runs.status = 'running' AND morning_runs.started_at < ?)
`);
const updateMorningRunStatement = db.prepare("UPDATE morning_runs SET status = ?, finished_at = ?, error = ? WHERE run_date = ? AND game = ? AND platform = ? AND owner_key = ?");

function claimMorningRun(runDate, game, platform, now = new Date(), ownerKey = recordOwner(null)) {
  const startedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const result = claimMorningRunStatement.run(ownerKey, runDate, game, platform, startedAt, staleBefore);
  return Number(result.changes) === 1;
}

function finishMorningRun(runDate, game, platform, status, error = "", ownerKey = recordOwner(null)) {
  updateMorningRunStatement.run(status, new Date().toISOString(), String(error || "").slice(0, 500), runDate, game, platform, ownerKey);
}

async function runMorningFetch(runDate = businessDate()) {
  if (!MORNING_GAMES.length) return;
  morningRunning = true;
  try {
    for (const game of MORNING_GAMES) {
      if (!claimMorningRun(runDate, game, MORNING_PLATFORM)) continue;
      try {
        const params = new URLSearchParams({ game, platform: MORNING_PLATFORM, range: "today", limit: "10" });
        const response = await fetch(HOTSPOT_SOURCE_URL + "/hotspots?" + params.toString(), { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("hotspot HTTP " + response.status);
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const source = items.length && payload.source === "real" ? "real" : "sample";
        const requestId = `morning-${runDate}-${MORNING_PLATFORM}-${game}`;
        insertMorningSnapshotStatement.run(
          recordOwner(null),
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
          requestId,
          new Date().toISOString()
        );
        finishMorningRun(runDate, game, MORNING_PLATFORM, "success");
        console.log("晨报抓取完成：" + game + "（" + source + "，" + items.length + " 条）");
      } catch (error) {
        finishMorningRun(runDate, game, MORNING_PLATFORM, "failed", error.message);
        console.error("晨报抓取失败（下一分钟自动重试）:" + game + " · " + error.message);
      }
    }
  } finally {
    morningRunning = false;
  }
}

setInterval(() => {
  const now = new Date();
  const hhmm = businessTime(now);
  const today = businessDate(now);
  if (hhmm < MORNING_SCHEDULE || morningRunning) return;
  if (!MORNING_GAMES.length) return;
  runMorningFetch(today);
}, 60000).unref?.();

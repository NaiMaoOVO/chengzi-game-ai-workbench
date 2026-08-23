const http = require("node:http");
require("./lib/env-file").loadProjectEnv(__dirname);
const crypto = require("node:crypto");
const { parseRequestUrl } = require("./lib/safe-request-url");
const { createRateLimiter } = require("./lib/http-guards");

const PORT = Number(process.env.COMMENT_PORT || 8791);
const VIDEO_INFO_URL = "https://api.bilibili.com/x/web-interface/view";
const REPLY_URL = "https://api.bilibili.com/x/v2/reply/main";
const REPLY_FALLBACK_URL = "https://api.bilibili.com/x/v2/reply";
const BILIBILI_COOKIE = process.env.BILIBILI_COOKIE || "";
const DEFAULT_PROBE_URL = "https://www.bilibili.com/video/BV1GJ411x7h7";
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGIN || "null,http://localhost:3000,http://localhost:5173,http://localhost:8793,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8793").split(",").map((value) => value.trim()).filter(Boolean));
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.RATE_LIMIT_MAX || 60));
const CACHE_TTL_MS = Math.max(0, Number(process.env.CACHE_TTL_MS || 30000));
const UPSTREAM_TIMEOUT_MS = Math.max(1000, Number(process.env.UPSTREAM_TIMEOUT_MS || 8000));
const UPSTREAM_RETRIES = Math.max(0, Math.min(3, Number(process.env.UPSTREAM_RETRIES || 2)));
const SESSION_COOKIE = getBilibiliCookieValue();
const allowRateLimitedRequest = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  trustProxy: process.env.TRUST_PROXY === "1"
});
const responseCache = new Map();

function randomHex(size) {
  return crypto.randomBytes(size).toString("hex").toUpperCase();
}

function getBilibiliCookieValue() {
  if (BILIBILI_COOKIE) return BILIBILI_COOKIE;
  const now = Math.floor(Date.now() / 1000);
  return [
    `buvid3=${randomHex(16)}infoc`,
    `buvid4=${randomHex(32)}`,
    `b_nut=${now}`,
    "CURRENT_FNVAL=4048"
  ].join("; ");
}

function getBilibiliCookie() {
  return BILIBILI_COOKIE || SESSION_COOKIE;
}
function getBilibiliHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Origin": "https://www.bilibili.com",
    "Referer": "https://www.bilibili.com/",
    "Cookie": getBilibiliCookie()
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const nullOrigin = origin === "null";
  if (!origin || (!nullOrigin && !ALLOWED_ORIGINS.has("*") && !ALLOWED_ORIGINS.has(origin))) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has("*") ? "*" : (nullOrigin ? "null" : origin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function allowRequest(request) {
  return allowRateLimitedRequest(request).allowed;
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (response.status !== 429 && response.status < 500) return response;
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error.name === "TimeoutError" ? new Error("上游请求超时") : error;
    }
    if (attempt < UPSTREAM_RETRIES) await sleep(200 * (2 ** attempt));
  }
  throw lastError;
}

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCached(key, payload) {
  if (CACHE_TTL_MS <= 0) return;
  const now = Date.now();
  if (responseCache.size > 200) {
    for (const [cacheKey, entry] of responseCache) {
      if (entry.expiresAt <= now) responseCache.delete(cacheKey);
    }
  }
  while (responseCache.size >= 200) {
    responseCache.delete(responseCache.keys().next().value);
  }
  responseCache.set(key, { payload, expiresAt: now + CACHE_TTL_MS });
}

function boundedInteger(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function extractBvid(input) {
  const value = String(input || "").trim();
  const match = value.match(/BV[a-zA-Z0-9]{10}/i);
  return match ? match[0].replace(/^bv/i, "BV") : "";
}

function extractAid(input) {
  const value = String(input || "").trim();
  const queryMatch = value.match(/(?:^|[?&])aid=(\d+)/i);
  if (queryMatch) return queryMatch[1];

  const avMatch = value.match(/(?:^|[/?&=\s])av(\d+)\b/i);
  if (avMatch) return avMatch[1];

  return "";
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: getBilibiliHeaders()
  });

  if (!response.ok) {
    if (response.status === 412) {
      throw new Error("B站返回 HTTP 412，通常是公开评论接口触发风控；可稍后重试，或在终端设置 BILIBILI_COOKIE 后重启评论服务。");
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchVideoInfo({ bvid, aid }) {
  const params = new URLSearchParams(
    bvid ? { bvid } : { aid: String(aid) }
  );
  const payload = await fetchJson(`${VIDEO_INFO_URL}?${params}`);

  if (payload.code !== 0 || !payload.data?.aid) {
    throw new Error(payload.message || "无法获取视频信息");
  }

  return payload.data;
}

async function fetchComments(aid, limit) {
  const replies = [];
  let next = 0;
  let pages = 0;
  const maxPages = Math.ceil(limit / 20) + 2;

  while (replies.length < limit && pages < maxPages) {
    pages += 1;
    const params = new URLSearchParams({
      type: "1",
      oid: String(aid),
      mode: "3",
      ps: "20",
      next: String(next)
    });
    const payload = await fetchJson(`${REPLY_URL}?${params}`);

    if (payload.code !== 0) {
      throw new Error(payload.message || "无法获取评论");
    }

    const pageReplies = payload.data?.replies || [];
    replies.push(...pageReplies);

    const cursor = payload.data?.cursor;
    if (!cursor || cursor.is_end || !pageReplies.length) break;
    if (cursor.next === next || cursor.next === undefined || cursor.next === null) break;
    next = cursor.next;
  }

  return replies.slice(0, limit).map((reply) => ({
    id: reply.rpid,
    message: reply.content?.message || "",
    likes: reply.like || 0,
    user: reply.member?.uname || "匿名用户",
    createdAt: reply.ctime ? new Date(reply.ctime * 1000).toISOString() : ""
  }));
}

async function fetchCommentsFallback(aid, limit) {
  const params = new URLSearchParams({
    type: "1",
    oid: String(aid),
    sort: "2",
    ps: String(Math.min(limit, 49)),
    pn: "1"
  });
  const payload = await fetchJson(`${REPLY_FALLBACK_URL}?${params}`);

  if (payload.code !== 0) {
    throw new Error(payload.message || "备用评论接口也无法获取评论");
  }

  const replies = payload.data?.replies || [];
  return replies.slice(0, limit).map((reply) => ({
    id: reply.rpid,
    message: reply.content?.message || "",
    likes: reply.like || 0,
    user: reply.member?.uname || "匿名用户",
    createdAt: reply.ctime ? new Date(reply.ctime * 1000).toISOString() : ""
  }));
}

async function handleComments(request, response) {
  const url = parseRequestUrl(request);
  if (!url) {
    sendJson(request, response, 400, { error: "invalid_request_url" });
    return;
  }
  const input = String(url.searchParams.get("url") || url.searchParams.get("bvid") || url.searchParams.get("aid") || "").trim();
  if (!input || input.length > 500) {
    sendJson(request, response, 400, { error: "视频链接或编号长度不合法" });
    return;
  }
  const bvid = extractBvid(input);
  const aid = bvid ? "" : extractAid(input);
  const limit = boundedInteger(url.searchParams.get("limit"), 80, 1, 200);

  if (!bvid && !aid) {
    sendJson(request, response, 400, { error: "请输入有效的 B站视频链接、BV 号或 av 号" });
    return;
  }

  const cacheKey = `comments:${bvid || aid}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    sendJson(request, response, 200, cached, { "X-Cache": "HIT" });
    return;
  }

  try {
    const video = await fetchVideoInfo({ bvid, aid });
    let comments = [];
    let usedFallback = false;
    try {
      comments = await fetchComments(video.aid, limit);
    } catch (_error) {
      comments = await fetchCommentsFallback(video.aid, limit);
      usedFallback = true;
    }
    const payload = {
      source: "B站公开评论",
      bvid: video.bvid || bvid,
      aid: video.aid,
      title: video.title,
      owner: video.owner?.name || "",
      usedFallback,
      comments
    };
    setCached(cacheKey, payload);
    sendJson(request, response, 200, payload, { "X-Cache": "MISS" });
  } catch (error) {
    sendJson(request, response, 502, {
      error: "fetch_failed",
      message: error.message || "评论抓取失败，可能需要 Cookie 或遇到风控。"
    });
  }
}

async function handleProbe(request, response) {
  const url = parseRequestUrl(request);
  if (!url) {
    sendJson(request, response, 400, { ok: false, error: "invalid_request_url" });
    return;
  }
  const input = String(url.searchParams.get("url") || DEFAULT_PROBE_URL).trim();
  const limit = boundedInteger(url.searchParams.get("limit"), 1, 1, 3);

  if (input.length > 500) {
    sendJson(request, response, 400, { ok: false, error: "invalid video input" });
    return;
  }

  try {
    const probeUrl = extractBvid(input) ? input : DEFAULT_PROBE_URL;
    const payload = await handleCommentsLikeProbe(probeUrl, limit);
    sendJson(request, response, 200, {
      ok: true,
      service: "gameops-comments",
      message: `真实评论接口可用：${payload.title || payload.bvid || "视频"}，返回 ${payload.comments.length} 条`,
      note: payload.usedFallback ? "已触发备用评论接口" : ""
    });
  } catch (error) {
    sendJson(request, response, 502, {
      ok: false,
      service: "gameops-comments",
      message: `真实评论接口不可用：${error.message}`
    });
  }
}

async function handleCommentsLikeProbe(input, limit) {
  const bvid = extractBvid(input);
  const aid = bvid ? "" : extractAid(input);
  const video = await fetchVideoInfo({ bvid, aid });
  let comments = [];
  let usedFallback = false;
  try {
    comments = await fetchComments(video.aid, limit);
  } catch (_error) {
    comments = await fetchCommentsFallback(video.aid, limit);
    usedFallback = true;
  }
  return { ...video, comments, usedFallback };
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (!allowRequest(request)) {
    sendJson(request, response, 429, { error: "rate_limited", message: "请求过于频繁，请稍后重试。" }, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(request, response, 200, { ok: true, service: "gameops-comments" });
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/probe")) {
    handleProbe(request, response);
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/comments")) {
    handleComments(request, response);
    return;
  }

  sendJson(request, response, 404, { error: "not found" });
});

server.on("error", (error) => {
  console.error(`Comment service failed: ${error.message}`);
  if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use.`);
  if (error.code === "EPERM") console.error("Permission denied while opening localhost port. Run this from your normal terminal.");
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Comment service running at http://127.0.0.1:${PORT}`);
});
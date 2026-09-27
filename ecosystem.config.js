const path = require("node:path");
const { isIP } = require("node:net");
require("./lib/env-file").loadProjectEnv(__dirname);
const { parseIntegerConfig } = require("./lib/http-guards");
const { assertSafeProviderUrl, SUPPORTED_PLATFORMS, isSupportedPlatform } = require("./lib/platform-provider");
const { isValidBusinessTime } = require("./lib/business-date");

const cwd = __dirname;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
const ocrProvider = String(process.env.OCR_PROVIDER || "macos").trim().toLowerCase();
const morningSchedule = String(process.env.MORNING_SCHEDULE || "09:00").trim();
const morningPlatform = String(process.env.MORNING_PLATFORM || "B站").trim();

if (!new Set(["macos", "remote"]).has(ocrProvider)) {
  throw new Error("OCR_PROVIDER 必须是 macos 或 remote");
}
if (!isValidBusinessTime(morningSchedule)) {
  throw new Error("MORNING_SCHEDULE 必须是 24 小时制 HH:mm（00:00-23:59）");
}
if (!isSupportedPlatform(morningPlatform)) {
  throw new Error(`MORNING_PLATFORM 必须是以下平台之一：${SUPPORTED_PLATFORMS.join("、")}`);
}

for (const name of [
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
  "ARCHIVE_RATE_LIMIT_MAX",
  "ARCHIVE_AUTH_RATE_LIMIT_MAX",
  "OCR_RATE_LIMIT_MAX",
  "LLM_RATE_LIMIT_MAX"
]) {
  const rawValue = process.env[name];
  if (rawValue === undefined || !String(rawValue).trim()) continue;
  const min = name === "RATE_LIMIT_WINDOW_MS" ? 1000 : 1;
  const max = name === "RATE_LIMIT_WINDOW_MS" ? 2147483647 : Number.MAX_SAFE_INTEGER;
  try {
    parseIntegerConfig(rawValue, { name, min, max });
  } catch (_error) {
    if (name === "RATE_LIMIT_WINDOW_MS") throw new Error("RATE_LIMIT_WINDOW_MS 必须是 1000-2147483647 毫秒的整数");
    throw new Error(`${name} 必须是正整数`);
  }
}

for (const [name, options, message] of [
  ["UPSTREAM_TIMEOUT_MS", { min: 1000, max: 2147483647 }, "UPSTREAM_TIMEOUT_MS 必须是 1000-2147483647 之间的整数"],
  ["UPSTREAM_RETRIES", { min: 0, max: 3 }, "UPSTREAM_RETRIES 必须是 0-3 的整数"],
  ["CACHE_TTL_MS", { min: 0 }, "CACHE_TTL_MS 必须是非负整数"],
  ["OCR_TIMEOUT_MS", { min: 1, max: 2147483647 }, "OCR_TIMEOUT_MS 必须是 1-2147483647 之间的整数"],
  ["OCR_READINESS_TIMEOUT_MS", { min: 1, max: 2147483647 }, "OCR_READINESS_TIMEOUT_MS 必须是 1-2147483647 之间的整数"],
  ["OCR_MAX_CONCURRENCY", { min: 1 }, "OCR_MAX_CONCURRENCY 必须是正整数"],
  ["LLM_TIMEOUT_MS", { min: 1, max: 2147483647 }, "LLM_TIMEOUT_MS 必须是 1-2147483647 之间的整数"],
  ["LLM_MAX_CONCURRENCY", { min: 1 }, "LLM_MAX_CONCURRENCY 必须是正整数"],
  ["LLM_CACHE_TTL_MS", { min: 0 }, "LLM_CACHE_TTL_MS 必须是非负整数"],
  ["PLATFORM_PROVIDER_TIMEOUT_MS", { min: 1000, max: 2147483647 }, "PLATFORM_PROVIDER_TIMEOUT_MS 必须是 1000-2147483647 之间的整数"],
  ["XHS_BRIDGE_TIMEOUT_MS", { min: 1000, max: 2147483647 }, "XHS_BRIDGE_TIMEOUT_MS 必须是 1000-2147483647 之间的整数"],
  ["ARCHIVE_SESSION_HOURS", { min: 1, max: 744 }, "ARCHIVE_SESSION_HOURS 必须是 1-744 小时的整数"]
]) {
  const rawValue = process.env[name];
  if (rawValue === undefined || !String(rawValue).trim()) continue;
  try {
    parseIntegerConfig(rawValue, { name, ...options });
  } catch (_error) {
    throw new Error(message);
  }
}

const configuredPorts = [
  ["HOTSPOT_PORT", process.env.HOTSPOT_PORT],
  ["COMMENT_PORT", process.env.COMMENT_PORT],
  [process.env.OCR_PORT ? "OCR_PORT" : "PORT", process.env.OCR_PORT || process.env.PORT],
  ["LLM_PORT", process.env.LLM_PORT],
  ["ARCHIVE_PORT", process.env.ARCHIVE_PORT]
];
for (const [name, rawValue] of configuredPorts) {
  if (rawValue === undefined || !String(rawValue).trim()) continue;
  try {
    parseIntegerConfig(rawValue, { name, min: 1, max: 65535 });
  } catch (_error) {
    throw new Error(`${name} 必须是 1-65535 之间的整数`);
  }
}

function hasExampleHost(value) {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase().replace(/\.+$/, "");
    return host === "example.com" || host.endsWith(".example.com");
  } catch (_error) {
    return false;
  }
}

function isPlaceholderOrigin(value) {
  return value.split(",").some(hasExampleHost);
}

if (!allowedOrigin || isPlaceholderOrigin(allowedOrigin)) {
  throw new Error("部署前必须设置 ALLOWED_ORIGIN=https://你的真实域名");
}

const allowedOriginError = "ALLOWED_ORIGIN 必须是一个或多个 HTTPS 源（仅协议、域名和可选端口），不能使用本机地址";
const configuredOrigins = allowedOrigin.split(",").map((origin) => origin.trim());
if (configuredOrigins.some((origin) => !origin)) {
  throw new Error(allowedOriginError);
}
for (const origin of configuredOrigins) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch (_error) {
    throw new Error(allowedOriginError);
  }
  const host = parsedOrigin.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
  const ipVersion = isIP(host);
  const isLoopback = host === "localhost" || host.endsWith(".localhost") ||
    (ipVersion === 4 && host.startsWith("127.")) || (ipVersion === 6 && host === "::1");
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin || isLoopback) {
    throw new Error(allowedOriginError);
  }
}

if (process.env.ALLOW_FILE_ORIGIN === "1") {
  throw new Error("线上部署禁止 ALLOW_FILE_ORIGIN=1；file:// 页面不能访问公网 API");
}

try {
  assertSafeProviderUrl(process.env.LLM_BASE_URL || "https://api.deepseek.com/v1");
} catch (error) {
  throw new Error("LLM_BASE_URL 配置不安全：" + error.message);
}

if (process.env.ARCHIVE_AUTH_ENABLED !== "1") {
  throw new Error("线上部署必须设置 ARCHIVE_AUTH_ENABLED=1，以禁止匿名归档写入");
}

const archiveAdminUsername = String(process.env.ARCHIVE_ADMIN_USERNAME || "admin").trim();
if (!/^[A-Za-z0-9._-]{3,40}$/.test(archiveAdminUsername)) {
  throw new Error("ARCHIVE_ADMIN_USERNAME 必须是 3-40 位字母、数字、点、下划线或连字符");
}

const archiveAdminPassword = String(process.env.ARCHIVE_ADMIN_PASSWORD || "");
const placeholderPasswords = new Set([
  "请使用至少 12 位的随机强密码",
  "change-me",
  "change_me",
  "changeme",
  "password",
  "admin123"
]);
if (archiveAdminPassword.length < 12 || archiveAdminPassword.length > 200 ||
    placeholderPasswords.has(archiveAdminPassword.trim().toLowerCase())) {
  throw new Error("ARCHIVE_ADMIN_PASSWORD 必须是 12-200 位且不能使用示例或常见占位值");
}

if ((process.env.ARCHIVE_COOKIE_SECURE || "1") !== "1") {
  throw new Error("线上部署必须保持 ARCHIVE_COOKIE_SECURE=1");
}

if (ocrProvider === "remote") {
  const remoteOcrUrl = String(process.env.OCR_REMOTE_URL || "");
  if (!remoteOcrUrl || hasExampleHost(remoteOcrUrl)) {
    throw new Error("OCR_PROVIDER=remote 时必须设置真实的 OCR_REMOTE_URL");
  }

  let parsedOcrUrl;
  try {
    parsedOcrUrl = new URL(remoteOcrUrl);
  } catch (_error) {
    throw new Error("OCR_REMOTE_URL 必须是有效的 HTTP/HTTPS URL");
  }
  if (parsedOcrUrl.protocol !== "https:" && parsedOcrUrl.protocol !== "http:") {
    throw new Error("OCR_REMOTE_URL 必须是有效的 HTTP/HTTPS URL");
  }

  const isLocalHttp = parsedOcrUrl.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsedOcrUrl.hostname.toLowerCase());
  if (parsedOcrUrl.protocol === "http:" && !isLocalHttp && process.env.OCR_ALLOW_INSECURE_REMOTE !== "true") {
    throw new Error("公网 OCR 使用 HTTP 时必须设置 OCR_ALLOW_INSECURE_REMOTE=true");
  }
}

function app(name, script, env) {
  return {
    name,
    script: path.join(cwd, script),
    cwd,
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "300M",
    kill_timeout: 5000,
    exp_backoff_restart_delay: 1000,
    max_restarts: 10,
    min_uptime: "10s",
    time: true,
    env: {
      NODE_ENV: "production",
      ALLOWED_ORIGIN: allowedOrigin,
      // All public traffic reaches Node through the bundled localhost Nginx proxy.
      TRUST_PROXY: "1",
      ...env
    }
  };
}

module.exports = {
  apps: [
    app("gameops-hotspot", "hotspot-server.js", {
      HOTSPOT_PORT: process.env.HOTSPOT_PORT || "8790",
      BILIBILI_COOKIE: process.env.BILIBILI_COOKIE || "",
      DOUYIN_PROVIDER_URL: process.env.DOUYIN_PROVIDER_URL || "",
      DOUYIN_PROVIDER_TOKEN: process.env.DOUYIN_PROVIDER_TOKEN || "",
      XIAOHONGSHU_PROVIDER_URL: process.env.XIAOHONGSHU_PROVIDER_URL || "",
      XIAOHONGSHU_PROVIDER_TOKEN: process.env.XIAOHONGSHU_PROVIDER_TOKEN || "",
      PLATFORM_PROVIDER_TIMEOUT_MS: process.env.PLATFORM_PROVIDER_TIMEOUT_MS || "15000",
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || "60",
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || "60000",
      CACHE_TTL_MS: process.env.CACHE_TTL_MS || "60000",
      UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS || "8000",
      UPSTREAM_RETRIES: process.env.UPSTREAM_RETRIES || "1"
    }),
    app("gameops-comment", "comment-server.js", {
      COMMENT_PORT: process.env.COMMENT_PORT || "8791",
      BILIBILI_VIDEO_INFO_URL: process.env.BILIBILI_VIDEO_INFO_URL || "",
      BILIBILI_COOKIE: process.env.BILIBILI_COOKIE || "",
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || "60",
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || "60000",
      CACHE_TTL_MS: process.env.CACHE_TTL_MS || "60000",
      UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS || "8000",
      UPSTREAM_RETRIES: process.env.UPSTREAM_RETRIES || "1"
    }),
    app("gameops-ocr", "ocr-server.js", {
      PORT: process.env.OCR_PORT || process.env.PORT || "8787",
      OCR_PROVIDER: ocrProvider,
      OCR_REMOTE_URL: process.env.OCR_REMOTE_URL || "",
      OCR_REMOTE_API_KEY: process.env.OCR_REMOTE_API_KEY || "",
      OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS || "15000",
      OCR_READINESS_TIMEOUT_MS: process.env.OCR_READINESS_TIMEOUT_MS || "90000",
      OCR_RATE_LIMIT_MAX: process.env.OCR_RATE_LIMIT_MAX || "30",
      OCR_MAX_CONCURRENCY: process.env.OCR_MAX_CONCURRENCY || "2",
      OCR_ALLOW_INSECURE_REMOTE: process.env.OCR_ALLOW_INSECURE_REMOTE || "false"
    }),
    app("gameops-llm", "llm-server.js", {
      LLM_PORT: process.env.LLM_PORT || "8794",
      LLM_API_KEY: process.env.LLM_API_KEY || "",
      LLM_BASE_URL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
      LLM_MODEL: process.env.LLM_MODEL || "deepseek-chat",
      LLM_JSON_MODE: process.env.LLM_JSON_MODE || "auto",
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS || "45000",
      LLM_CACHE_TTL_MS: process.env.LLM_CACHE_TTL_MS || "600000",
      LLM_RATE_LIMIT_MAX: process.env.LLM_RATE_LIMIT_MAX || "20",
      LLM_MAX_CONCURRENCY: process.env.LLM_MAX_CONCURRENCY || "2"
    }),
    app("gameops-archive", "archive-server.js", {
      ARCHIVE_PORT: process.env.ARCHIVE_PORT || "8796",
      ARCHIVE_DB_PATH: process.env.ARCHIVE_DB_PATH || "",
      ARCHIVE_RATE_LIMIT_MAX: process.env.ARCHIVE_RATE_LIMIT_MAX || "120",
      ARCHIVE_AUTH_RATE_LIMIT_MAX: process.env.ARCHIVE_AUTH_RATE_LIMIT_MAX || "8",
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || "60000",
      ARCHIVE_AUTH_ENABLED: process.env.ARCHIVE_AUTH_ENABLED || "0",
      ARCHIVE_ADMIN_USERNAME: process.env.ARCHIVE_ADMIN_USERNAME || "admin",
      ARCHIVE_ADMIN_PASSWORD: process.env.ARCHIVE_ADMIN_PASSWORD || "",
      ARCHIVE_COOKIE_SECURE: process.env.ARCHIVE_COOKIE_SECURE || "1",
      ARCHIVE_SESSION_HOURS: process.env.ARCHIVE_SESSION_HOURS || "12",
      MORNING_SCHEDULE: morningSchedule,
      MORNING_GAMES: process.env.MORNING_GAMES || "",
      MORNING_PLATFORM: morningPlatform,
      HOTSPOT_SOURCE_URL: process.env.HOTSPOT_SOURCE_URL || "http://127.0.0.1:8790"
    })
  ]
};

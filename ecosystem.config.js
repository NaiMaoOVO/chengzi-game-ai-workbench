const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);
const { assertSafeProviderUrl } = require("./lib/platform-provider");

const cwd = __dirname;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
const ocrProvider = process.env.OCR_PROVIDER || "macos";

if (!allowedOrigin || allowedOrigin.includes("example.com")) {
  throw new Error("部署前必须设置 ALLOWED_ORIGIN=https://你的真实域名");
}

if (process.env.ALLOW_FILE_ORIGIN === "1") {
  throw new Error("线上部署禁止 ALLOW_FILE_ORIGIN=1；file:// 页面不能访问公网 API");
}

try {
  assertSafeProviderUrl(process.env.LLM_BASE_URL || "https://api.deepseek.com/v1");
} catch (error) {
  throw new Error("LLM_BASE_URL 配置不安全：" + error.message);
}

if (process.env.ARCHIVE_AUTH_ENABLED === "1" && String(process.env.ARCHIVE_ADMIN_PASSWORD || "").length < 12) {
  throw new Error("启用 ARCHIVE_AUTH_ENABLED 时必须设置至少 12 位的 ARCHIVE_ADMIN_PASSWORD");
}

if (ocrProvider === "remote" && (!process.env.OCR_REMOTE_URL || process.env.OCR_REMOTE_URL.includes("example.com"))) {
  throw new Error("OCR_PROVIDER=remote 时必须设置真实的 OCR_REMOTE_URL");
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
      DOUYIN_PROVIDER_URL: process.env.DOUYIN_PROVIDER_URL || "",
      XIAOHONGSHU_PROVIDER_URL: process.env.XIAOHONGSHU_PROVIDER_URL || "",
      PLATFORM_PROVIDER_TIMEOUT_MS: process.env.PLATFORM_PROVIDER_TIMEOUT_MS || "15000",
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || "60",
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || "60000",
      CACHE_TTL_MS: process.env.CACHE_TTL_MS || "60000",
      UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS || "8000",
      UPSTREAM_RETRIES: process.env.UPSTREAM_RETRIES || "1"
    }),
    app("gameops-comment", "comment-server.js", {
      COMMENT_PORT: process.env.COMMENT_PORT || "8791",
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
      OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS || "15000",
      OCR_READINESS_TIMEOUT_MS: process.env.OCR_READINESS_TIMEOUT_MS || "90000",
      OCR_RATE_LIMIT_MAX: process.env.OCR_RATE_LIMIT_MAX || "30",
      OCR_MAX_CONCURRENCY: process.env.OCR_MAX_CONCURRENCY || "2",
      OCR_ALLOW_INSECURE_REMOTE: process.env.OCR_ALLOW_INSECURE_REMOTE || "false"
    }),
    app("gameops-llm", "llm-server.js", {
      LLM_PORT: process.env.LLM_PORT || "8794",
      LLM_BASE_URL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
      LLM_MODEL: process.env.LLM_MODEL || "deepseek-chat",
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS || "45000",
      LLM_CACHE_TTL_MS: process.env.LLM_CACHE_TTL_MS || "600000",
      LLM_RATE_LIMIT_MAX: process.env.LLM_RATE_LIMIT_MAX || "20",
      LLM_MAX_CONCURRENCY: process.env.LLM_MAX_CONCURRENCY || "2"
    }),
    app("gameops-archive", "archive-server.js", {
      ARCHIVE_PORT: process.env.ARCHIVE_PORT || "8796",
      ARCHIVE_DB_PATH: process.env.ARCHIVE_DB_PATH || "",
      ARCHIVE_RATE_LIMIT_MAX: process.env.ARCHIVE_RATE_LIMIT_MAX || "120"
    })
  ]
};

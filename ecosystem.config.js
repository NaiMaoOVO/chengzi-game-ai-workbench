const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);

const cwd = __dirname;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
const ocrProvider = process.env.OCR_PROVIDER || "macos";

if (!allowedOrigin || allowedOrigin.includes("example.com")) {
  throw new Error("部署前必须设置 ALLOWED_ORIGIN=https://你的真实域名");
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
    time: true,
    env: {
      NODE_ENV: "production",
      ALLOWED_ORIGIN: allowedOrigin,
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
      LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS || "45000",
      LLM_CACHE_TTL_MS: process.env.LLM_CACHE_TTL_MS || "600000",
      LLM_RATE_LIMIT_MAX: process.env.LLM_RATE_LIMIT_MAX || "20",
      LLM_MAX_CONCURRENCY: process.env.LLM_MAX_CONCURRENCY || "2"
    })
  ]
};

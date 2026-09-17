// 全部 HTTP 入口共享的 CORS 工厂：统一非法 Origin 的判定与响应头形态。
// 历史上 hotspot/comment 对非法 Origin 返回 200 不带 ACAO，ocr/llm/archive 返回 403，
// 两种行为并存导致契约测试各说各话；收敛后所有服务统一为 403 + ACAO "null"（不回显恶意 Origin）。
const DEFAULT_ALLOWED_ORIGIN = "http://localhost:3000,http://localhost:5173,http://localhost:8793,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8793";

function parseAllowedOrigins(value) {
  return new Set(String(value || DEFAULT_ALLOWED_ORIGIN).split(",").map((item) => item.trim()).filter(Boolean));
}

function isOriginAllowed(request, allowedOrigins, allowFileOrigin = false) {
  const origin = request.headers.origin;
  // file:// 页面的 Origin 是字面量 "null"。仅未配置线上域名的本机模式或显式白名单允许它。
  return allowedOrigins.has("*") || !origin || (origin === "null" && (allowFileOrigin || allowedOrigins.has("null"))) || allowedOrigins.has(origin);
}

function createCors({ allowedOrigins, methods, allowFileOrigin = allowedOrigins === undefined || allowedOrigins === "" }) {
  const origins = parseAllowedOrigins(allowedOrigins);
  const allowAll = origins.has("*");
  function corsHeaders(request) {
    const origin = request.headers.origin;
    const allowed = allowAll || !origin || (origin === "null" && (allowFileOrigin || origins.has("null"))) || origins.has(origin);
    return {
      "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : (origin === "null" ? "null" : (origin || "null"))) : "null",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
      "Vary": "Origin"
    };
  }
  function isOriginAllowedRequest(request) {
    return isOriginAllowed(request, origins, allowFileOrigin);
  }
  return { corsHeaders, isOriginAllowed: isOriginAllowedRequest, allowedOrigins: origins };
}

module.exports = { DEFAULT_ALLOWED_ORIGIN, parseAllowedOrigins, isOriginAllowed, createCors };

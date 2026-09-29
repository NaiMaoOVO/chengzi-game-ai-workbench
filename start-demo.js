const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);
const { getRestartDelay } = require("./lib/service-supervisor");
const { ensureControllerStateDirectory, getControllerInstanceId, readControllerState, writeControllerState } = require("./lib/controller-instance");
const { parseRequestUrl } = require("./lib/safe-request-url");
const { createCors } = require("./lib/cors");
const { parseIntegerConfig } = require("./lib/http-guards");

const ROOT = __dirname;
const CONTROLLER_INSTANCE_ID = getControllerInstanceId(ROOT);
function configuredPort(name, value, defaultValue) {
  return parseIntegerConfig(value, { name, min: 1, max: 65535, defaultValue });
}
const CONTROLLER_PORT = configuredPort("CONTROLLER_PORT", process.env.CONTROLLER_PORT, 8793);
const OCR_PORT = configuredPort(process.env.OCR_PORT ? "OCR_PORT" : "PORT", process.env.OCR_PORT || process.env.PORT, 8787);
const xhsBridgePort = configuredPort("XHS_BRIDGE_PORT", process.env.XHS_BRIDGE_PORT, 8805);
const CORE_SERVICES = [
  { name: "热点服务", script: "hotspot-server.js", port: configuredPort("HOTSPOT_PORT", process.env.HOTSPOT_PORT, 8790), identity: "gameops-hotspot" },
  { name: "评论服务", script: "comment-server.js", port: configuredPort("COMMENT_PORT", process.env.COMMENT_PORT, 8791), identity: "gameops-comments" },
  { name: "OCR 服务", script: "ocr-server.js", port: OCR_PORT, identity: "gameops-ocr" },
  { name: "AI 增强服务", script: "llm-server.js", port: configuredPort("LLM_PORT", process.env.LLM_PORT, 8794), identity: "gameops-llm" },
  { name: "存档服务", script: "archive-server.js", port: configuredPort("ARCHIVE_PORT", process.env.ARCHIVE_PORT, 8796), identity: "gameops-archive" }
];
function isLocalXhsBridgeConfigured() {
  if (!process.env.XIAOHONGSHU_PROVIDER_URL) return false;
  try {
    const url = new URL(process.env.XIAOHONGSHU_PROVIDER_URL);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      && Number(url.port || 80) === xhsBridgePort && url.pathname === "/search";
  } catch (_error) {
    return false;
  }
}
const SERVICES = isLocalXhsBridgeConfigured()
  ? [...CORE_SERVICES, { name: "小红书 MCP 桥接", script: "xiaohongshu-bridge.js", port: xhsBridgePort, identity: "gameops-xiaohongshu-bridge", token: process.env.XHS_BRIDGE_TOKEN || "" }]
  : CORE_SERVICES;
const STATE_FILE = ensureControllerStateDirectory(ROOT).current;
const managedChildren = new Map();
const restartAttempts = new Map();
const restartTimers = new Map();
let shuttingDown = false;
let monitorTimer = null;

function checkPort(port, identity, token = "", endpoint = "/health", requireReady = false) {
  return new Promise((resolve) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const request = http.get(`http://127.0.0.1:${port}${endpoint}`, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          resolve(response.statusCode === 200 && payload.service === identity && (!requireReady || payload.ready === true));
        } catch (_error) {
          resolve(false);
        }
      });
    });
    request.on("error", () => resolve(false));
    request.setTimeout(900, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function startService(service) {
  if (shuttingDown || managedChildren.has(service.name)) return null;
  const child = spawn(process.execPath, [path.join(ROOT, service.script)], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });
  managedChildren.set(service.name, child);
  const startedAt = Date.now();
  child.on("exit", (code) => {
    managedChildren.delete(service.name);
    if (Date.now() - startedAt > 30000) restartAttempts.set(service.name, 0);
    if (code) {
      console.log(`${service.name} 已退出，退出码 ${code}`);
    }
    if (shuttingDown) return;
    const attempt = (restartAttempts.get(service.name) || 0) + 1;
    restartAttempts.set(service.name, attempt);
    const delay = getRestartDelay(attempt);
    console.log(`${service.name} 将在 ${delay}ms 后自动重启`);
    const timer = setTimeout(() => {
      restartTimers.delete(service.name);
      startService(service);
    }, delay);
    restartTimers.set(service.name, timer);
  });
  return child;
}

async function ensureServices() {
  if (shuttingDown) return;
  for (const service of SERVICES) {
    if (managedChildren.has(service.name) || restartTimers.has(service.name)) continue;
    if (!(await checkPort(service.port, service.identity, service.token))) {
      console.log(`检测到 ${service.name} 离线，正在自动拉起...`);
      startService(service);
    }
  }
}


/* ---- Read-only local status API (port 8793) ---- */
(function() {
  var srv = http.createServer(async function(req, res) {
    var url = parseRequestUrl(req);
    // 与其他六个服务共用同一 CORS 工厂：非法 Origin 统一 403，不再硬编码只放行 localhost。
    var cors = createCors({ allowedOrigins: process.env.ALLOWED_ORIGIN, methods: "GET, OPTIONS", allowFileOrigin: process.env.ALLOW_FILE_ORIGIN === "1" || process.env.NODE_ENV !== "production" });
    function j(c, d) {
      var headers = {"Content-Type":"application/json; charset=utf-8", ...cors.corsHeaders(req)};
      res.writeHead(c, headers);
      res.end(JSON.stringify(d));
    }
    if (!cors.isOriginAllowed(req)) { j(403, {ok:false, message:"origin not allowed"}); return; }
    if (req.method === "OPTIONS") { j(204, {}); return; }
    if (!url) { j(400, {ok:false, message:"invalid request URL"}); return; }
    var parts = url.pathname.split("/").filter(Boolean);
    if (req.method !== "GET") { j(405, {ok:false, message:"method not allowed"}); return; }
    if (parts[0] === "health" || parts[0] === "") { j(200, {ok:true, service:"gameops-local-controller", version:1, instanceId:CONTROLLER_INSTANCE_ID}); return; }
    if (parts[0] === "status") {
      var r = [];
      for (var s of SERVICES) {
        var running = await checkPort(s.port, s.identity, s.token);
        var item = {name:s.name, port:s.port, running};
        if (s.identity === "gameops-archive") item.ready = running && await checkPort(s.port, s.identity, s.token, "/ready", true);
        r.push(item);
      }
      j(200, {ok:true, service:"gameops-local-controller", version:1, services:r}); return;
    }
    j(404, {ok:false, message:"\u672a\u77e5\u8def\u5f84"});
  });
  srv.on("error", function(error) {
    const detail = error.code === "EADDRINUSE"
      ? `端口 ${CONTROLLER_PORT} 已被占用；如果当前由网页 Launcher 管理，请使用 Launcher 页面操作，不要重复启动。`
      : error.message;
    console.error("本地控制进程启动失败：" + detail);
    process.exit(1);
  });
  srv.listen(CONTROLLER_PORT, "127.0.0.1", function() {
    writeControllerState(STATE_FILE, {pid:process.pid, project:ROOT, instanceId:CONTROLLER_INSTANCE_ID});
    console.log("\x1b[36mLauncher http://127.0.0.1:" + CONTROLLER_PORT + "\x1b[0m");
    main();
  });
})();

async function main() {
  for (const service of SERVICES) {
    const running = await checkPort(service.port, service.identity, service.token);
    if (running) {
      console.log(`${service.name} 已在运行：http://127.0.0.1:${service.port}`);
      continue;
    }
    console.log(`启动 ${service.name}...`);
    startService(service);
  }
  monitorTimer = setInterval(ensureServices, 5000);

  console.log("");
  console.log("工作台页面：");
  console.log(`file://${path.join(ROOT, "index.html")}`);
  console.log("");
  if (process.env.GAMEOPS_NO_OPEN !== "1") {
    console.log("保持这个终端窗口打开。结束演示时按 Control + C。");
  }

  if (process.env.GAMEOPS_NO_OPEN !== "1") {
    spawn("open", [path.join(ROOT, "index.html")], {
      detached: true,
      stdio: "ignore"
    }).unref();
  }

  const shutdown = () => {
    shuttingDown = true;
    if (monitorTimer) clearInterval(monitorTimer);
    restartTimers.forEach((timer) => clearTimeout(timer));
    managedChildren.forEach((child) => child.kill());
    try {
      const state = readControllerState(STATE_FILE);
      if (state.pid === process.pid && state.project === ROOT && state.instanceId === CONTROLLER_INSTANCE_ID) fs.rmSync(STATE_FILE, { force: true });
    } catch (_error) {
      // State may already have been removed by the restart helper.
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

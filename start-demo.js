const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);
const { getRestartDelay } = require("./lib/service-supervisor");
const { parseRequestUrl } = require("./lib/safe-request-url");

const ROOT = __dirname;
const STATE_FILE = path.join(os.tmpdir(), `gameops-workbench-${process.getuid?.() || "user"}.json`);
const CONTROLLER_PORT = Number(process.env.CONTROLLER_PORT) || 8793;
const CORE_SERVICES = [
  { name: "热点服务", script: "hotspot-server.js", port: Number(process.env.HOTSPOT_PORT) || 8790, identity: "gameops-hotspot" },
  { name: "评论服务", script: "comment-server.js", port: Number(process.env.COMMENT_PORT) || 8791, identity: "gameops-comments" },
  { name: "OCR 服务", script: "ocr-server.js", port: Number(process.env.PORT) || 8787, identity: "gameops-ocr" },
  { name: "AI 增强服务", script: "llm-server.js", port: Number(process.env.LLM_PORT) || 8794, identity: "gameops-llm" }
];
function isLocalXhsBridgeConfigured() {
  if (!process.env.XIAOHONGSHU_PROVIDER_URL) return false;
  try {
    const url = new URL(process.env.XIAOHONGSHU_PROVIDER_URL);
    const port = Number(process.env.XHS_BRIDGE_PORT) || 8805;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      && Number(url.port || 80) === port && url.pathname === "/search";
  } catch (_error) {
    return false;
  }
}
const xhsBridgePort = Number(process.env.XHS_BRIDGE_PORT) || 8805;
const SERVICES = isLocalXhsBridgeConfigured()
  ? [...CORE_SERVICES, { name: "小红书 MCP 桥接", script: "xiaohongshu-bridge.js", port: xhsBridgePort, identity: "gameops-xiaohongshu-bridge", token: process.env.XHS_BRIDGE_TOKEN || "" }]
  : CORE_SERVICES;
const managedChildren = new Map();
const restartAttempts = new Map();
const restartTimers = new Map();
let shuttingDown = false;
let monitorTimer = null;

function checkPort(port, identity, token = "") {
  return new Promise((resolve) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const request = http.get(`http://127.0.0.1:${port}/health`, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body).service === identity);
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
    function corsOrigin() {
      var origin = req.headers.origin;
      if (origin === "null") return "null";
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "")) return origin;
      return undefined;
    }
    function j(c, d) {
      var headers = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Methods":"GET"};
      var allowOrigin = corsOrigin();
      if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
      res.writeHead(c, headers);
      res.end(JSON.stringify(d));
    }
    if (!url) { j(400, {ok:false, message:"invalid request URL"}); return; }
    var parts = url.pathname.split("/").filter(Boolean);
    if (req.method !== "GET") { j(405, {ok:false, message:"method not allowed"}); return; }
    if (parts[0] === "health" || parts[0] === "") { j(200, {ok:true, service:"gameops-local-controller", version:1}); return; }
    if (parts[0] === "status") {
      var r = [];
      for (var s of SERVICES) r.push({name:s.name, port:s.port, running:await checkPort(s.port, s.identity, s.token)});
      j(200, {ok:true, service:"gameops-local-controller", version:1, services:r}); return;
    }
    j(404, {ok:false, message:"\u672a\u77e5\u8def\u5f84"});
  });
  srv.on("error", function(error) {
    console.error("本地控制进程启动失败：" + error.message);
    process.exit(1);
  });
  srv.listen(CONTROLLER_PORT, "127.0.0.1", function() {
    fs.writeFileSync(STATE_FILE, JSON.stringify({pid:process.pid, project:ROOT}) + "\n", {mode:0o600});
    console.log("\x1b[36mLauncher http://127.0.0.1:" + CONTROLLER_PORT + "\x1b[0m");
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
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (state.pid === process.pid) fs.rmSync(STATE_FILE, { force: true });
    } catch (_error) {
      // State may already have been removed by the restart helper.
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();

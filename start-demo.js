const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = __dirname;
const STATE_FILE = path.join(os.tmpdir(), `gameops-workbench-${process.getuid?.() || "user"}.json`);
const SERVICES = [
  { name: "热点服务", script: "hotspot-server.js", port: 8790, identity: "gameops-hotspot" },
  { name: "评论服务", script: "comment-server.js", port: 8791, identity: "gameops-comments" },
  { name: "OCR 服务", script: "ocr-server.js", port: 8787, identity: "gameops-ocr" },
  { name: "AI 增强服务", script: "llm-server.js", port: 8794, identity: "gameops-llm" }
];

function checkPort(port, identity) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
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
  const child = spawn(process.execPath, [path.join(ROOT, service.script)], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code) => {
    if (code) {
      console.log(`${service.name} 已退出，退出码 ${code}`);
    }
  });
  return child;
}


/* ---- Read-only local status API (port 8793) ---- */
(function() {
  var srv = http.createServer(async function(req, res) {
    var url = new URL(req.url, "http://" + req.headers.host);
    var parts = url.pathname.split("/").filter(Boolean);
    function j(c, d) { res.writeHead(c, {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"null","Access-Control-Allow-Methods":"GET"}); res.end(JSON.stringify(d)); }
    if (req.method !== "GET") { j(405, {ok:false, message:"method not allowed"}); return; }
    if (parts[0] === "health" || parts[0] === "") { j(200, {ok:true, service:"gameops-local-controller", version:1}); return; }
    if (parts[0] === "status") {
      var r = [];
      for (var s of SERVICES) r.push({name:s.name, port:s.port, running:await checkPort(s.port, s.identity)});
      j(200, {ok:true, service:"gameops-local-controller", version:1, services:r}); return;
    }
    j(404, {ok:false, message:"\u672a\u77e5\u8def\u5f84"});
  });
  srv.on("error", function(error) {
    console.error("本地控制进程启动失败：" + error.message);
    process.exit(1);
  });
  srv.listen(8793, "127.0.0.1", function() {
    fs.writeFileSync(STATE_FILE, JSON.stringify({pid:process.pid, project:ROOT}) + "\n", {mode:0o600});
    console.log("\x1b[36mLauncher http://127.0.0.1:8793\x1b[0m");
  });
})();

async function main() {
  const children = [];

  for (const service of SERVICES) {
    const running = await checkPort(service.port, service.identity);
    if (running) {
      console.log(`${service.name} 已在运行：http://127.0.0.1:${service.port}`);
      continue;
    }
    console.log(`启动 ${service.name}...`);
    children.push(startService(service));
  }

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
    children.forEach((child) => child.kill());
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

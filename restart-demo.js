const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);

const ROOT = __dirname;
const STATE_FILE = path.join(os.tmpdir(), `gameops-workbench-${process.getuid?.() || "user"}.json`);
const CONTROLLER_PORT = Number(process.env.CONTROLLER_PORT) || 8793;
const START_SCRIPT = path.join(ROOT, "start-demo.js");

function isProjectController(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8"
    }).trim();
    const parts = command.split(/\s+/);
    const nodeBin = parts[0] || "";
    const nodeOk =
      nodeBin === process.execPath ||
      nodeBin === "node" ||
      nodeBin.endsWith("/node") ||
      nodeBin.endsWith("/node.exe");
    const scriptOk = parts.slice(1).some(
      (arg) => arg === START_SCRIPT || arg === "start-demo.js" || arg.endsWith("/start-demo.js")
    );
    return nodeOk && scriptOk;
  } catch (_error) {
    return false;
  }
}

function readStatePid() {
  try {
    return Number(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).pid);
  } catch (_error) {
    return 0;
  }
}

function findListenerPid(port) {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" }
    );
    return output
      .split(/\s+/)
      .map((value) => Number(value))
      .find((pid) => Number.isInteger(pid) && pid > 1) || 0;
  } catch (_error) {
    return 0;
  }
}

function checkControllerIdentity() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${CONTROLLER_PORT}/health`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          resolve(
            response.statusCode === 200 &&
              payload.ok === true &&
              payload.service === "gameops-local-controller"
          );
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

async function resolveControllerPid() {
  const statePid = readStatePid();
  if (isProjectController(statePid)) return statePid;

  const listenerPid = findListenerPid(CONTROLLER_PORT);
  if (!isProjectController(listenerPid)) return 0;

  const identityOk = await checkControllerIdentity();
  return identityOk ? listenerPid : 0;
}

function waitForExit(pid, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      try {
        process.kill(pid, 0);
      } catch (_error) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

async function main() {
  const pid = await resolveControllerPid();

  if (pid) {
    process.kill(pid, "SIGTERM");
    const stopped = await waitForExit(pid);
    if (!stopped) throw new Error("旧控制进程未能在 5 秒内退出，请稍后重试");
  }
  fs.rmSync(STATE_FILE, { force: true });

  const child = spawn(process.execPath, [START_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code) => process.exit(code || 0));
}

main().catch((error) => {
  console.error(`重启失败：${error.message}`);
  process.exit(1);
});

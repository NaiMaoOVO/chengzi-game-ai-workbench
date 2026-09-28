const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
require("./lib/env-file").loadProjectEnv(__dirname);
const { parseIntegerConfig } = require("./lib/http-guards");
const { getChildProcessExitCode } = require("./lib/service-supervisor");
const {
  ensureControllerStateDirectory,
  getControllerInstanceId,
  isOwnedControllerState,
  isProjectControllerCommand,
  readControllerState
} = require("./lib/controller-instance");

const ROOT = __dirname;
const CONTROLLER_INSTANCE_ID = getControllerInstanceId(ROOT);
const CONTROLLER_PORT = parseIntegerConfig(process.env.CONTROLLER_PORT, { name: "CONTROLLER_PORT", min: 1, max: 65535, defaultValue: 8793 });
const STATE_PATHS = ensureControllerStateDirectory(ROOT);
const STATE_FILE = STATE_PATHS.current;
const START_SCRIPT = path.join(ROOT, "start-demo.js");

function isProjectController(pid, { allowRelativeScript = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8"
    }).trim();
    return isProjectControllerCommand(command, ROOT, { allowRelativeScript });
  } catch (_error) {
    return false;
  }
}

function readStateFile(filePath, { legacy = false, expectedPid } = {}) {
  try {
    const state = readControllerState(filePath);
    if (!isOwnedControllerState(state, ROOT, { allowLegacy: legacy, expectedPid })) return null;
    return { pid: state.pid, filePath };
  } catch (_error) {
    return null;
  }
}

function readProjectState() {
  return readStateFile(STATE_FILE) || readStateFile(STATE_PATHS.legacy, { legacy: true });
}

function removeOwnedState(filePath, legacy = false, expectedPid) {
  if (readStateFile(filePath, { legacy, expectedPid })) fs.rmSync(filePath, { force: true });
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
              payload.service === "gameops-local-controller" &&
              (!payload.instanceId || payload.instanceId === CONTROLLER_INSTANCE_ID)
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
  const state = readProjectState();
  if (state && isProjectController(state.pid, { allowRelativeScript: true })) return state.pid;

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
  } else if (await checkControllerIdentity()) {
    throw new Error("控制器已在线，但无法验证进程归属；为避免重复启动，未重启。请检查 /status 后再试");
  }
  removeOwnedState(STATE_FILE, false, pid || undefined);
  removeOwnedState(STATE_PATHS.legacy, true, pid || undefined);

  const child = spawn(process.execPath, [START_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code, signal) => process.exit(getChildProcessExitCode(code, signal)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`重启失败：${error.message}`);
    process.exit(1);
  });
}

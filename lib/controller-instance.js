const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const MAX_STATE_BYTES = 4096;

function getControllerInstanceId(projectRoot) {
  return crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 24);
}

function getControllerStatePaths(projectRoot, userId = process.getuid?.() ?? "user") {
  const user = String(userId);
  const instanceId = getControllerInstanceId(projectRoot);
  const directory = path.join(os.tmpdir(), `gameops-workbench-${user}-${instanceId}`);
  return {
    directory,
    current: path.join(directory, "controller-state.json"),
    legacy: path.join(os.tmpdir(), `gameops-workbench-${user}.json`)
  };
}

function ensureControllerStateDirectory(projectRoot, userId) {
  const paths = getControllerStatePaths(projectRoot, userId);
  try {
    fs.mkdirSync(paths.directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stats = fs.lstatSync(paths.directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("本地控制器状态目录不安全");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("本地控制器状态目录不属于当前用户");
  }
  if ((stats.mode & 0o777) !== 0o700) fs.chmodSync(paths.directory, 0o700);
  return paths;
}

function readControllerState(filePath) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size > MAX_STATE_BYTES || (stats.mode & 0o077) !== 0) {
      throw new Error("本地控制器状态文件过大或权限无效");
    }
    const buffer = Buffer.allocUnsafe(MAX_STATE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_STATE_BYTES) throw new Error("本地控制器状态文件过大或权限无效");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeControllerState(filePath, state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("本地控制器状态无效");
  const content = JSON.stringify(state) + "\n";
  if (Buffer.byteLength(content, "utf8") > MAX_STATE_BYTES) throw new Error("本地控制器状态文件过大");
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function isOwnedControllerState(state, projectRoot, { allowLegacy = false, expectedPid } = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (state.project !== path.resolve(projectRoot) || !Number.isInteger(state.pid) || state.pid <= 1) return false;
  const instanceId = getControllerInstanceId(projectRoot);
  const hasInstanceId = Object.prototype.hasOwnProperty.call(state, "instanceId");
  if (hasInstanceId ? state.instanceId !== instanceId : !allowLegacy) return false;
  return expectedPid === undefined || state.pid === expectedPid;
}

function isProjectControllerCommand(command, projectRoot, { allowRelativeScript = false } = {}) {
  const value = String(command).trim();
  const separator = value.search(/\s/);
  if (separator < 0) return false;

  const executable = value.slice(0, separator);
  const nodeName = path.basename(executable);
  const nodeOk = executable === process.execPath || nodeName === "node" || nodeName === "node.exe";
  if (!nodeOk) return false;

  const rawScript = value.slice(separator + 1).trim();
  const quoted = (rawScript.startsWith("\"") && rawScript.endsWith("\""))
    || (rawScript.startsWith("'") && rawScript.endsWith("'"));
  const script = quoted ? rawScript.slice(1, -1) : rawScript;
  const expectedScript = path.join(path.resolve(projectRoot), "start-demo.js");
  return script === expectedScript || (allowRelativeScript && script === "start-demo.js");
}

module.exports = {
  ensureControllerStateDirectory,
  getControllerInstanceId,
  getControllerStatePaths,
  isOwnedControllerState,
  isProjectControllerCommand,
  readControllerState,
  writeControllerState
};

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

function getControllerInstanceId(projectRoot) {
  return crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 24);
}

function getControllerStatePaths(projectRoot, userId = process.getuid?.() ?? "user") {
  const user = String(userId);
  const instanceId = getControllerInstanceId(projectRoot);
  return {
    current: path.join(os.tmpdir(), `gameops-workbench-${user}-${instanceId}.json`),
    legacy: path.join(os.tmpdir(), `gameops-workbench-${user}.json`)
  };
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

module.exports = { getControllerInstanceId, getControllerStatePaths, isProjectControllerCommand };

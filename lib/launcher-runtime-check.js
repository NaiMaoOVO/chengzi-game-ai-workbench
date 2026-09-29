const fs = require("node:fs");
const path = require("node:path");
const { RUNTIME_FILES } = require("./runtime-manifest");

function checkLauncherRuntime({ root, runtime, appPath, files = RUNTIME_FILES }) {
  const missingSource = [];
  const missingRuntime = [];
  const stale = [];
  for (const file of files) {
    const source = path.join(root, file);
    const installed = path.join(runtime, file);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
      missingSource.push(file);
      continue;
    }
    if (!fs.statSync(installed, { throwIfNoEntry: false })?.isFile()) {
      missingRuntime.push(file);
      continue;
    }
    if (!fs.readFileSync(source).equals(fs.readFileSync(installed))) stale.push(file);
  }

  let nodeIssue = "";
  const configPath = appPath && path.join(appPath, "Contents", "Resources", "config.json");
  if (configPath && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const nodePath = typeof config.nodePath === "string" ? config.nodePath.trim() : "";
      if (!nodePath || !fs.statSync(nodePath, { throwIfNoEntry: false })?.isFile()) {
        nodeIssue = "Launcher 配置的 Node 可执行文件不存在";
      } else {
        try { fs.accessSync(nodePath, fs.constants.X_OK); }
        catch (_error) { nodeIssue = "Launcher 配置的 Node 文件不可执行"; }
      }
    } catch (_error) {
      nodeIssue = "Launcher 配置文件无法读取";
    }
  }

  const inSync = missingSource.length === 0 && missingRuntime.length === 0 && stale.length === 0 && !nodeIssue;
  return { inSync, missingSource, missingRuntime, stale, nodeIssue };
}

module.exports = { checkLauncherRuntime };

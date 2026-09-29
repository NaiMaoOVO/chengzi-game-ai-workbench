const os = require("node:os");
const path = require("node:path");
const { checkLauncherRuntime } = require("../lib/launcher-runtime-check");
const { writeLauncherSyncStatus } = require("../lib/launcher-runtime");

const root = path.resolve(__dirname, "..");
const runtime = path.join(os.homedir(), "Library", "Application Support", "GameOpsLauncher", "runtime");
const appPath = path.join(os.homedir(), "Applications", "GameOpsLauncher.app");
const result = checkLauncherRuntime({ root, runtime, appPath });
const inSync = result.inSync;
const detail = [
  ...result.missingSource.map((file) => `源码缺少 ${file}`),
  ...result.missingRuntime.map((file) => `runtime 缺少 ${file}`),
  ...result.stale.map((file) => `过期 ${file}`),
  result.nodeIssue
].filter(Boolean).join("；");
writeLauncherSyncStatus(root, {
  inSync,
  checkedAt: new Date().toISOString(),
  detail: inSync ? "" : detail
});

if (!inSync) {
  if (result.missingSource.length) console.error(`项目源码缺少：${result.missingSource.join("、")}`);
  if (result.missingRuntime.length) console.error(`Launcher runtime 缺少：${result.missingRuntime.join("、")}`);
  if (result.stale.length) console.error(`Launcher runtime 已过期：${result.stale.join("、")}`);
  if (result.nodeIssue) console.error(result.nodeIssue);
  console.error("请执行 npm run launcher:install 后再重启本地服务。");
  process.exit(1);
}

console.log("Launcher runtime 与源码一致");

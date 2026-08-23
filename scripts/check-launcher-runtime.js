const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RUNTIME_FILES } = require("../lib/runtime-manifest");
const { writeLauncherSyncStatus } = require("../lib/launcher-runtime");

const root = path.resolve(__dirname, "..");
const runtime = path.join(os.homedir(), "Library", "Application Support", "GameOpsLauncher", "runtime");
const files = RUNTIME_FILES;

const missing = [];
const stale = [];
for (const file of files) {
  const source = path.join(root, file);
  const installed = path.join(runtime, file);
  if (!fs.existsSync(source)) continue;
  if (!fs.existsSync(installed)) {
    missing.push(file);
    continue;
  }
  if (!fs.readFileSync(source).equals(fs.readFileSync(installed))) stale.push(file);
}

const inSync = missing.length === 0 && stale.length === 0;
writeLauncherSyncStatus(root, {
  inSync,
  checkedAt: new Date().toISOString(),
  detail: inSync ? "" : [
    ...missing.map((file) => `缺少 ${file}`),
    ...stale.map((file) => `过期 ${file}`)
  ].join("；")
});

if (!inSync) {
  if (missing.length) console.error(`Launcher runtime 缺少：${missing.join("、")}`);
  if (stale.length) console.error(`Launcher runtime 已过期：${stale.join("、")}`);
  console.error("请执行 npm run launcher:install 后再重启本地服务。");
  process.exit(1);
}

console.log("Launcher runtime 与源码一致");

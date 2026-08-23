const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtime = path.join(os.homedir(), "Library", "Application Support", "GameOpsLauncher", "runtime");
const files = [
  "start-demo.js",
  "restart-demo.js",
  "hotspot-server.js",
  "comment-server.js",
  "ocr-server.js",
  "llm-server.js",
  "xiaohongshu-bridge.js",
  "ocr.swift",
  "lib/env-file.js",
  "lib/hotspot-ranking.js",
  "lib/platform-provider.js",
  "lib/service-supervisor.js",
  "lib/launcher-runtime.js"
];

const missing = [];
const stale = [];
for (const file of files) {
  const source = path.join(root, file);
  const installed = path.join(runtime, file);
  if (!fs.existsSync(installed)) {
    missing.push(file);
    continue;
  }
  if (!fs.readFileSync(source).equals(fs.readFileSync(installed))) stale.push(file);
}

if (missing.length || stale.length) {
  if (missing.length) console.error(`Launcher runtime 缺少：${missing.join("、")}`);
  if (stale.length) console.error(`Launcher runtime 已过期：${stale.join("、")}`);
  console.error("请执行 npm run launcher:install 后再重启本地服务。");
  process.exit(1);
}

console.log("Launcher runtime 与源码一致");

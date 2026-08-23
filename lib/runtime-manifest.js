// Launcher runtime 需要同步到 ~/Library/Application Support 的完整文件清单。
// 安装器与一致性检查脚本都必须从这里读取，禁止各自维护副本。
const RUNTIME_FILES = [
  "start-demo.js",
  "restart-demo.js",
  "hotspot-server.js",
  "comment-server.js",
  "ocr-server.js",
  "llm-server.js",
  "archive-server.js",
  "xiaohongshu-bridge.js",
  "ocr.swift",
  "lib/env-file.js",
  "lib/hotspot-ranking.js",
  "lib/platform-provider.js",
  "lib/service-supervisor.js",
  "lib/launcher-runtime.js",
  "lib/safe-request-url.js",
  "lib/http-guards.js"
];

module.exports = { RUNTIME_FILES };

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "GameOpsLauncher.app";
const BUNDLE_ID = "local.gameops.launcher";
const RUNTIME_FILES = [
  "start-demo.js",
  "restart-demo.js",
  "hotspot-server.js",
  "comment-server.js",
  "ocr-server.js",
  "llm-server.js",
  "ocr.swift"
];

function fail(message) {
  console.error(`安装失败：${message}`);
  process.exit(1);
}

function readProjectArgument(args) {
  if (args.length === 0) return path.resolve(__dirname, "..");
  if (args.length === 2 && args[0] === "--project" && args[1]) {
    return path.resolve(args[1]);
  }
  fail("用法：npm run launcher:install -- [--project /项目路径]");
}

function escapeAppleScript(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

if (process.platform !== "darwin") fail("此安装器仅支持 macOS");

const projectPath = readProjectArgument(process.argv.slice(2));
for (const fileName of RUNTIME_FILES) {
  if (!fs.statSync(path.join(projectPath, fileName), { throwIfNoEntry: false })?.isFile()) {
    fail(`项目目录缺少 ${fileName}：${projectPath}`);
  }
}

const templatePath = path.join(__dirname, "..", "macos-launcher", "Launcher.applescript");
const applicationsPath = path.join(os.homedir(), "Applications");
const appPath = path.join(applicationsPath, APP_NAME);
const stagingPath = path.join(applicationsPath, `GameOpsLauncher.installing-${process.pid}.app`);
const supportPath = path.join(os.homedir(), "Library", "Application Support", "GameOpsLauncher");
const runtimePath = path.join(supportPath, "runtime");
const runtimeStagingPath = path.join(supportPath, `runtime.installing-${process.pid}`);
const sourcePath = path.join(os.tmpdir(), `gameops-launcher-${process.pid}.applescript`);
const source = fs
  .readFileSync(templatePath, "utf8")
  .replace("@@NODE_PATH@@", escapeAppleScript(process.execPath))
  .replace("@@PROJECT_PATH@@", escapeAppleScript(runtimePath))
  .replace(
    "@@LOG_DIRECTORY@@",
    escapeAppleScript(path.join(os.homedir(), "Library", "Logs", "GameOpsLauncher"))
  );

fs.mkdirSync(applicationsPath, { recursive: true });
fs.mkdirSync(supportPath, { recursive: true });
fs.rmSync(stagingPath, { recursive: true, force: true });
fs.rmSync(runtimeStagingPath, { recursive: true, force: true });
fs.mkdirSync(runtimeStagingPath, { recursive: true });
for (const fileName of RUNTIME_FILES) {
  fs.copyFileSync(path.join(projectPath, fileName), path.join(runtimeStagingPath, fileName));
}
fs.writeFileSync(sourcePath, source, { mode: 0o600 });

try {
  execFileSync("/usr/bin/osacompile", ["-o", stagingPath, sourcePath], { stdio: "pipe" });
  if (!fs.statSync(path.join(stagingPath, "Contents"), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("macOS 未生成有效的 .app 应用包");
  }

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>GameOps Launcher</string>
  <key>CFBundleExecutable</key><string>applet</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>GameOpsLauncher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSBackgroundOnly</key><true/>
  <key>NSAppleScriptEnabled</key><true/>
  <key>CFBundleURLTypes</key>
  <array><dict>
    <key>CFBundleURLName</key><string>${BUNDLE_ID}</string>
    <key>CFBundleURLSchemes</key><array><string>gameops</string></array>
  </dict></array>
</dict>
</plist>
`;
  const contentsPath = path.join(stagingPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  fs.writeFileSync(path.join(contentsPath, "Info.plist"), infoPlist);
  fs.writeFileSync(
    path.join(resourcesPath, "config.json"),
    `${JSON.stringify({ projectPath, runtimePath, nodePath: process.execPath }, null, 2)}\n`
  );

  execFileSync("/usr/bin/plutil", ["-lint", path.join(contentsPath, "Info.plist")], {
    stdio: "pipe"
  });
  fs.rmSync(runtimePath, { recursive: true, force: true });
  fs.renameSync(runtimeStagingPath, runtimePath);
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.renameSync(stagingPath, appPath);
  if (process.env.GAMEOPS_LAUNCHER_SKIP_REGISTER !== "1") {
    execFileSync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appPath],
      { stdio: "pipe" }
    );
  }
} catch (error) {
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.rmSync(runtimeStagingPath, { recursive: true, force: true });
  fail(error.stderr?.toString().trim() || error.message);
} finally {
  fs.rmSync(sourcePath, { force: true });
}

console.log(`已安装：${appPath}`);
console.log(`项目目录：${projectPath}`);
console.log(`运行目录：${runtimePath}`);
console.log("可用地址：gameops://start、gameops://restart");

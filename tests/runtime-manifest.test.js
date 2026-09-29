const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const { RUNTIME_FILES } = require("../lib/runtime-manifest");
const { checkLauncherRuntime } = require("../lib/launcher-runtime-check");

const installerSource = fs.readFileSync(path.join(projectRoot, "scripts", "install-macos-launcher.js"), "utf8");
const checkerSource = fs.readFileSync(path.join(projectRoot, "scripts", "check-launcher-runtime.js"), "utf8");

test("installer and launcher checker consume the shared runtime manifest", () => {
  assert.match(installerSource, /require\("..\/lib\/runtime-manifest"\)/, "installer 必须引用共享清单");
  assert.match(checkerSource, /require\("..\/lib\/launcher-runtime-check"\)/, "checker 必须调用共享检查逻辑");
  assert.match(fs.readFileSync(path.join(projectRoot, "lib", "launcher-runtime-check.js"), "utf8"), /require\("\.\/runtime-manifest"\)/, "检查逻辑必须引用共享清单");
  assert.doesNotMatch(installerSource, /const RUNTIME_FILES = \[/, "安装器不得内联清单副本");
  assert.doesNotMatch(checkerSource, /const files = \[/, "检查脚本不得内联清单副本");
});

test("installer signs and verifies the completed app bundle before replacing the installed app", () => {
  const plistMutation = installerSource.indexOf("const plistCommands = [");
  const configWrite = installerSource.indexOf('path.join(resourcesPath, "config.json")');
  const sign = installerSource.indexOf('execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", stagingPath]');
  const verify = installerSource.indexOf('execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagingPath]');
  const replace = installerSource.indexOf("replaceDirectoriesWithRollback([");

  assert.ok(plistMutation >= 0 && configWrite > plistMutation, "产品 plist keys 与 runtime 配置必须先写入 app bundle");
  assert.ok(sign > configWrite, "完成 bundle 修改后必须重新签名");
  assert.ok(verify > sign && replace > verify, "必须在替换用户安装前验证签名");
});

test("installer preserves osacompile metadata while adding the gameops URL scheme", () => {
  assert.match(installerSource, /\/usr\/libexec\/PlistBuddy/);
  assert.match(installerSource, /CFBundleURLTypes/);
  assert.match(installerSource, /CFBundleURLSchemes/);
  assert.doesNotMatch(
    installerSource,
    /fs\.writeFileSync\(path\.join\(contentsPath, "Info\.plist"\)/,
    "不得用精简 plist 覆盖 osacompile 生成的 AppleScript applet 元数据"
  );
});

test("README explains how to restart a controller running from the Launcher snapshot", () => {
  const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
  assert.match(readme, /Application Support\/GameOpsLauncher\/runtime/);
  assert.match(readme, /gameops:\/\/restart/);
  assert.match(readme, /拒绝操作.*第二个控制器/);
});

test("runtime manifest covers every local require of runtime entrypoints", () => {
  const visited = new Set();

  function collect(fileName) {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    assert.ok(RUNTIME_FILES.includes(fileName), "runtime manifest 缺少 " + fileName);
    const source = fs.readFileSync(path.join(projectRoot, fileName), "utf8");
    for (const match of source.matchAll(/require\("(\.\/[^"]+)"\)/g)) {
      const withExtension = match[1].endsWith(".js") ? match[1] : match[1] + ".js";
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), withExtension));
      if (resolved.startsWith("lib/") && !visited.has(resolved)) collect(resolved);
    }
  }

  collect("start-demo.js");
  collect("restart-demo.js");
  assert.ok(RUNTIME_FILES.includes("lib/business-date.js"), "runtime manifest 缺少 archive-server 的业务时间依赖");
});

test("runtime manifest files all exist in the project", () => {
  for (const fileName of RUNTIME_FILES) {
    assert.ok(fs.statSync(path.join(projectRoot, fileName), { throwIfNoEntry: false })?.isFile(), fileName + " 不存在");
  }
});

test("runtime manifest includes the automatic archive backup dependency chain", () => {
  for (const fileName of ["lib/archive-backup.js", "lib/archive-backup-scheduler.js", "scripts/backup-archive.js"]) {
    assert.ok(RUNTIME_FILES.includes(fileName), "runtime manifest 缺少自动备份依赖 " + fileName);
  }
});

test("launcher check fails when a manifest source is missing even if runtime still has a copy", (t) => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gameops-launcher-source-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "source");
  const runtime = path.join(dir, "runtime");
  fs.mkdirSync(root);
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, "entry.js"), "runtime copy");

  const result = checkLauncherRuntime({ root, runtime, files: ["entry.js"] });
  assert.equal(result.inSync, false);
  assert.deepEqual(result.missingSource, ["entry.js"]);
});

test("launcher check detects when the installed app Node path has been removed", (t) => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gameops-launcher-node-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "source");
  const runtime = path.join(dir, "runtime");
  const appPath = path.join(dir, "GameOpsLauncher.app");
  const configPath = path.join(appPath, "Contents", "Resources", "config.json");
  fs.mkdirSync(root);
  fs.mkdirSync(runtime);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(path.join(root, "entry.js"), "same bytes");
  fs.writeFileSync(path.join(runtime, "entry.js"), "same bytes");
  fs.writeFileSync(configPath, JSON.stringify({ nodePath: path.join(dir, "removed-node") }));

  const result = checkLauncherRuntime({ root, runtime, appPath, files: ["entry.js"] });
  assert.equal(result.inSync, false);
  assert.match(result.nodeIssue, /Node 可执行文件不存在/);

  fs.writeFileSync(configPath, JSON.stringify({ nodePath: process.execPath }));
  assert.equal(checkLauncherRuntime({ root, runtime, appPath, files: ["entry.js"] }).inSync, true);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const { RUNTIME_FILES } = require("../lib/runtime-manifest");

const installerSource = fs.readFileSync(path.join(projectRoot, "scripts", "install-macos-launcher.js"), "utf8");
const checkerSource = fs.readFileSync(path.join(projectRoot, "scripts", "check-launcher-runtime.js"), "utf8");

test("installer and checker consume the shared runtime manifest", () => {
  for (const [label, source] of [["installer", installerSource], ["checker", checkerSource]]) {
    assert.match(source, /require\("..\/lib\/runtime-manifest"\)/, label + " 必须引用共享清单");
  }
  assert.doesNotMatch(installerSource, /const RUNTIME_FILES = \[/, "安装器不得内联清单副本");
  assert.doesNotMatch(checkerSource, /const files = \[/, "检查脚本不得内联清单副本");
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
});

test("runtime manifest files all exist in the project", () => {
  for (const fileName of RUNTIME_FILES) {
    assert.ok(fs.statSync(path.join(projectRoot, fileName), { throwIfNoEntry: false })?.isFile(), fileName + " 不存在");
  }
});

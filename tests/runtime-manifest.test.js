const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const installerSource = fs.readFileSync(path.join(projectRoot, "scripts", "install-macos-launcher.js"), "utf8");
const manifestMatch = installerSource.match(/const RUNTIME_FILES = \[([\s\S]*?)\];/);
assert.ok(manifestMatch, "installer must declare RUNTIME_FILES");
const runtimeFiles = [...manifestMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

test("runtime manifest covers every local require of runtime entrypoints", () => {
  const entrypoints = ["start-demo.js", "restart-demo.js", ...runtimeFiles.filter((file) => file.endsWith("-server.js") || file === "xiaohongshu-bridge.js")];
  const missing = new Set();
  const visited = new Set();

  function collect(fileName) {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    assert.ok(runtimeFiles.includes(fileName), `runtime manifest 缺少 ${fileName}`);
    const source = fs.readFileSync(path.join(projectRoot, fileName), "utf8");
    for (const match of source.matchAll(/require\(\"(\.\/[^\"]+)\"\)/g)) {
      const withExtension = match[1].endsWith(".js") ? match[1] : match[1] + ".js";
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), withExtension));
      if (resolved.startsWith("lib/") && !missing.has(resolved)) collect(resolved);
    }
  }

  for (const entry of ["start-demo.js", "restart-demo.js"]) collect(entry);
  assert.equal(missing.size, 0);
});

test("runtime manifest files all exist in the project", () => {
  for (const fileName of runtimeFiles) {
    assert.ok(fs.statSync(path.join(projectPath(fileName)), { throwIfNoEntry: false })?.isFile(), `${fileName} 不存在`);
  }
  function projectPath(fileName) { return path.join(projectRoot, fileName); }
});

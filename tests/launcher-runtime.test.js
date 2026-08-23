const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { preserveRuntimeEnv, replaceDirectoryWithRollback } = require("../lib/launcher-runtime");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gameops-launcher-test-"));
}

test("installer preserves the previous runtime env when the project has none", () => {
  const root = temporaryDirectory();
  const oldRuntime = path.join(root, "old");
  const staging = path.join(root, "staging");
  fs.mkdirSync(oldRuntime);
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(oldRuntime, ".env"), "LLM_API_KEY=kept\n");

  preserveRuntimeEnv("", oldRuntime, staging);

  assert.equal(fs.readFileSync(path.join(staging, ".env"), "utf8"), "LLM_API_KEY=kept\n");
  assert.equal(fs.statSync(path.join(staging, ".env")).mode & 0o777, 0o600);
});

test("failed runtime replacement restores the previous directory", () => {
  const root = temporaryDirectory();
  const current = path.join(root, "runtime");
  const staging = path.join(root, "staging");
  fs.mkdirSync(current);
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(current, "old.txt"), "old");
  fs.writeFileSync(path.join(staging, "new.txt"), "new");

  assert.throws(() => replaceDirectoryWithRollback(current, staging, {
    afterBackup() { throw new Error("simulated failure"); }
  }), /simulated failure/);

  assert.equal(fs.readFileSync(path.join(current, "old.txt"), "utf8"), "old");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { preserveRuntimeEnv, replaceDirectoryWithRollback, replaceDirectoriesWithRollback, retryRegistration } = require("../lib/launcher-runtime");

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

test("installer keeps the installed runtime env when both project and runtime env files exist", () => {
  const root = temporaryDirectory();
  const project = path.join(root, "project.env");
  const oldRuntime = path.join(root, "old");
  const staging = path.join(root, "staging");
  fs.mkdirSync(oldRuntime);
  fs.mkdirSync(staging);
  fs.writeFileSync(project, "LLM_API_KEY=project-value\n");
  fs.writeFileSync(path.join(oldRuntime, ".env"), "LLM_API_KEY=installed-value\n");

  preserveRuntimeEnv(project, oldRuntime, staging);

  assert.equal(fs.readFileSync(path.join(staging, ".env"), "utf8"), "LLM_API_KEY=installed-value\n");
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

test("failed launcher registration restores both the runtime and app", () => {
  const root = temporaryDirectory();
  const targets = ["runtime", "GameOpsLauncher.app"].map((name) => {
    const targetPath = path.join(root, name);
    const stagingPath = path.join(root, `staging-${name}`);
    fs.mkdirSync(targetPath);
    fs.mkdirSync(stagingPath);
    fs.writeFileSync(path.join(targetPath, "version.txt"), "old");
    fs.writeFileSync(path.join(stagingPath, "version.txt"), "new");
    return { targetPath, stagingPath };
  });

  assert.throws(() => replaceDirectoriesWithRollback(targets, () => {
    throw new Error("registration failed");
  }), /registration failed/);

  for (const { targetPath } of targets) {
    assert.equal(fs.readFileSync(path.join(targetPath, "version.txt"), "utf8"), "old");
  }
});

test("successful launcher registration updates both the runtime and app", () => {
  const root = temporaryDirectory();
  const targets = ["runtime", "GameOpsLauncher.app"].map((name) => {
    const targetPath = path.join(root, name);
    const stagingPath = path.join(root, `staging-${name}`);
    fs.mkdirSync(targetPath);
    fs.mkdirSync(stagingPath);
    fs.writeFileSync(path.join(targetPath, "version.txt"), "old");
    fs.writeFileSync(path.join(stagingPath, "version.txt"), "new");
    return { targetPath, stagingPath };
  });

  replaceDirectoriesWithRollback(targets, () => {});

  for (const { targetPath } of targets) {
    assert.equal(fs.readFileSync(path.join(targetPath, "version.txt"), "utf8"), "new");
  }
});

test("launcher registration retries a temporary scan failure and stops after the limit", () => {
  let attempts = 0;
  let pauses = 0;
  retryRegistration(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("spotlight not ready");
  }, () => { pauses += 1; });
  assert.equal(attempts, 2);
  assert.equal(pauses, 1);

  attempts = 0;
  pauses = 0;
  assert.throws(() => retryRegistration(() => {
    attempts += 1;
    throw new Error("spotlight still unavailable");
  }, () => { pauses += 1; }), /spotlight still unavailable/);
  assert.equal(attempts, 3);
  assert.equal(pauses, 2);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getControllerInstanceId,
  getControllerStatePaths,
  isProjectControllerCommand,
  isOwnedControllerState,
  ensureControllerStateDirectory,
  readControllerState,
  writeControllerState
} = require("../lib/controller-instance");

test("local controller state paths are stable but isolated by project root", () => {
  const firstRoot = path.resolve("/tmp/gameops-main");
  const secondRoot = path.resolve("/tmp/gameops-worktree");
  const first = getControllerStatePaths(firstRoot, "test-user");
  const firstAgain = getControllerStatePaths(path.join(firstRoot, ".", ""), "test-user");
  const second = getControllerStatePaths(secondRoot, "test-user");

  assert.deepEqual(firstAgain, first);
  assert.notEqual(getControllerInstanceId(firstRoot), getControllerInstanceId(secondRoot));
  assert.notEqual(first.current, second.current);
  assert.equal(first.legacy, second.legacy);
});

test("restart process matching rejects another project's start-demo script", () => {
  const firstRoot = path.resolve("/tmp/gameops-main");
  const secondRoot = path.resolve("/tmp/gameops-worktree");
  const ownCommand = process.execPath + " " + path.join(firstRoot, "start-demo.js");
  const otherCommand = process.execPath + " " + path.join(secondRoot, "start-demo.js");
  const misleadingCommand = otherCommand + " " + path.join(firstRoot, "start-demo.js");

  assert.equal(isProjectControllerCommand(ownCommand, firstRoot), true);
  assert.equal(isProjectControllerCommand(otherCommand, firstRoot), false);
  assert.equal(isProjectControllerCommand(misleadingCommand, firstRoot), false);
  assert.equal(isProjectControllerCommand(process.execPath + " start-demo.js", firstRoot), false);
  assert.equal(isProjectControllerCommand(process.execPath + " start-demo.js", firstRoot, { allowRelativeScript: true }), true);
});

test("restart cleanup only removes the state written by the controller it stopped", () => {
  const projectRoot = path.resolve("/tmp/gameops-main");
  const instanceId = getControllerInstanceId(projectRoot);
  const previous = { pid: 101, project: projectRoot, instanceId };
  const replacement = { pid: 202, project: projectRoot, instanceId };

  assert.equal(isOwnedControllerState(previous, projectRoot, { expectedPid: 101 }), true);
  assert.equal(isOwnedControllerState(replacement, projectRoot, { expectedPid: 101 }), false);
  assert.equal(isOwnedControllerState(replacement, projectRoot), true);
  assert.equal(isOwnedControllerState(replacement, path.resolve("/tmp/gameops-worktree")), false);
  assert.equal(isOwnedControllerState({ ...replacement, instanceId: "foreign" }, projectRoot), false);
  assert.equal(isOwnedControllerState({ ...replacement, instanceId: "" }, projectRoot, { allowLegacy: true }), false);
  assert.equal(isOwnedControllerState({ pid: 202, project: projectRoot }, projectRoot, { allowLegacy: true }), true);
});

test("controller state storage rejects a pre-created symlink directory", (t) => {
  const projectRoot = path.resolve("/tmp/gameops-symlink-test");
  const userId = `symlink-${process.pid}-${Date.now()}`;
  const paths = getControllerStatePaths(projectRoot, userId);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-state-target-"));
  const originalMode = fs.statSync(target).mode & 0o777;
  t.after(() => {
    fs.rmSync(paths.directory, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });
  fs.symlinkSync(target, paths.directory);

  assert.throws(() => ensureControllerStateDirectory(projectRoot, userId), /符号链接|安全|目录/);
  assert.equal(fs.statSync(target).mode & 0o777, originalMode);
  assert.equal(fs.existsSync(paths.current), false);
});

test("controller state reads and writes reject symlinks and oversized files", (t) => {
  const projectRoot = path.resolve("/tmp/gameops-state-file-test");
  const userId = `file-${process.pid}-${Date.now()}`;
  const paths = ensureControllerStateDirectory(projectRoot, userId);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-state-file-target-"));
  const target = path.join(scratch, "untouched.txt");
  fs.writeFileSync(target, "leave this file alone");
  t.after(() => {
    fs.rmSync(paths.directory, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  assert.equal(fs.statSync(paths.directory).mode & 0o777, 0o700);
  fs.symlinkSync(target, paths.current);
  assert.throws(() => writeControllerState(paths.current, { pid: 42 }), /ELOOP|符号链接|不安全/);
  assert.throws(() => readControllerState(paths.current), /ELOOP|符号链接|不安全/);
  assert.equal(fs.readFileSync(target, "utf8"), "leave this file alone");

  fs.unlinkSync(paths.current);
  fs.writeFileSync(paths.current, "x".repeat(8192), { mode: 0o600 });
  assert.throws(() => readControllerState(paths.current), /过大|无效/);
});

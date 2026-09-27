const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  getControllerInstanceId,
  getControllerStatePaths,
  isProjectControllerCommand
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

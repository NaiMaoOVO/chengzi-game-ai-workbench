const test = require("node:test");
const assert = require("node:assert/strict");

const { getChildProcessExitCode, getRestartDelay } = require("../lib/service-supervisor");

test("service restart backoff is bounded", () => {
  assert.equal(getRestartDelay(1), 500);
  assert.equal(getRestartDelay(2), 1000);
  assert.equal(getRestartDelay(10), 10000);
});

test("restart helper reports signal-terminated child processes as failures", () => {
  assert.equal(getChildProcessExitCode(0, null), 0);
  assert.equal(getChildProcessExitCode(3, null), 3);
  assert.equal(getChildProcessExitCode(null, "SIGTERM"), 1);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { getRestartDelay } = require("../lib/service-supervisor");

test("service restart backoff is bounded", () => {
  assert.equal(getRestartDelay(1), 500);
  assert.equal(getRestartDelay(2), 1000);
  assert.equal(getRestartDelay(10), 10000);
});

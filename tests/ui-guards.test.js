const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationGuard } = require("../lib/ui-guards");
const { readStorageArray } = require("../lib/safe-storage");

test("generation guard invalidates older async responses", () => {
  const guard = createGenerationGuard();
  const first = guard.next();
  const second = guard.next();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test("safe storage returns an empty array when getItem throws", () => {
  const storage = { getItem() { throw new Error("storage disabled"); } };
  assert.deepEqual(readStorageArray(storage, "slots"), []);
});

test("safe storage returns only a valid array", () => {
  const storage = { getItem() { return JSON.stringify({ broken: true }); } };
  assert.deepEqual(readStorageArray(storage, "slots"), []);
});

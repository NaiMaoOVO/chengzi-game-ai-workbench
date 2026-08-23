const test = require("node:test");
const assert = require("node:assert/strict");

const { readProjectSlots, getOccupiedSlotIndexes, sanitizeProjectSlots } = require("../lib/project-slots");

test("saved slots remain discoverable after a page reload", () => {
  const slots = readProjectSlots(JSON.stringify([
    { controls: { "trending-game": "鸣潮" } },
    null,
    { controls: { "version-game": "原神" } }
  ]));

  assert.deepEqual(getOccupiedSlotIndexes(slots), [1, 3]);
});

test("corrupted slot storage falls back to an empty list", () => {
  assert.deepEqual(readProjectSlots("{broken"), []);
});

test("invalid saved project objects are treated as empty slots", () => {
  assert.deepEqual(sanitizeProjectSlots([{ broken: true }, { controls: {} }]), [null, { controls: {} }]);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { readProjectSlots, inspectProjectSlots, getOccupiedSlotIndexes, sanitizeProjectSlots, sanitizeProjectState, shouldPersistProjectControl } = require("../lib/project-slots");

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

test("slot inspection distinguishes empty storage from malformed or partially corrupt data", () => {
  assert.deepEqual(inspectProjectSlots(null), { slots: [], issue: "" });
  assert.deepEqual(inspectProjectSlots(JSON.stringify([null, { controls: { "trending-game": "鸣潮" } }])), {
    slots: [null, { controls: { "trending-game": "鸣潮" } }],
    issue: ""
  });
  assert.equal(inspectProjectSlots("{broken").issue, "invalid-json");
  assert.equal(inspectProjectSlots(JSON.stringify({ controls: {} })).issue, "invalid-shape");
  const damaged = inspectProjectSlots(JSON.stringify([{ broken: true }, { controls: { "version-game": "原神" } }]));
  assert.equal(damaged.issue, "invalid-shape");
  assert.deepEqual(damaged.slots, [null, { controls: { "version-game": "原神" } }]);
});

test("invalid saved project objects are treated as empty slots", () => {
  assert.deepEqual(sanitizeProjectSlots([{ broken: true }, { controls: {} }]), [null, { controls: {} }]);
});

test("project snapshots exclude archive credentials and preserve project controls", () => {
  const state = sanitizeProjectState({
    controls: {
      "trending-game": "鸣潮",
      "archive-login-username": "admin",
      "archive-login-password": "secret"
    }
  });

  assert.deepEqual(state.controls, { "trending-game": "鸣潮" });
  assert.equal(shouldPersistProjectControl({ id: "trending-game", type: "text" }), true);
  assert.equal(shouldPersistProjectControl({ id: "archive-login-username", type: "text" }), false);
  assert.equal(shouldPersistProjectControl({ id: "another-password", type: "password" }), false);
});

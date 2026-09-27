const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { inspectProjectSlots } = require("../lib/project-slots");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const storageStart = app.indexOf("let projectSlotStorageIssue = \"\";");
const storageEnd = app.indexOf("function renderOverviewConclusion", storageStart);
const saveStart = app.indexOf("function saveProjectToSlot", storageEnd);
const saveEnd = app.indexOf("function loadProjectFromSlot", saveStart);
assert.ok(storageStart >= 0 && storageEnd > storageStart && saveStart > storageEnd && saveEnd > saveStart);
const storageSource = app.slice(storageStart, storageEnd);
const saveSource = app.slice(saveStart, saveEnd);

function createHarness(initial, confirmResult, changedDuringConfirm = null) {
  let raw = initial;
  let writes = 0;
  let confirmations = 0;
  const status = { textContent: "", className: "", classList: { add: () => {} } };
  const context = {
    PROJECT_STORAGE_KEY: "project-state",
    inspectProjectSlots,
    window: {
      localStorage: {
        getItem: () => raw,
        setItem: (_key, value) => { writes += 1; raw = value; }
      },
      confirm: () => {
        confirmations += 1;
        if (changedDuringConfirm !== null) raw = changedDuringConfirm;
        return confirmResult;
      }
    },
    document: { querySelector: () => status },
    collectProjectState: () => ({ controls: { "trending-game": "新项目" } }),
    updateSlotName: () => {}
  };
  const save = vm.runInNewContext(`(() => {
    const PROJECT_SLOTS_KEY = "gameops-project-slots-v2";
    ${storageSource}
    ${saveSource}
    return saveProjectToSlot;
  })()`, context);
  return { save, status, raw: () => raw, writes: () => writes, confirmations: () => confirmations };
}

test("saving over an occupied project slot requires confirmation", () => {
  const original = JSON.stringify([{ controls: { "trending-game": "旧项目" } }]);
  const harness = createHarness(original, false);
  harness.save(1);
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), original);
  assert.match(harness.status.textContent, /已取消.*覆盖/);
});

test("confirmed project slot overwrite saves the current project", () => {
  const original = JSON.stringify([{ controls: { "trending-game": "旧项目" } }]);
  const harness = createHarness(original, true);
  harness.save(1);
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 1);
  assert.deepEqual(JSON.parse(harness.raw()), [{ controls: { "trending-game": "新项目" } }]);
});

test("project slot overwrite preserves a snapshot changed during confirmation", () => {
  const original = JSON.stringify([{ controls: { "trending-game": "旧项目" } }]);
  const newer = JSON.stringify([{ controls: { "trending-game": "另一标签页的新项目" } }]);
  const harness = createHarness(original, true, newer);
  harness.save(1);
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = app.indexOf("function loadProjectState() {");
const end = app.indexOf("\nfunction getViewElements", start);
assert.ok(start >= 0 && end > start, "loadProjectState should exist in app.js");
const source = app.slice(start, end);
const saveStart = app.indexOf("function saveProjectState() {");
const saveEnd = app.indexOf("\nfunction loadProjectState", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "saveProjectState should exist in app.js");
const saveSource = app.slice(saveStart, saveEnd);

function createHarness(getItem) {
  const status = { textContent: "", className: "" };
  const restored = [];
  const context = {
    PROJECT_STORAGE_KEY: "project-state",
    localStorage: { getItem },
    document: { querySelector: () => status },
    restoreProjectState: (value) => restored.push(value)
  };
  const load = vm.runInNewContext(`(() => { ${source}; return loadProjectState; })()`, context);
  return { load, status, restored };
}

function createSaveHarness(initial, confirmResult = false, readError = false) {
  let raw = initial;
  let writes = 0;
  let confirmations = 0;
  const status = { textContent: "", className: "" };
  const context = {
    PROJECT_STORAGE_KEY: "project-state",
    window: {
      localStorage: {
        getItem: () => { if (readError) throw new Error("storage read denied"); return raw; },
        setItem: (_key, value) => { writes += 1; raw = value; }
      },
      confirm: () => { confirmations += 1; return confirmResult; }
    },
    document: { querySelector: () => status },
    collectProjectState: () => ({ controls: { game: "鸣潮" } })
  };
  const save = vm.runInNewContext(`(() => { ${saveSource}; return saveProjectState; })()`, context);
  return { save, status, raw: () => raw, writes: () => writes, confirmations: () => confirmations };
}

test("missing project state is described as not yet saved", () => {
  const harness = createHarness(() => null);
  harness.load();
  assert.match(harness.status.textContent, /尚无本机保存的项目/);
  assert.equal(harness.restored.length, 0);
});

test("corrupted project JSON gets a safe recovery message and remains untouched", () => {
  const raw = "{broken-json";
  const harness = createHarness(() => raw);
  harness.load();
  assert.match(harness.status.textContent, /快照格式损坏/);
  assert.match(harness.status.textContent, /原始数据未修改/);
  assert.doesNotMatch(harness.status.textContent, /JSON|Unexpected|position/);
  assert.equal(harness.restored.length, 0);
});

test("unavailable local storage gets a browser recovery hint", () => {
  const harness = createHarness(() => { throw new Error("storage denied"); });
  harness.load();
  assert.match(harness.status.textContent, /本机浏览器存储不可用/);
  assert.doesNotMatch(harness.status.textContent, /storage denied/);
  assert.equal(harness.restored.length, 0);
});

test("valid project state restores and reports success", () => {
  const state = { controls: { game: "鸣潮" } };
  const harness = createHarness(() => JSON.stringify(state));
  harness.load();
  assert.equal(harness.restored.length, 1);
  assert.equal(harness.restored[0].controls.game, "鸣潮");
  assert.match(harness.status.textContent, /已载入上次保存的项目内容/);
});

test("saving does not silently overwrite a corrupted project snapshot when confirmation is cancelled", () => {
  const raw = "{broken-json";
  const harness = createSaveHarness(raw, false);
  harness.save();
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), raw);
  assert.match(harness.status.textContent, /已取消覆盖/);
});

test("saving can explicitly replace a corrupted project snapshot after confirmation", () => {
  const harness = createSaveHarness("[]", true);
  harness.save();
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 1);
  assert.deepEqual(JSON.parse(harness.raw()), { controls: { game: "鸣潮" } });
  assert.match(harness.status.textContent, /已保存到本机浏览器/);
});

test("saving over a readable project snapshot does not ask for an extra confirmation", () => {
  const harness = createSaveHarness(JSON.stringify({ controls: { game: "原神" } }));
  harness.save();
  assert.equal(harness.confirmations(), 0);
  assert.equal(harness.writes(), 1);
  assert.deepEqual(JSON.parse(harness.raw()), { controls: { game: "鸣潮" } });
});

test("saving does not write when the existing project snapshot cannot be inspected", () => {
  const raw = "preserve-this-snapshot";
  const harness = createSaveHarness(raw, true, true);
  harness.save();
  assert.equal(harness.confirmations(), 0);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), raw);
  assert.match(harness.status.textContent, /保存失败/);
});

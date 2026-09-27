const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const shapeStart = app.indexOf("function isProjectStateRestorable(state) {");
const shapeEnd = app.indexOf("\nlet projectStateStorageBaseline", shapeStart);
assert.ok(shapeStart >= 0 && shapeEnd > shapeStart, "project state shape guard should exist in app.js");
const shapeSource = app.slice(shapeStart, shapeEnd);
const start = app.indexOf("function loadProjectState() {");
const end = app.indexOf("\nfunction getViewElements", start);
assert.ok(start >= 0 && end > start, "loadProjectState should exist in app.js");
const source = app.slice(start, end);
const saveStart = app.indexOf("function saveProjectState() {");
const saveEnd = app.indexOf("\nfunction loadProjectState", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "saveProjectState should exist in app.js");
const snapshotStorageStart = app.indexOf("let projectStateStorageBaseline = null;");
assert.ok(snapshotStorageStart >= 0 && snapshotStorageStart < saveStart, "snapshot version tracking should be defined before saveProjectState");
const saveSource = app.slice(snapshotStorageStart, saveEnd);
const loadSource = app.slice(start, end);

function createHarness(getItem) {
  const status = { textContent: "", className: "" };
  const restored = [];
  const context = {
    PROJECT_STORAGE_KEY: "project-state",
    localStorage: { getItem },
    document: { querySelector: () => status },
    restoreProjectState: (value) => restored.push(value)
  };
  const load = vm.runInNewContext(`(() => { ${shapeSource}; ${saveSource}; ${source}; return loadProjectState; })()`, context);
  return { load, status, restored };
}

function createSaveHarness(initial, confirmResult = false, readError = false, mutateOnConfirm = null) {
  let raw = initial;
  let storageReadFails = readError;
  let currentState = { controls: { game: "鸣潮" } };
  let writes = 0;
  let confirmations = 0;
  let onCollect = null;
  const status = { textContent: "", className: "" };
  const storage = {
    getItem: () => { if (storageReadFails) throw new Error("storage read denied"); return raw; },
    setItem: (_key, value) => { writes += 1; raw = value; }
  };
  const context = {
    PROJECT_STORAGE_KEY: "project-state",
    localStorage: storage,
    window: {
      localStorage: storage,
      confirm: () => { confirmations += 1; if (mutateOnConfirm !== null) raw = mutateOnConfirm; return confirmResult; }
    },
    document: { querySelector: () => status },
    collectProjectState: () => { onCollect?.(); return currentState; },
    restoreProjectState: (state) => { currentState = state; }
  };
  const actions = vm.runInNewContext(`(() => { ${shapeSource}; ${saveSource}; ${loadSource}; captureProjectStateStorageBaseline(); return { save: saveProjectState, load: loadProjectState }; })()`, context);
  return {
    save: actions.save,
    load: actions.load,
    setExternally: (value) => { raw = value; },
    recoverStorage: () => { storageReadFails = false; },
    onCollect: (callback) => { onCollect = callback; },
    status,
    raw: () => raw,
    writes: () => writes,
    confirmations: () => confirmations
  };
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

test("saving an old loaded project does not overwrite a newer snapshot from another tab", () => {
  const original = JSON.stringify({ controls: { game: "旧项目" } });
  const newer = JSON.stringify({ controls: { game: "另一标签页的新项目" } });
  const harness = createSaveHarness(original);
  harness.load();
  harness.setExternally(newer);
  harness.save();
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

test("loading the latest snapshot establishes a new baseline for the next save", () => {
  const original = JSON.stringify({ controls: { game: "旧项目" } });
  const newer = JSON.stringify({ controls: { game: "另一标签页的新项目" } });
  const harness = createSaveHarness(original);
  harness.setExternally(newer);
  harness.load();
  harness.save();
  assert.equal(harness.writes(), 1);
  assert.deepEqual(JSON.parse(harness.raw()), { controls: { game: "另一标签页的新项目" } });
});

test("saving rechecks storage immediately before writing to avoid a concurrent tab update", () => {
  const original = JSON.stringify({ controls: { game: "旧项目" } });
  const newer = JSON.stringify({ controls: { game: "另一标签页的新项目" } });
  const harness = createSaveHarness(original);
  harness.onCollect(() => harness.setExternally(newer));
  harness.save();
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

test("snapshot version tracking starts after startup sanitizes local data", () => {
  assert.match(app, /purgeSensitiveProjectStateStorage\(\);\s*\n\s*captureProjectStateStorageBaseline\(\);/);
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

test("saving stays blocked when the startup snapshot version could not be read", () => {
  const harness = createSaveHarness(JSON.stringify({ controls: { game: "鸣潮" } }), true, true);
  harness.recoverStorage();
  harness.save();
  assert.equal(harness.writes(), 0);
  assert.match(harness.status.textContent, /无法确认快照版本/);
  assert.match(harness.status.textContent, /导出或记录当前内容/);
});

test("saving does not overwrite a snapshot updated in another tab during confirmation", () => {
  const newer = JSON.stringify({ controls: { game: "原神" } });
  const harness = createSaveHarness("{broken-json", true, false, newer);
  harness.save();
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

test("loading a snapshot with a null creator rejects it before applying any project state", () => {
  const state = { controls: { game: "原神" }, streamers: [null] };
  const harness = createHarness(() => JSON.stringify(state));
  harness.load();
  assert.equal(harness.restored.length, 0);
  assert.match(harness.status.textContent, /结构异常/);
  assert.match(harness.status.textContent, /未应用/);
});

test("loading a snapshot with a null hotspot also rejects it before applying project state", () => {
  const state = { controls: {}, currentTrendingTopics: [null] };
  const harness = createHarness(() => JSON.stringify(state));
  harness.load();
  assert.equal(harness.restored.length, 0);
  assert.match(harness.status.textContent, /结构异常/);
  assert.match(harness.status.textContent, /未应用/);
});

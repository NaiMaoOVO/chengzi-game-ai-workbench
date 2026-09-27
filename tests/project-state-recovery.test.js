const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = app.indexOf("function loadProjectState() {");
const end = app.indexOf("\nfunction getViewElements", start);
assert.ok(start >= 0 && end > start, "loadProjectState should exist in app.js");
const source = app.slice(start, end);

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

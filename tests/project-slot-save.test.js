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
const loadEnd = app.indexOf("function updateSlotName", saveEnd);
const restoreStart = app.indexOf("function restoreProjectState(state) {");
const restoreEnd = app.indexOf("\nfunction isProjectStateRestorable", restoreStart);
assert.ok(storageStart >= 0 && storageEnd > storageStart && saveStart > storageEnd && saveEnd > saveStart && loadEnd > saveEnd);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
const storageSource = app.slice(storageStart, storageEnd);
const saveSource = app.slice(saveStart, saveEnd);
const loadSource = app.slice(saveEnd, loadEnd);
const restoreSource = app.slice(restoreStart, restoreEnd);

function createHarness(initial, confirmResult, changedDuringConfirm = null, changedDuringCollect = null) {
  let raw = initial;
  let writes = 0;
  let confirmations = 0;
  const restored = [];
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
    collectProjectState: () => {
      if (changedDuringCollect !== null) raw = changedDuringCollect;
      return { controls: { "trending-game": "新项目" } };
    },
    updateSlotName: () => {},
    isProjectStateRestorable: (state) => Boolean(state && state.controls && !Array.isArray(state.controls)
      && (state.streamers === undefined || Array.isArray(state.streamers) && state.streamers.every((item) => item && typeof item === "object" && !Array.isArray(item)))
      && (state.currentTrendingTopics === undefined || Array.isArray(state.currentTrendingTopics)
        && state.currentTrendingTopics.every((item) => item && typeof item === "object" && !Array.isArray(item)))),
    restoreProjectState: (state) => restored.push(state)
  };
  const save = vm.runInNewContext(`(() => {
    const PROJECT_SLOTS_KEY = "gameops-project-slots-v2";
    ${storageSource}
    ${saveSource}
    ${loadSource}
    return { save: saveProjectToSlot, load: loadProjectFromSlot };
  })()`, context);
  return { save: save.save, load: save.load, status, raw: () => raw, writes: () => writes, confirmations: () => confirmations, restored };
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

test("project slot overwrite preserves an update that arrives after confirmation", () => {
  const original = JSON.stringify([{ controls: { "trending-game": "旧项目" } }]);
  const newer = JSON.stringify([
    { controls: { "trending-game": "另一标签页的新项目" } },
    { controls: { "trending-game": "新建项目" } }
  ]);
  const harness = createHarness(original, true, null, newer);
  harness.save(1);
  assert.equal(harness.confirmations(), 1);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

test("saving to an empty slot preserves slots added by another tab during state collection", () => {
  const original = JSON.stringify([]);
  const newer = JSON.stringify([null, { controls: { "trending-game": "另一标签页新增" } }]);
  const harness = createHarness(original, false, null, newer);
  harness.save(1);
  assert.equal(harness.confirmations(), 0);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.raw(), newer);
  assert.match(harness.status.textContent, /其他标签页已更新/);
});

test("loading a malformed project slot rejects it before restoring any data", () => {
  const original = JSON.stringify([{ controls: { "trending-game": "旧项目" }, streamers: [null] }]);
  const harness = createHarness(original, false);
  harness.load(1);
  assert.equal(harness.restored.length, 0);
  assert.equal(harness.raw(), original);
  assert.match(harness.status.textContent, /结构异常/);
});

test("restoring project controls refreshes the daily project context and queue", () => {
  const elements = {
    "trending-game": { value: "鸣潮" },
    "version-game": { value: "鸣潮" },
    "version-theme": { value: "2.8" },
    "feedback-input": { value: "" },
    "feedback-source-status": { textContent: "", className: "" }
  };
  const refreshes = [];
  const context = {
    sanitizeProjectState: (state) => state,
    resolveCreatorInputSource: (source) => source || "unverified",
    handleTrendingSelectionChange() {},
    setReviewMode() {},
    releaseStreamerImageUrls() {},
    renderStreamerList() {},
    renderTrendingEmptyState() {},
    splitFeedbackInput: () => [],
    resolveFeedbackDataSource: () => "unverified",
    analyzeContent() {},
    analyzeFeedback() {},
    analyzeReview() {},
    generateVersionPackage() {},
    generateSegmentPlan() {},
    analyzeCreators() {},
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: (selector) => elements[selector.slice(1)] || null
    },
    window: {
      refreshDailyProjectContext: () => refreshes.push(["context", elements["trending-game"].value, elements["version-theme"].value])
    },
    refreshDailyQueueIfActive: () => refreshes.push(["queue", elements["trending-game"].value]),
    streamers: [],
    currentTrendingTopics: [],
    selectedTrendingIndex: 0,
    streamerIdCounter: 0,
    creatorInputSource: "unverified",
    currentFeedbackDataSource: "unverified",
    currentFeedbackSourceInput: ""
  };
  const restore = vm.runInNewContext(`(() => {
    ${restoreSource}
    return restoreProjectState;
  })()`, context);

  restore({ controls: { "trending-game": "绝区零", "version-game": "绝区零", "version-theme": "新版本主题" } });

  assert.deepEqual(refreshes, [
    ["context", "绝区零", "新版本主题"],
    ["queue", "绝区零"]
  ]);
});

test("project slot names refresh after cross-tab storage updates and clears", () => {
  assert.ok(/window\.addEventListener\("storage",\s*handleProjectSlotStorageChange\)/.test(app), "slot handler should subscribe to storage events");
  assert.ok(/event\.key !== PROJECT_SLOTS_KEY && event\.key !== null/.test(app), "unrelated storage changes should be ignored");
  const start = app.indexOf("function handleProjectSlotStorageChange(event) {");
  const end = app.indexOf("\n/* ---- 平台差异化策略 ---- */", start);
  assert.ok(start >= 0 && end > start);
  let refreshes = 0;
  const handler = vm.runInNewContext(`(() => {
    const PROJECT_SLOTS_KEY = "gameops-project-slots-v2";
    ${app.slice(start, end)}
    return handleProjectSlotStorageChange;
  })()`, { refreshSlotNames: () => { refreshes += 1; } });
  handler({ key: "unrelated" });
  assert.equal(refreshes, 0);
  handler({ key: "gameops-project-slots-v2" });
  handler({ key: null });
  assert.equal(refreshes, 2);
});

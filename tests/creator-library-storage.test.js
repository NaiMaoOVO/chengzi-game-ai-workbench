const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = app.indexOf("function readCreatorLibrary()");
const end = app.indexOf("function creatorSnapshot(", start);
assert.ok(start >= 0 && end > start, "creator library storage functions should exist in app.js");
const source = app.slice(start, end);
const profileValidatorStart = app.indexOf("function invalidCreatorLibraryEntries(");
const profileValidatorEnd = app.indexOf("function mergeCreatorLibraries(", profileValidatorStart);
const historyValidatorStart = app.indexOf("function invalidCreatorCollaborationEntries(");
const historyValidatorEnd = app.indexOf("function exportCreatorLibrary(", historyValidatorStart);
assert.ok(profileValidatorStart >= 0 && profileValidatorEnd > profileValidatorStart);
assert.ok(historyValidatorStart >= 0 && historyValidatorEnd > historyValidatorStart);
const validators = `${app.slice(profileValidatorStart, profileValidatorEnd)}\n${app.slice(historyValidatorStart, historyValidatorEnd)}`;

function createStorage(initialValue, options = {}) {
  let value = initialValue;
  let writes = 0;
  const localStorage = {
    getItem() {
      if (options.readError) throw new Error("storage denied");
      return value;
    },
    setItem(_key, nextValue) {
      writes += 1;
      value = nextValue;
    }
  };
  const storage = vm.runInNewContext(`(() => {
    const CREATOR_LIBRARY_STORAGE_KEY = "creator-library";
    let archiveSessionUser = null;
    let creatorLibraryStorageIssue = "";
    let creatorLibraryStorageCorrupt = false;
    let creatorLibraryStorageRawSnapshot;
    ${validators}
    ${source}
    return {
      read: readCreatorLibrary,
      write: writeCreatorLibrary,
      issue: () => creatorLibraryStorageIssue,
      corrupt: () => creatorLibraryStorageCorrupt,
      rawSnapshot: () => creatorLibraryStorageRawSnapshot,
      key: creatorLibraryStorageKey
    };
  })()`, { window: { localStorage } });
  return { storage, value: () => value, setExternally: (next) => { value = next; }, writes: () => writes };
}

test("corrupted local creator JSON is read-only and cannot be overwritten by normal saves", () => {
  for (const raw of ["{broken", "[]", "null"]) {
    const harness = createStorage(raw);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.storage.read())), {});
    assert.match(harness.storage.issue(), /个人库.*损坏/);
    assert.equal(harness.storage.write({ recovered: { name: "新档案", platform: "B站" } }), false);
    assert.equal(harness.value(), raw);
    assert.equal(harness.writes(), 0);
  }
});

test("valid creator storage remains writable and keeps existing profiles", () => {
  const initial = JSON.stringify({ old: { name: "旧档案", platform: "B站" } });
  const harness = createStorage(initial);
  assert.equal(harness.storage.write({ old: { name: "旧档案", platform: "B站" }, next: { name: "新档案", platform: "小红书" } }), true);
  assert.equal(JSON.parse(harness.value()).next.name, "新档案");
  assert.equal(harness.writes(), 1);
});

test("valid JSON with damaged creator profiles or collaboration history is read-only", () => {
  const damagedLibraries = [
    JSON.stringify({ broken: { name: "", platform: "B站" } }),
    JSON.stringify({ broken: { name: "达人", platform: "B站", collaborations: [{ project: "鸣潮" }, null] } })
  ];
  for (const raw of damagedLibraries) {
    const harness = createStorage(raw);
    harness.storage.read();
    assert.match(harness.storage.issue(), /个人库.*损坏/);
    assert.equal(harness.storage.write({ safe: { name: "新档案", platform: "小红书" } }), false);
    assert.equal(harness.value(), raw);
    assert.equal(harness.writes(), 0);
  }
});

test("writer rejects malformed replacement data even when explicit recovery is allowed", () => {
  const harness = createStorage("{broken");
  harness.storage.read();
  assert.equal(harness.storage.write({ broken: { name: "", platform: "B站" } }, {
    replaceCorrupt: true,
    expectedCorruptRaw: harness.storage.rawSnapshot()
  }), false);
  assert.equal(harness.value(), "{broken");
  assert.equal(harness.writes(), 0);
});

test("unavailable local storage blocks writes without replacing existing creator data", () => {
  const harness = createStorage("previous-data", { readError: true });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.storage.read())), {});
  assert.match(harness.storage.issue(), /个人库存储不可用/);
  assert.equal(harness.storage.write({ new: { name: "新档案", platform: "B站" } }), false);
  assert.equal(harness.value(), "previous-data");
  assert.equal(harness.writes(), 0);
});

test("replacing corrupt creator data is reserved for an explicit backup import confirmation", () => {
  const raw = "{broken";
  const harness = createStorage(raw);
  harness.storage.read();
  const expectedCorruptRaw = harness.storage.rawSnapshot();
  const backup = { safe: { name: "备份达人", platform: "B站" } };
  assert.equal(harness.storage.write(backup, { replaceCorrupt: true, expectedCorruptRaw }), true);
  assert.equal(JSON.parse(harness.value()).safe.name, "备份达人");

  const importStart = app.indexOf("function importCreatorLibrary(event)");
  const importEnd = app.indexOf("function mergeCreatorProfiles", importStart);
  const importSource = app.slice(importStart, importEnd);
  const confirmIndex = importSource.indexOf("window.confirm(");
  const freshLibraryIndex = importSource.indexOf("const library = replaceCorrupt ? {} : existingLibrary");
  const replaceIndex = importSource.indexOf("writeCreatorLibrary(library, { replaceCorrupt, expectedCorruptRaw })");
  const snapshotIndex = importSource.indexOf("const expectedCorruptRaw = creatorLibraryStorageRawSnapshot");
  assert.ok(snapshotIndex >= 0 && confirmIndex > snapshotIndex && freshLibraryIndex > confirmIndex && replaceIndex > freshLibraryIndex, "confirmed recovery must bind the confirmation to the original corrupt snapshot before writing");
});

test("backup restore is cancelled when another tab changes the corrupt library after confirmation", () => {
  const raw = "{broken";
  const harness = createStorage(raw);
  harness.storage.read();
  const expectedCorruptRaw = harness.storage.rawSnapshot();
  const newerLibrary = JSON.stringify({ newer: { name: "其他标签页已恢复", platform: "B站" } });
  harness.setExternally(newerLibrary);

  assert.equal(harness.storage.write({ backup: { name: "旧备份", platform: "小红书" } }, {
    replaceCorrupt: true,
    expectedCorruptRaw
  }), false);
  assert.equal(harness.value(), newerLibrary);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.storage.corrupt(), false);
  assert.match(harness.storage.issue(), /确认期间.*变化/);
});

test("cloud sync cannot overwrite a newer local creator library", () => {
  const initial = JSON.stringify({ old: { name: "旧档案", platform: "B站" } });
  const harness = createStorage(initial);
  harness.storage.read();
  const expectedRaw = harness.storage.rawSnapshot();
  const newerLibrary = JSON.stringify({ latest: { name: "同步期间新增", platform: "小红书" } });
  harness.setExternally(newerLibrary);

  assert.equal(harness.storage.write({ old: { name: "旧档案", platform: "B站" } }, {
    requireUnchanged: true,
    expectedRaw
  }), false);
  assert.equal(harness.value(), newerLibrary);
  assert.equal(harness.writes(), 0);
  assert.equal(harness.storage.corrupt(), false);
  assert.match(harness.storage.issue(), /同步期间.*变化/);

  const syncStart = app.indexOf("async function syncCreatorLibrary()");
  const syncEnd = app.indexOf("function explainCreatorScore", syncStart);
  const syncSource = app.slice(syncStart, syncEnd);
  assert.match(syncSource, /const expectedLocalRaw = creatorLibraryStorageRawSnapshot/);
  assert.match(syncSource, /writeCreatorLibrary\(merged, \{ requireUnchanged: true, expectedRaw: expectedLocalRaw, skipRemoteSync: true \}\)/);
  assert.match(syncSource, /同步期间发生变化[\s\S]{0,80}请再次同步/);
  assert.match(syncSource, /同步期间发生变化\/.test\(message\)/);
});

test("cloud creator sync stops before writing remotely when the local library is damaged", () => {
  const syncStart = app.indexOf("async function syncCreatorLibrary()");
  const syncEnd = app.indexOf("function explainCreatorScore", syncStart);
  const source = app.slice(syncStart, syncEnd);
  const readIndex = source.indexOf("const localLibrary = readCreatorLibrary()");
  const guardIndex = source.indexOf("if (creatorLibraryStorageIssue) throw");
  const putIndex = source.indexOf("let result = await put(");
  assert.ok(readIndex >= 0 && guardIndex > readIndex && putIndex > guardIndex);
});

test("authenticated hosted creator edits debounce sync and discard it after account changes", () => {
  let timerId = 0;
  let syncCalls = 0;
  const timers = new Map();
  const cancelled = new Set();
  let localFile = false;
  let localValue = null;
  const localStorage = {
    getItem: () => localValue,
    setItem: (_key, value) => { localValue = value; }
  };
  const scheduleStart = app.indexOf("let creatorLibraryAutoSyncTimer = null;");
  const scheduleEnd = app.indexOf("function creatorSnapshot(", scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, "creator library auto-sync flow should be available for authenticated accounts");
  const source = app.slice(scheduleStart, scheduleEnd);
  const context = {
    window: { localStorage },
    recordSync: () => { syncCalls += 1; },
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => cancelled.add(id)
  };
  const harness = vm.runInNewContext(`(() => {
    const CREATOR_LIBRARY_STORAGE_KEY = "creator-library";
    let archiveSessionUser = { id: "account-a" };
    let creatorLibraryStorageIssue = "";
    let creatorLibraryStorageCorrupt = false;
    let creatorLibraryStorageRawSnapshot;
    function isLocalFileRuntime() { return localFile; }
    function syncCreatorLibrary() { recordSync(); }
    ${validators}
    ${source}
    return {
      write: writeCreatorLibrary,
      cancelAutoSync: cancelCreatorLibraryAutoSync,
      setUser: (user) => { archiveSessionUser = user; },
      setLocalFile: (value) => { localFile = value; },
      timerKey: () => creatorLibraryAutoSyncStorageKey
    };
  })()`, {
    ...context,
    get localFile() { return localFile; },
    set localFile(value) { localFile = value; }
  });
  const activeTimers = () => [...timers.entries()].filter(([id]) => !cancelled.has(id));
  const library = { creator: { name: "同步验证", platform: "B站" } };

  assert.equal(harness.write(library), true);
  assert.equal(harness.write({ ...library, second: { name: "第二次修改", platform: "小红书" } }), true);
  assert.equal(activeTimers().length, 1, "repeated edits should share one pending sync");
  assert.equal(activeTimers()[0][1].delay, 500);

  harness.setUser({ id: "account-b" });
  const [pendingId, pending] = activeTimers()[0];
  harness.cancelAutoSync();
  assert.equal(activeTimers().length, 0, "account changes should cancel the pending sync timer");
  pending.callback();
  assert.equal(syncCalls, 0, "a pending save from the previous account must not sync under the new account");
  assert.equal(harness.timerKey(), "");

  harness.setUser(null);
  assert.equal(harness.write(library), true);
  assert.equal(activeTimers().length, 0, "guest libraries should not be uploaded automatically");
  harness.setUser({ id: "account-b" });
  harness.setLocalFile(true);
  assert.equal(harness.write(library), true);
  assert.equal(activeTimers().length, 0, "file pages should keep local-only behavior");

  harness.setLocalFile(false);
  assert.equal(harness.write(library), true);
  const [, scheduled] = activeTimers()[0];
  scheduled.callback();
  assert.equal(syncCalls, 1, "a stable authenticated edit should invoke cloud sync after the debounce");
  assert.equal(harness.timerKey(), "");
  assert.ok(pendingId > 0);
});

test("the creator library panel surfaces unreadable storage instead of an empty-library state", () => {
  const renderStart = app.indexOf("function renderCreatorLibrary()");
  const renderEnd = app.indexOf("function saveCreatorLibraryCard", renderStart);
  const source = app.slice(renderStart, renderEnd);
  assert.match(source, /creatorLibraryStorageIssue[\s\S]*role="status"/);
  assert.match(source, /个人库暂时无法读取/);
});

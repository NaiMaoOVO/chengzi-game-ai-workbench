const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = app.indexOf("function handleScreenshotFiles(files) {");
const end = app.indexOf("\nfunction updateStreamerImportStatus", start);
const releaseStart = app.indexOf("function releaseStreamerImageUrls(items) {");
const releaseEnd = app.indexOf("\nfunction getStreamerMissingFields", releaseStart);
assert.ok(start >= 0 && end > start, "screenshot import handler should exist in app.js");
assert.ok(releaseStart >= 0 && releaseEnd > releaseStart, "screenshot cleanup helper should exist in app.js");

function createHarness() {
  const calls = [];
  const status = [];
  let active = 0;
  let maxActive = 0;
  let nextId = 0;
  const harness = {
    setTimeout,
    createStreamerFromFile: () => {
      const id = ++nextId;
      return { id, imageUrl: `blob:test/${id}`, ocrStatus: "OCR 排队中…" };
    },
    renderStreamerList() {},
    analyzeReview() {},
    updateStreamerImportStatus: (message) => status.push(message),
    URL: { revokeObjectURL() {} },
    tryRecognizeScreenshot: async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      calls.push(id);
      active -= 1;
    }
  };
  vm.runInNewContext(`(() => {
    const MAX_SCREENSHOT_OCR_BYTES = 12 * 1024 * 1024;
    const MAX_SCREENSHOT_BATCH_COUNT = 20;
    const MAX_SCREENSHOT_OCR_PENDING_COUNT = 20;
    const MAX_SCREENSHOT_ROW_COUNT = 40;
    let screenshotOcrPendingCount = 0;
    const screenshotOcrFiles = new WeakMap();
    const screenshotOcrControllers = new WeakMap();
    let streamers = [];
    let screenshotOcrQueue = Promise.resolve();
    ${app.slice(releaseStart, releaseEnd)}
    ${app.slice(start, end)}
    this.handle = handleScreenshotFiles;
    this.queue = () => screenshotOcrQueue;
    this.release = releaseStreamerImageUrls;
    this.getStreamers = () => streamers;
    this.replaceStreamers = (items) => { streamers = items; };
  })()`, harness);
  return { ...harness, calls, status, getMaxActive: () => maxActive };
}

test("screenshot OCR filters oversize files, caps batches and serializes requests", async () => {
  const harness = createHarness();
  const files = [
    ...Array.from({ length: 22 }, (_unused, index) => ({ type: "image/jpeg", size: 1024, name: `image-${index}.jpg` })),
    { type: "image/png", size: 12 * 1024 * 1024 + 1, name: "large.png" },
    { type: "text/plain", size: 100, name: "notes.txt" }
  ];

  harness.handle(files);
  await harness.queue();

  assert.equal(harness.getStreamers().length, 20);
  assert.equal(harness.calls.length, 20);
  assert.equal(harness.getMaxActive(), 1);
  assert.match(harness.status[0], /已排队 20 张，逐张识别/);
  assert.match(harness.status[0], /超过单批上限 2 张/);
  assert.match(harness.status[0], /非图片或超出 12 MiB 2 个/);
});

test("screenshot OCR gives an actionable message when every image exceeds the service limit", () => {
  const harness = createHarness();
  harness.handle([{ type: "image/png", size: 13 * 1024 * 1024 }]);

  assert.equal(harness.getStreamers().length, 0);
  assert.match(harness.status[0], /单张图片不能超过 12 MiB/);
});

test("screenshot OCR bounds repeated batches and releases queue capacity after processing", async () => {
  const harness = createHarness();
  const files = (name) => ({ type: "image/jpeg", size: 1024, name });

  harness.handle(Array.from({ length: 20 }, (_unused, index) => files(`first-${index}.jpg`)));
  harness.handle([files("overflow.jpg")]);
  assert.equal(harness.getStreamers().length, 20);
  assert.match(harness.status.at(-1), /队列已满（最多 20 张）/);

  await harness.queue();
  harness.handle([files("after-drain.jpg")]);
  await harness.queue();

  assert.equal(harness.getStreamers().length, 21);
  assert.equal(harness.calls.length, 21);
  assert.match(harness.status.at(-1), /已排队 1 张/);
});

test("removing queued screenshots immediately releases their slots without retaining file objects", async () => {
  const harness = createHarness();
  harness.handle(Array.from({ length: 20 }, (_unused, index) => ({ type: "image/jpeg", size: 1024, name: `queued-${index}.jpg` })));
  const removed = harness.getStreamers().slice(0, 10);
  harness.release(removed);
  harness.replaceStreamers(harness.getStreamers().slice(10));
  harness.handle([{ type: "image/jpeg", size: 1024, name: "replacement.jpg" }]);
  await harness.queue();

  assert.equal(harness.getStreamers().length, 11);
  assert.equal(harness.calls.length, 11);
  assert.match(harness.status.at(-1), /已排队 1 张/);
});

test("removing a screenshot aborts the active OCR fetch and keeps its slot until cleanup", async () => {
  const start = app.indexOf("async function tryRecognizeScreenshot(");
  const end = app.indexOf("\n/* ========================================\n   模块1：竞品内容拆解", start);
  assert.ok(start >= 0 && end > start);
  const streamer = { id: 1, imageUrl: "blob:test/active", ocrQueuePending: true, ocrQueueActive: true };
  let capturedSignal;
  let clearedTimeout = false;
  const sandbox = {
    AbortController,
    streamers: [streamer],
    screenshotOcrPendingCount: 1,
    screenshotOcrFiles: new WeakMap(),
    screenshotOcrControllers: new WeakMap(),
    OCR_SERVICE_URL: "http://127.0.0.1:8787",
    window: { setTimeout: () => 1, clearTimeout: () => { clearedTimeout = true; } },
    fetch: (_url, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    isOnlineServiceMode: () => false,
    renderStreamerList() {},
    updateStreamerOcrHint() {},
    analyzeReview() {}
  };
  vm.runInNewContext(`${app.slice(releaseStart, releaseEnd)}\n${app.slice(start, end)}\nthis.release = releaseStreamerImageUrls; this.recognize = tryRecognizeScreenshot;`, sandbox);
  const request = sandbox.recognize(streamer.id, { name: "active.jpg" }, streamer);
  assert.equal(sandbox.screenshotOcrPendingCount, 1);
  sandbox.release([streamer]);
  await request;

  assert.equal(capturedSignal.aborted, true);
  assert.equal(streamer.ocrStatus, "OCR 请求超时，请稍后重试");
  assert.equal(clearedTimeout, true);
  assert.equal(sandbox.screenshotOcrPendingCount, 1, "the queue owns slot release after the aborted request settles");
});

test("screenshot list has a retained-image cap and deleting an image opens a slot", async () => {
  const harness = createHarness();
  const files = (batch) => Array.from({ length: 20 }, (_unused, index) => ({ type: "image/jpeg", size: 1024, name: `${batch}-${index}.jpg` }));

  harness.handle(files("first"));
  await harness.queue();
  harness.handle(files("second"));
  await harness.queue();
  harness.handle([files("overflow")[0]]);
  assert.equal(harness.getStreamers().length, 40);
  assert.match(harness.status.at(-1), /已保留 40 张截图，达到列表上限/);

  const [removed, ...remaining] = harness.getStreamers();
  harness.release([removed]);
  harness.replaceStreamers(remaining);
  harness.handle([files("replacement")[0]]);
  await harness.queue();

  assert.equal(harness.getStreamers().length, 40);
  assert.equal(harness.calls.length, 41);
  assert.match(harness.status.at(-1), /已排队 1 张/);
});

test("project snapshots do not persist transient OCR queue flags or stale pending status", () => {
  const collectStart = app.indexOf("function collectProjectState() {");
  const restoreStart = app.indexOf("function restoreProjectState(", collectStart);
  const restoreEnd = app.indexOf("function saveProjectState(", restoreStart);
  const collectSource = app.slice(collectStart, restoreStart);
  const restoreSource = app.slice(restoreStart, restoreEnd);

  assert.match(collectSource, /delete snapshot\.ocrQueuePending/);
  assert.match(collectSource, /delete snapshot\.ocrQueueActive/);
  assert.match(collectSource, /识别未完成；截图未随项目存档/);
  assert.match(restoreSource, /delete restored\.ocrQueuePending/);
  assert.match(restoreSource, /delete restored\.ocrQueueActive/);
});

test("replacing or deleting streamer screenshots revokes only temporary object URLs", () => {
  const helperStart = app.indexOf("function releaseStreamerImageUrls(items) {");
  const helperEnd = app.indexOf("\nfunction getStreamerMissingFields", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const revoked = [];
  const release = vm.runInNewContext(`(${app.slice(helperStart, helperEnd).trim()})`, {
    URL: { revokeObjectURL: (value) => revoked.push(value) }
  });

  release([{ imageUrl: "blob:https://example.test/temporary" }, { imageUrl: "data:image/png;base64,stored" }, { imageUrl: "" }]);

  assert.deepEqual(revoked, ["blob:https://example.test/temporary"]);
});

test("queued OCR skips a removed streamer even if a new row reuses its id", async () => {
  const harness = createHarness();
  harness.handle([{ type: "image/jpeg", size: 1024, name: "old.jpg" }]);
  harness.replaceStreamers([{ id: 1, name: "new row with reused id" }]);
  await harness.queue();

  assert.deepEqual(harness.calls, []);
});

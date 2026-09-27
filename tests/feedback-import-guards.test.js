const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const utils = fs.readFileSync(require.resolve("../utils.js"), "utf8");
const decoderStart = utils.indexOf("function decodeURIComponentSafe(");
const decoderEnd = utils.indexOf("\n}", decoderStart) + 2;
assert.ok(decoderStart >= 0 && decoderEnd > decoderStart, "safe URI decoder should exist in utils.js");
const decodeURIComponentSafe = vm.runInNewContext(`(${utils.slice(decoderStart, decoderEnd).trim()})`);
const targetStart = app.indexOf("function setFeedbackImportTarget(target) {");
const fetchStart = app.indexOf("async function fetchBiliComments()", targetStart);
const fetchEnd = app.indexOf("\nasync function fetchCommentsByVideoUrl", fetchStart);
assert.ok(targetStart >= 0 && fetchStart > targetStart && fetchEnd > fetchStart, "feedback import functions should exist in app.js");
const source = app.slice(targetStart, fetchEnd);

function createHarness() {
  const input = { value: "https://www.bilibili.com/video/BVfirst" };
  const status = { textContent: "", className: "" };
  const elements = {
    "#bili-comment-url": input,
    "#feedback-source-status": status,
    "#demo-mode-toggle": { checked: false },
    "#feedback-game": { value: "鸣潮" },
    "#feedback-import-url-label": { textContent: "" },
    "#feedback-platform-switch": { querySelectorAll: () => [] }
  };
  const requests = [];
  const imports = [];
  let modeGeneration = 1;
  const context = {
    AbortController,
    URLSearchParams,
    COMMENT_SERVICE_URL: "http://127.0.0.1:8791",
    XHS_SERVICE_URL: "http://127.0.0.1:8805",
    FEEDBACK_XHS_SOURCE: "小红书笔记",
    decodeURIComponentSafe,
    feedbackImportTarget: "bili",
    document: {
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => []
    },
    serviceModeGuard: {
      current: () => modeGeneration,
      isCurrent: (generation) => generation === modeGeneration,
      next: () => ++modeGeneration
    },
    createGenerationGuard: () => {
      let generation = 0;
      return {
        current: () => generation,
        next: () => ++generation,
        isCurrent: (candidate) => candidate === generation
      };
    },
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })),
    importFeedbackComments: (comments, sourceName) => {
      imports.push({ comments, sourceName });
      return { lines: comments, removedTotal: 0 };
    },
    analyzeFeedback() {},
    setFetchDiagnostic() {},
    normalizeBiliErrorMessage: (message) => message,
    normalizeXhsNoteErrorMessage: (message) => message,
    buildDemoFeedbackComments: () => [],
    currentTrendingTopics: [],
    isOnlineServiceMode: () => false
  };
  const run = vm.runInNewContext(`(() => {
    let feedbackImportTarget = "bili";
    const feedbackImportRequestGuard = createGenerationGuard();
    ${source}
    return { fetchBiliComments, fetchXhsNoteComments, setFeedbackImportTarget };
  })()`, context);
  return { run, input, status, requests, imports, context, switchMode: () => { modeGeneration += 1; } };
}

function resolveComments(request, message) {
  resolvePayload(request, { comments: [{ message }], source: "B站", title: message });
}

function resolvePayload(request, payload) {
  request.resolve({ ok: true, json: async () => payload });
}

test("a slower previous comment fetch cannot overwrite the latest request", async () => {
  const harness = createHarness();
  const older = harness.run.fetchBiliComments();
  await Promise.resolve();
  harness.input.value = "https://www.bilibili.com/video/BVlatest";
  const latest = harness.run.fetchBiliComments();
  await Promise.resolve();
  assert.equal(harness.requests.length, 2);

  resolveComments(harness.requests[1], "最新链接评论");
  await latest;
  resolveComments(harness.requests[0], "旧链接迟到评论");
  await older;

  assert.equal(harness.imports.length, 1);
  assert.deepEqual(harness.imports[0].comments, ["最新链接评论"]);
  assert.match(harness.status.textContent, /已导入 1 条有效评论/);
});

test("a comment response is discarded after its source or service mode changes", async () => {
  const harness = createHarness();
  const request = harness.run.fetchBiliComments();
  await Promise.resolve();
  harness.run.setFeedbackImportTarget("xhs");
  resolveComments(harness.requests[0], "不应导入的旧来源评论");
  await request;

  assert.equal(harness.imports.length, 0);
  assert.match(harness.status.textContent, /旧抓取结果已忽略/);

  harness.run.setFeedbackImportTarget("bili");
  const nextRequest = harness.run.fetchBiliComments();
  await Promise.resolve();
  harness.switchMode();
  resolveComments(harness.requests.at(-1), "不应导入的旧模式评论");
  await nextRequest;

  assert.equal(harness.imports.length, 0);
  assert.match(harness.status.textContent, /服务模式已变化/);
});

test("malformed Xiaohongshu token encoding is reported as an input error without starting a request", async () => {
  const harness = createHarness();
  harness.input.value = "https://www.xiaohongshu.com/explore/abc?xsec_token=%E0%A4%A";

  await assert.doesNotReject(harness.run.fetchXhsNoteComments());

  assert.equal(harness.requests.length, 0);
  assert.equal(harness.imports.length, 0);
  assert.match(harness.status.textContent, /链接格式无效/);
  assert.match(harness.status.textContent, /重新复制/);
});

test("Bilibili malformed comment payloads show an actionable service-data error", async () => {
  const harness = createHarness();
  const request = harness.run.fetchBiliComments();
  await Promise.resolve();
  resolvePayload(harness.requests[0], { comments: { invalid: true } });
  await request;

  assert.equal(harness.imports.length, 0);
  assert.match(harness.status.textContent, /评论服务返回的数据格式异常/);
  assert.doesNotMatch(harness.status.textContent, /map is not a function/);
});

test("Xiaohongshu malformed comment payloads show an actionable bridge-data error", async () => {
  const harness = createHarness();
  harness.run.setFeedbackImportTarget("xhs");
  harness.input.value = "https://www.xiaohongshu.com/explore/abc?xsec_token=token";
  const request = harness.run.fetchXhsNoteComments();
  await Promise.resolve();
  resolvePayload(harness.requests[0], { note: { title: "笔记", comments: { invalid: true } } });
  await request;

  assert.equal(harness.imports.length, 0);
  assert.match(harness.status.textContent, /小红书桥接服务返回的评论数据格式异常/);
  assert.doesNotMatch(harness.status.textContent, /map is not a function/);
});

test("null comment-service and bridge payloads show data errors instead of property-access exceptions", async () => {
  const bili = createHarness();
  const biliRequest = bili.run.fetchBiliComments();
  await Promise.resolve();
  resolvePayload(bili.requests[0], null);
  await biliRequest;
  assert.match(bili.status.textContent, /评论服务返回的数据格式异常/);
  assert.doesNotMatch(bili.status.textContent, /reading 'comments'/);

  const xhs = createHarness();
  xhs.run.setFeedbackImportTarget("xhs");
  xhs.input.value = "https://www.xiaohongshu.com/explore/abc?xsec_token=token";
  const xhsRequest = xhs.run.fetchXhsNoteComments();
  await Promise.resolve();
  resolvePayload(xhs.requests[0], null);
  await xhsRequest;
  assert.match(xhs.status.textContent, /小红书桥接服务返回的笔记数据格式异常/);
  assert.doesNotMatch(xhs.status.textContent, /reading 'note'/);
});

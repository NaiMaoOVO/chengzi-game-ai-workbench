const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = app.indexOf("let feedbackLlmGeneration = 0;");
const end = app.indexOf("\nasync function enhanceVersionWithLlm", start);
assert.ok(start >= 0 && end > start, "feedback LLM enhancement should exist in app.js");

test("comment AI ignores a response from the service mode active before a mode switch", async () => {
  const panel = { innerHTML: "" };
  const game = { value: "鸣潮" };
  let currentMode = 1;
  let resolveRequest;
  const context = {
    document: {
      querySelector: (selector) => selector === "#feedback-ai-insight" ? panel
        : selector === "#feedback-game" ? game
          : null
    },
    currentFeedbackRows: [{ comment: "评论一" }, { comment: "评论二" }, { comment: "评论三" }],
    llmServiceState: "ready",
    llmModelName: "测试模型",
    serviceModeGuard: {
      current: () => currentMode,
      isCurrent: (generation) => generation === currentMode
    },
    renderLlmBadge() {},
    requestLlmTask: () => new Promise((resolve) => { resolveRequest = resolve; }),
    escapeHtml: (value) => String(value ?? ""),
    Date,
    window: { setTimeout, clearTimeout }
  };

  const request = vm.runInNewContext(`(async () => {
    ${app.slice(start, end)}
    await enhanceFeedbackWithLlm();
  })()`, context);
  assert.match(panel.innerHTML, /AI 正在分析 3 条评论/);

  currentMode += 1;
  resolveRequest({
    ok: true,
    result: { summary: "旧模式的迟到结果", sentiment_overview: "", suggested_actions: [] },
    model: "测试模型"
  });
  await request;

  assert.doesNotMatch(panel.innerHTML, /旧模式的迟到结果/);
  assert.match(panel.innerHTML, /服务模式已切换.*旧分析结果已忽略/);
  assert.match(panel.innerHTML, /请重新运行评论分析/);
});

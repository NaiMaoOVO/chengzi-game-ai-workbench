const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("overview service checks start in parallel with slow LLM health and use its final state", async () => {
  const start = app.indexOf("function getLlmServiceStatus()");
  const end = app.indexOf("function renderDemoCheck", start);
  assert.ok(start >= 0 && end > start);

  let resolveLlm;
  let localChecksStarted = false;
  let backupCheckStarted = false;
  const context = {
    serviceModeGuard: { current: () => 1, isCurrent: () => true },
    renderServiceModeControls() {},
    renderServiceCard() {},
    renderArchiveBackupStatus() {},
    renderLlmBadge() {},
    checkServiceEndpoint: async () => {
      localChecksStarted = true;
      return { online: true, detail: "已连接" };
    },
    checkArchiveBackupStatus: async () => {
      backupCheckStarted = true;
      return { tone: "success", detail: "今日备份已通过校验" };
    },
    checkLlmHealth: () => new Promise((resolve) => {
      resolveLlm = () => {
        context.llmServiceState = "ready";
        context.llmModelName = "test-model";
        resolve();
      };
    }),
    OCR_SERVICE_URL: "http://ocr.test",
    HOTSPOT_SERVICE_URL: "http://hotspot.test",
    COMMENT_SERVICE_URL: "http://comment.test",
    llmServiceState: "down",
    llmModelName: ""
  };
  const functions = vm.runInNewContext(
    `${app.slice(start, end)}; ({ getLocalServiceStatus, refreshOverviewServiceStatus })`,
    context
  );

  const pending = functions.refreshOverviewServiceStatus();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(localChecksStarted, true, "local probes should not wait for the LLM probe");
  assert.equal(backupCheckStarted, true, "backup status should not wait for the LLM probe");
  resolveLlm();
  const result = await pending;
  assert.equal(result.llm.online, true);
  assert.match(result.llm.detail, /test-model/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const launcher = fs.readFileSync(path.join(root, "launcher.js"), "utf8");

test("screenshot drop zone has button semantics and keyboard activation", () => {
  assert.match(html, /id="stream-drop-zone"[^>]*role="button"[^>]*aria-label=/);
  assert.match(app, /dropZone\?\.addEventListener\("keydown"/);
});

test("dynamic launcher and overview statuses announce updates", () => {
  assert.match(html, /id="overview-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="launcher-status"[^>]*aria-live="polite"/);
});

test("project slots use explicit buttons instead of a clickable div", () => {
  assert.doesNotMatch(app, /slot\.addEventListener\("click"/);
  assert.match(html, /class="slot-action slot-save"/);
  assert.match(html, /class="slot-action slot-load"/);
});

test("mobile styles allow the service mode switch to wrap", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.service-mode-switch[\s\S]*grid-template-columns:\s*1fr 1fr/);
});

test("daily workbench source matches its form, counters and completed section", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");

  assert.match(html, /<form class="daily-quick-add" id="daily-todo-form">/);
  assert.match(html, /id="daily-stat-todo"/);
  assert.match(html, /id="daily-stat-risk"/);
  assert.match(html, /id="daily-stat-publish"/);
  assert.match(html, /id="daily-done-container"/);
  assert.match(html, /data-daily-filter="risk"/);
  assert.match(html, /id="daily-connection-state"[^>]*aria-live="polite"/);
  assert.match(html, /id="daily-project-context"[^>]*aria-live="polite"/);
  assert.match(daily, /daily-todo-form/);
  assert.match(daily, /daily-stat-todo/);
  assert.match(daily, /daily-done-container/);
  assert.match(daily, /authRequired/);
  assert.match(daily, /data-daily-filter/);
  assert.match(daily, /creator: \{ view: "creator", label: "查看达人" \}/);
  assert.match(daily, /trending: \{ view: "trending", label: "查看热点" \}/);
  assert.match(daily, /navigateToView\(target\.view\)/);
  assert.match(daily, /refreshDailyProjectContext/);
  assert.match(app, /refreshDailyProjectContext\?\.\(\)/);
});

test("daily workbench exposes persisted morning run status", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  const archive = fs.readFileSync(path.join(root, "archive-server.js"), "utf8");

  assert.match(html, /id="daily-morning-status"[^>]*aria-live="polite"/);
  assert.match(daily, /daily-morning-status/);
  assert.match(daily, /morningRuns/);
  assert.match(daily, /登录或连接服务后可查看运行状态/);
  assert.match(app, /\/morning-runs\?limit=20/);
  assert.match(archive, /url\.pathname === "\/morning-runs"/);
});

test("daily workbench makes overdue and planned dates visible", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");

  assert.match(daily, /function dueState/);
  assert.match(daily, /逾期/);
  assert.match(daily, /今日/);
  assert.match(daily, /daily-due-badge/);
});

test("daily workbench refreshes visible operational status automatically", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");

  assert.match(daily, /setInterval/);
  assert.match(daily, /300000/);
  assert.match(daily, /visibilityState/);
});

test("daily queue degrades gracefully when the optional morning status endpoint fails", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  assert.match(app, /Promise\.allSettled/);
  assert.match(app, /morningUnavailable/);
  assert.match(daily, /state\.morningUnavailable/);
});

test("background snapshot writes expose success and failure instead of swallowing errors", () => {
  assert.match(html, /id="archive-sync-status"[^>]*aria-live="polite"/);
  assert.match(app, /function setArchiveSyncStatus/);
  assert.match(app, /存档失败/);
  assert.doesNotMatch(app, /存档失败不影响主流程/);
});

test("background snapshots use a stable daily idempotency key", () => {
  assert.match(app, /function snapshotRequestId/);
  assert.match(app, /archiveSnapshot[\s\S]{0,1200}Idempotency-Key/);
  assert.match(app, /snapshot-\$\{kind\}-\$\{businessDate\(\)\}/);
});

test("daily workbench aggregates every project while assigning new tasks to the current project", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");

  assert.match(daily, /allProjectsScope = "工作范围：全部项目"/);
  assert.match(daily, /allProjectsScope \+ " · 新增待办归属："/);
  assert.match(app, /\/daily-todos\?status=open&limit=50/);
  assert.match(app, /\/daily-todos\?status=done&limit=50/);
});

test("eligible creator decisions can become idempotent daily follow-up tasks", () => {
  assert.match(app, /data-creator-task-key=/);
  assert.match(app, /function addCreatorFollowUp/);
  assert.match(app, /Idempotency-Key/);
  assert.match(app, /\/daily-todos/);
});

test("local service recovery waits for archive readiness and reloads the daily queue", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  assert.match(launcher, /function waitForArchiveService/);
  assert.match(launcher, /gameops:local-archive-ready/);
  assert.match(daily, /openLocalServiceRecovery/);
  assert.match(daily, /bootstrap-local-launcher/);
  assert.match(app, /gameops:local-archive-ready[\s\S]{0,220}refreshArchiveSession\(\)/);
});

test("a hotspot decision can become one idempotent daily follow-up", () => {
  assert.match(app, /id="add-topic-to-daily-todo"/);
  assert.match(app, /function addSelectedTopicToDailyTodo/);
  assert.match(app, /source: "trending"/);
  assert.match(app, /Idempotency-Key/);
});

test("local file mode explains that online account login needs an HTTP site", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  assert.match(app, /function isLocalFileRuntime\(\)/);
  assert.match(app, /本地文件模式不支持账号登录/);
  assert.match(daily, /本地文件模式无法使用线上账号登录/);
});

test("external hotspot styling is normalized before HTML rendering", () => {
  assert.doesNotMatch(app, /return \{ \.\.\.item, rank: index \+ 1 \};/);
  assert.match(app, /function normalizeHotspotBadge/);
});

test("project profile controls are initialized independently from LLM health checks", () => {
  const profileStart = app.indexOf("function collectProfileFromPage()");
  const llmHealthStart = app.indexOf("async function checkLlmHealth");
  assert.ok(profileStart >= 0 && llmHealthStart >= 0);
  assert.ok(profileStart < llmHealthStart);
  assert.match(app, /document\.querySelector\("#save-profile"\)\?\.addEventListener/);
});

test("project profiles save and restore existing content, version, and creator controls", () => {
  assert.doesNotMatch(app, /#content-competitor/);
  assert.match(app, /content: \{[\s\S]{0,240}input: document\.querySelector\("#content-input"\)/);
  assert.match(app, /version: \{[\s\S]{0,240}points: document\.querySelector\("#version-points"\)/);
  assert.match(app, /creator: \{[\s\S]{0,240}input: document\.querySelector\("#creator-input"\)/);
  assert.match(app, /setFieldValue\("#content-input", profile\.content\?\.input/);
  assert.match(app, /setFieldValue\("#version-points", profile\.version\?\.points/);
  assert.match(app, /setFieldValue\("#creator-input", profile\.creator\?\.input/);
});

test("daily task dates use the shared business-date helper", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  assert.match(daily, /return businessDate\(\)/);
  assert.match(daily, /timeZone: "Asia\/Shanghai"/);
  assert.match(app, /function topicFollowUpRequestId[\s\S]{0,160}businessDate\(\)/);
  assert.match(app, /function creatorFollowUpRequestId[\s\S]{0,160}businessDate\(\)/);
});

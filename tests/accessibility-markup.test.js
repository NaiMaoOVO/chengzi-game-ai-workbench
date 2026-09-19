const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const dailyWorkbench = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
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
  assert.match(daily, /function isCalendarDate/);
  assert.match(daily, /!isCalendarDate\(dueDate\)/);
  assert.match(daily, /逾期/);
  assert.match(daily, /今日/);
  assert.match(daily, /daily-due-badge/);
});

test("daily todo mutations explain how to recover from a disconnected local service", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");
  const addStart = daily.indexOf("async function addTodo");
  const updateStart = daily.indexOf("async function updateTodo");
  const initStart = daily.indexOf("window.initDailyWorkbench", updateStart);
  const helperStart = daily.indexOf("function isDailyServiceUnavailable");
  assert.ok(helperStart >= 0 && addStart > helperStart && updateStart > addStart && initStart > updateStart);
  const helperSource = daily.slice(helperStart, addStart);
  const mutationSource = daily.slice(addStart, initStart);

  assert.match(daily, /function isDailyServiceUnavailable/);
  assert.match(helperSource, /本机服务未连接；启动服务后重试/);
  assert.match(mutationSource, /dailyTodoMutationError\(error\)/);
  assert.doesNotMatch(mutationSource, /添加失败（" \+ error\.message/);
  assert.doesNotMatch(mutationSource, /更新失败（" \+ error\.message/);
});

test("daily dashboard provides grouped navigation, a command palette and decision cues", () => {
  assert.match(html, /class="nav-group-label">工作区</);
  assert.match(html, /class="nav-group-label">内容洞察</);
  assert.match(html, /id="command-trigger"/);
  assert.match(html, /id="command-palette"[^>]*role="dialog"/);
  assert.match(html, /data-command-action="new-todo"/);
  assert.match(html, /id="daily-stat-morning"/);
  assert.match(html, /id="daily-insight-summary"[^>]*aria-live="polite"/);
  assert.match(html, /class="daily-queue-table-head"/);
  assert.match(app, /function openCommandPalette/);
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(dailyWorkbench, /function renderDailyInsight/);
  assert.match(css, /--product-bg:\s*#f7f8fa/);
  assert.match(css, /\.command-palette/);
});

test("daily dashboard keeps project context and AI insight beside the operational queue", () => {
  assert.match(html, /id="daily-project-banner-game"/);
  assert.match(html, /id="daily-project-banner-theme"/);
  assert.match(html, /id="daily-project-version-action"/);
  assert.match(dailyWorkbench, /daily-project-banner-game/);
  assert.match(dailyWorkbench, /daily-project-banner-theme/);
  assert.match(css, /\.daily-project-banner/);
  assert.match(css, /\.daily-workbench-layout[\s\S]*grid-template-columns:/);
  assert.match(css, /\.daily-insight-panel[\s\S]*grid-column:\s*2/);
});

test("daily dashboard promotes the page title while keeping global service noise out of its first screen", () => {
  assert.match(html, /<h3>每日工作台<\/h3>/);
  assert.match(html, /class="daily-hero-lead">从数据到行动，让好游戏被更多人看到。<\/p>/);
  assert.match(css, /\.workspace:has\(#daily-view\.active\) \.demo-chain-bar/);
  assert.match(css, /\.workspace:has\(#daily-view\.active\) \.archive-sync-status/);
  assert.match(css, /\.daily-hero\s*\{[\s\S]*background:\s*transparent/);
});

test("daily follow-up work keeps briefing, publication and risk actionable when no records exist", () => {
  assert.match(html, /class="daily-follow-up-grid"/);
  assert.match(html, /id="publication-panel" open/);
  assert.match(html, /id="risk-ticket-panel" open/);
  assert.match(html, /class="daily-management-overview"/);
  assert.match(html, /<summary>登记一条发布<\/summary>/);
  assert.match(html, /<summary>筛选工单<\/summary>/);
  assert.match(css, /\.daily-follow-up-grid\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /\.daily-management-overview/);
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

test("manual briefing archives use an idempotency key on retry", () => {
  const start = app.indexOf("async function archiveCurrentBriefing");
  const end = app.indexOf("function renderBriefArchiveItem", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /snapshotRequestId\("briefing"/);
});

test("trend week boundaries use the Shanghai business date", () => {
  const start = app.indexOf("function splitWeeks");
  const end = app.indexOf("function negativeRatio", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /businessDate\(\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/);
});

test("export filenames use the Shanghai business date", () => {
  assert.doesNotMatch(app, /const date = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test("hotspot timestamps use the Shanghai time zone", () => {
  const start = app.indexOf("function renderTrendingList");
  const end = app.indexOf("function generateRealTrendingInsight", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /timeZone: "Asia\/Shanghai"/);
  assert.doesNotMatch(source, /now\.getFullYear\(\)/);
});

test("published dates use the Shanghai business date", () => {
  const publicationStart = app.indexOf("function formatPublicationDate");
  const publishedStart = app.indexOf("function formatPublishedDate");
  assert.ok(publicationStart >= 0 && publishedStart > publicationStart);
  const source = app.slice(publicationStart, publishedStart + 700);
  assert.match(source, /businessDate\(date\)/);
  assert.doesNotMatch(source, /date\.getFullYear\(\)/);
});

test("failed background snapshots can be retried without rerunning analysis", () => {
  assert.match(html, /id="retry-archive-sync"[^>]*hidden/);
  assert.match(app, /let lastArchiveSnapshot = null/);
  assert.match(app, /retry-archive-sync/);
  assert.match(app, /archiveSnapshot\(lastArchiveSnapshot\.kind/);
});

test("caliber guidance escapes dynamic text before rendering", () => {
  const start = app.indexOf("function openCaliberPanel");
  const end = app.indexOf("function closeCaliberPanel", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /escapeHtml\(caliber\)/);
  assert.doesNotMatch(source, /caliber\.replace\(\/\\n\/g, "<br>"\)/);
});

test("briefing and profile dates use the Shanghai business time zone", () => {
  assert.match(app, /function formatBusinessDateTime/);
  const archiveStart = app.indexOf("function renderBriefArchiveItem");
  const archiveEnd = app.indexOf("async function loadBriefingArchive", archiveStart);
  const profileStart = app.indexOf("async function refreshProfileList");
  const profileEnd = app.indexOf("async function saveCurrentProfile", profileStart);
  const briefingStart = app.indexOf("function buildBriefingImText");
  const briefingEnd = app.indexOf("async function copyBriefingForIm", briefingStart);
  assert.ok(archiveStart >= 0 && archiveEnd > archiveStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  assert.ok(briefingStart >= 0 && briefingEnd > briefingStart);
  assert.match(archiveStart >= 0 ? app.slice(archiveStart, archiveEnd) : "", /formatBusinessDateTime\(briefing\.created_at\)/);
  assert.doesNotMatch(app.slice(archiveStart, archiveEnd), /toLocaleString\(\)/);
  assert.match(app.slice(profileStart, profileEnd), /formatPublicationDate\(item\.updated_at\)/);
  assert.doesNotMatch(app.slice(profileStart, profileEnd), /toLocaleDateString\(\)/);
  assert.match(app.slice(briefingStart, briefingEnd), /formatPublicationDate\(generatedAt\)/);
  assert.doesNotMatch(app.slice(briefingStart, briefingEnd), /generatedAt\.toLocaleDateString/);
});

test("navigation exposes the active view to assistive technology", () => {
  const start = app.indexOf("function navigateToView");
  const end = app.indexOf("function collectListText", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /aria-current/);
  assert.match(source, /removeAttribute\("aria-current"\)/);
});

test("creator library dates use the shared date formatter", () => {
  const start = app.indexOf("function renderCreatorLibrary");
  const end = app.indexOf("function saveCreatorLibraryCard", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /formatPublicationDate\(profile\.updatedAt\)/);
  assert.doesNotMatch(source, /updatedAt \|\| \"\"\)\.slice\(0, 10\)/);
});

test("daily todo creation uses an idempotency key", () => {
  const start = dailyWorkbench.indexOf("async function addTodo");
  const end = dailyWorkbench.indexOf("async function updateTodo", start);
  assert.ok(start >= 0 && end > start);
  const source = dailyWorkbench.slice(start, end);
  assert.match(dailyWorkbench, /function dailyTodoRequestId/);
  assert.match(source, /Idempotency-Key/);
});

test("morning run timestamps use the Shanghai time zone", () => {
  const start = dailyWorkbench.indexOf("function formatMorningTime");
  const end = dailyWorkbench.indexOf("function renderMorningStatus", start);
  assert.ok(start >= 0 && end > start);
  const source = dailyWorkbench.slice(start, end);
  assert.match(source, /timeZone: "Asia\/Shanghai"/);
});

test("open daily todos expose a one-click next-business-day action", () => {
  assert.match(dailyWorkbench, /function shiftBusinessDate/);
  assert.match(dailyWorkbench, /改到明天/);
  assert.match(dailyWorkbench, /updateTodo\(item\.id, \{ due_date:/);
});

test("daily queue can focus overdue and today-due items", () => {
  assert.match(html, /data-daily-filter="overdue"/);
  assert.match(html, /data-daily-filter="today"/);
  assert.match(dailyWorkbench, /activeFilter === "overdue"/);
  assert.match(dailyWorkbench, /activeFilter === "today"/);
});

test("daily summary loads enough risk and publication records for long-term use", () => {
  assert.match(app, /\/risk-events\?status=open&limit=200/);
  assert.match(app, /\/publications\?limit=200/);
});

test("risk and publication management lists expose truncation instead of hiding history", () => {
  const publicationStart = app.indexOf("async function loadPublications");
  const publicationEnd = app.indexOf("async function recordPublication", publicationStart);
  const riskStart = app.indexOf("async function loadRiskTickets");
  const riskEnd = app.indexOf("async function updateRiskTicketStatus", riskStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
  assert.ok(riskStart >= 0 && riskEnd > riskStart);
  const publicationSource = app.slice(publicationStart, publicationEnd);
  const riskSource = app.slice(riskStart, riskEnd);
  assert.match(publicationSource, /\/publications\?limit=200/);
  assert.match(riskSource, /params\.set\("limit", "200"\)/);
  assert.match(publicationSource, /payload\.total/);
  assert.match(riskSource, /payload\.total/);
});

test("daily queue keeps manual todos visible when optional sources fail", () => {
  assert.match(app, /riskUnavailable/);
  assert.match(app, /publicationUnavailable/);
  assert.match(dailyWorkbench, /state\.riskUnavailable/);
  assert.match(dailyWorkbench, /state\.publicationUnavailable/);
});

test("daily queue explains when server totals exceed the loaded rows", () => {
  assert.match(app, /todoTotal/);
  assert.match(app, /doneTotal/);
  assert.match(app, /riskTotal/);
  assert.match(app, /publicationTotal/);
  assert.match(dailyWorkbench, /仅展示最近/);
});

test("project save reports unavailable browser storage instead of throwing", () => {
  const start = app.indexOf("function saveProjectState");
  const end = app.indexOf("function loadProjectState", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /try/);
  assert.match(source, /保存失败/);
});

test("creator library import confirms browser storage persistence", () => {
  const start = app.indexOf("function importCreatorLibrary");
  const end = app.indexOf("function mergeCreatorLibraries", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /const persisted = writeCreatorLibrary\(library\)/);
  assert.match(source, /存储空间不足/);
});

test("creator library sync blocks corrupt remote archives before writing", () => {
  const start = app.indexOf("async function syncCreatorLibrary");
  const end = app.indexOf("function explainCreatorScore", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /remote\.invalid/);
  assert.match(source, /已阻止覆盖/);
});

test("creator library sync canonicalizes identity keys before merging", () => {
  const start = app.indexOf("function canonicalizeCreatorLibrary");
  const end = app.indexOf("async function syncCreatorLibrary", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /creatorKey\(profile\)/);
  assert.match(source, /canonical/);
});

test("creator library sync blocks structurally invalid records", () => {
  const start = app.indexOf("async function syncCreatorLibrary");
  const end = app.indexOf("function explainCreatorScore", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /invalidCreatorLibraryEntries/);
  assert.match(source, /损坏记录/);
});

test("creator effect backfill reports personal-library persistence failures", () => {
  const backfillStart = app.indexOf("function syncCreatorBackfillToLibrary");
  const backfillEnd = app.indexOf("function creatorLibraryOption", backfillStart);
  const recalcStart = app.indexOf("function recalcWithBackfill");
  const recalcEnd = app.indexOf("document.querySelector(\"#caliber-trigger\")", recalcStart);
  assert.ok(backfillStart >= 0 && backfillEnd > backfillStart);
  assert.ok(recalcStart >= 0 && recalcEnd > recalcStart);
  const backfillSource = app.slice(backfillStart, backfillEnd);
  const recalcSource = app.slice(recalcStart, recalcEnd);
  assert.match(backfillSource, /const persisted = writeCreatorLibrary\(library\)/);
  assert.match(backfillSource, /return persisted/);
  assert.match(recalcSource, /backfillPersistenceFailures/);
  assert.match(recalcSource, /个人库/);
});

test("creator effect backfill does not guess among duplicate names", () => {
  const recalcStart = app.indexOf("function recalcWithBackfill");
  const recalcEnd = app.indexOf("document.querySelector(\"#caliber-trigger\")", recalcStart);
  assert.ok(recalcStart >= 0 && recalcEnd > recalcStart);
  const source = app.slice(recalcStart, recalcEnd);
  assert.match(source, /ambiguous/);
  assert.match(source, /重名|多个匹配/);
});

test("daily workbench aggregates every project while assigning new tasks to the current project", () => {
  const daily = fs.readFileSync(path.join(root, "daily-workbench.js"), "utf8");

  assert.match(daily, /allProjectsScope = "工作范围：全部项目"/);
  assert.match(daily, /allProjectsScope \+ " · 新增待办归属："/);
  assert.match(app, /\/daily-todos\?status=open&limit=200/);
  assert.match(app, /\/daily-todos\?status=done&limit=200/);
});

test("eligible creator decisions can become idempotent daily follow-up tasks", () => {
  assert.match(app, /data-creator-task-key=/);
  assert.match(app, /function addCreatorFollowUp/);
  assert.match(app, /Idempotency-Key/);
  assert.match(app, /\/daily-todos/);
});

test("publication and risk ticket writes carry idempotency keys", () => {
  const publicationStart = app.indexOf("async function recordPublication");
  const publicationEnd = app.indexOf("async function loadRiskTickets", publicationStart);
  const riskStart = app.indexOf("async function convertFeedbackRiskToTicket");
  const riskEnd = app.indexOf("function renderFeedbackRiskEvents", riskStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
  assert.ok(riskStart >= 0 && riskEnd > riskStart);
  assert.match(app.slice(publicationStart, publicationEnd), /publicationRequestId/);
  assert.match(app.slice(publicationStart, publicationEnd), /Idempotency-Key/);
  assert.match(app.slice(riskStart, riskEnd), /riskTicketRequestId/);
  assert.match(app.slice(riskStart, riskEnd), /Idempotency-Key/);
});

test("daily publication backfill includes supported Bilibili and Xiaohongshu channels", () => {
  const start = app.indexOf("function publicationNeedsEffectBackfill");
  const end = app.indexOf("window.loadTodayTodos", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /item\.channel !== "B站" && item\.channel !== "小红书"/);
  assert.match(source, /item\.channel === "小红书"[\s\S]*metrics\.likes/);
  assert.match(source, /metrics\.view/);
});

test("daily queue normalizes non-object JSON payloads before partial degradation", () => {
  const start = app.indexOf("window.loadTodayTodos = async function loadTodayTodos");
  const end = app.indexOf("let llmModelName", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /payload && typeof payload === "object" && !Array\.isArray\(payload\)/);
});

test("daily queue validates response item arrays before rendering", () => {
  const start = app.indexOf("window.loadTodayTodos = async function loadTodayTodos");
  const end = app.indexOf("let llmModelName", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /Array\.isArray\(risk\.payload\.items\)/);
  assert.match(source, /Array\.isArray\(publication\.payload\.items\)/);
  assert.match(source, /Array\.isArray\(manual\.payload\.items\)/);
  assert.match(source, /Array\.isArray\(done\.payload\.items\)/);
  assert.match(source, /Array\.isArray\(morning\.payload\.items\)/);
});

test("project profile list surfaces archive failures and corrupted records", () => {
  const start = app.indexOf("async function refreshProfileList");
  const end = app.indexOf("async function saveCurrentProfile", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /if \(!response\.ok \|\| !data\.ok\)/);
  assert.match(source, /item\.invalid/);
  assert.match(source, /档案损坏/);
});

test("corrupted project profiles cannot be loaded as if they were restored", () => {
  const start = app.indexOf("function loadSelectedProfile");
  const end = app.indexOf('document.querySelector("#save-profile")', start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /option\.dataset\.invalid/);
  assert.match(source, /数据损坏/);
  assert.match(source, /重新保存/);
});

test("publication and risk list failures update their status bars", () => {
  const publicationStart = app.indexOf("async function loadPublications");
  const publicationEnd = app.indexOf("async function recordPublication", publicationStart);
  const riskStart = app.indexOf("async function loadRiskTickets");
  const riskEnd = app.indexOf("async function updateRiskTicketStatus", riskStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart && riskStart >= 0 && riskEnd > riskStart);
  const publicationSource = app.slice(publicationStart, publicationEnd);
  const riskSource = app.slice(riskStart, riskEnd);
  assert.match(publicationSource, /setPublicationStatus\("本机存档服务未连接/);
  assert.match(riskSource, /setRiskTicketStatus\("本机存档服务未连接/);
  assert.doesNotMatch(publicationSource, /setPublicationStatus\("读取失败/);
  assert.doesNotMatch(riskSource, /setRiskTicketStatus\("读取失败/);
});

test("publication and risk lists reject malformed item payloads", () => {
  const publicationStart = app.indexOf("async function loadPublications");
  const publicationEnd = app.indexOf("async function recordPublication", publicationStart);
  const riskStart = app.indexOf("async function loadRiskTickets");
  const riskEnd = app.indexOf("async function updateRiskTicketStatus", riskStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart && riskStart >= 0 && riskEnd > riskStart);
  assert.match(app.slice(publicationStart, publicationEnd), /Array\.isArray\(payload\.items\)/);
  assert.match(app.slice(riskStart, riskEnd), /Array\.isArray\(payload\.items\)/);
});

test("publication and risk list refreshes ignore stale responses", () => {
  const publicationStart = app.indexOf("async function loadPublications");
  const publicationEnd = app.indexOf("async function recordPublication", publicationStart);
  const riskStart = app.indexOf("async function loadRiskTickets");
  const riskEnd = app.indexOf("async function updateRiskTicketStatus", riskStart);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart && riskStart >= 0 && riskEnd > riskStart);
  assert.match(app, /const publicationListRequestGuard = createGenerationGuard\(\)/);
  assert.match(app, /const riskTicketListRequestGuard = createGenerationGuard\(\)/);
  assert.match(app.slice(publicationStart, publicationEnd), /publicationListRequestGuard\.next\(\)/);
  assert.match(app.slice(publicationStart, publicationEnd), /publicationListRequestGuard\.isCurrent\(/);
  assert.match(app.slice(riskStart, riskEnd), /riskTicketListRequestGuard\.next\(\)/);
  assert.match(app.slice(riskStart, riskEnd), /riskTicketListRequestGuard\.isCurrent\(/);
});

test("risk ticket mutations are single-flight per ticket", () => {
  const updateStart = app.indexOf("async function updateRiskTicketStatus");
  const deleteStart = app.indexOf("async function deleteRiskTicket", updateStart);
  const deleteEnd = app.indexOf("document.querySelector(\"#query-risk-tickets\")", deleteStart);
  assert.ok(updateStart >= 0 && deleteStart > updateStart && deleteEnd > deleteStart);
  assert.match(app, /const riskTicketMutationGuard = new Set\(\)/);
  assert.match(app.slice(updateStart, deleteEnd), /beginRiskTicketMutation\(id\)/);
  assert.match(app.slice(updateStart, deleteEnd), /finishRiskTicketMutation\(mutationKey\)/);
});

test("briefing archive surfaces response failures and corrupted entries", () => {
  const renderStart = app.indexOf("function renderBriefArchiveItem");
  const renderEnd = app.indexOf("async function loadBriefingArchive", renderStart);
  const loadEnd = app.indexOf("document.querySelector(\"#generate-briefing\")", renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart && loadEnd > renderEnd);
  assert.match(app.slice(renderStart, renderEnd), /briefing\.invalid/);
  assert.match(app.slice(renderStart, renderEnd), /数据损坏/);
  assert.match(app.slice(renderEnd, loadEnd), /if \(!response\.ok \|\| !payload\.ok\)/);
  assert.match(app.slice(renderEnd, loadEnd), /历史简报暂不可用/);
});

test("briefing renderer degrades safely when archived fields have malformed shapes", () => {
  const renderStart = app.indexOf("function renderBriefing");
  const renderEnd = app.indexOf("async function generateDailyBriefing", renderStart);
  const normalizerStart = app.lastIndexOf("function normalizeBriefingPayload", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const source = app.slice(normalizerStart >= 0 ? normalizerStart : renderStart, renderEnd);
  const body = { hidden: true, innerHTML: "" };
  const context = {
    document: { querySelector: (selector) => selector === "#briefing-body" ? body : null },
    formatBusinessDateTime: () => "2026-09-18 10:00",
    escapeHtml: (value) => String(value)
  };
  vm.runInNewContext(source + "\nthis.renderBriefing = renderBriefing;", context);
  assert.doesNotThrow(() => context.renderBriefing({
    game: "鸣潮",
    topics: "malformed",
    todoSuggestions: { malformed: true },
    feedback: null,
    weekOverWeek: { negativeRatio: "bad" }
  }));
  assert.match(body.innerHTML, /暂无热点数据/);
});

test("daily briefing enables archive and copy only after a briefing is rendered", () => {
  assert.match(html, /id="archive-briefing" type="button" disabled/);
  assert.match(html, /id="copy-briefing-im" type="button" disabled/);
  const normalizerStart = app.lastIndexOf("function normalizeBriefingPayload");
  const renderEnd = app.indexOf("async function generateDailyBriefing", normalizerStart);
  assert.ok(normalizerStart >= 0 && renderEnd > normalizerStart);
  const body = { hidden: true, innerHTML: "" };
  const archiveButton = { disabled: true };
  const copyButton = { disabled: true };
  const context = {
    document: {
      querySelector: (selector) => ({
        "#briefing-body": body,
        "#archive-briefing": archiveButton,
        "#copy-briefing-im": copyButton
      })[selector] || null
    },
    formatBusinessDateTime: () => "2026-09-19 10:00",
    escapeHtml: (value) => String(value)
  };
  vm.runInNewContext(app.slice(normalizerStart, renderEnd) + "\nthis.renderBriefing = renderBriefing;", context);
  context.renderBriefing({ game: "鸣潮", topics: [], todoSuggestions: [], feedback: {} });
  assert.equal(archiveButton.disabled, false);
  assert.equal(copyButton.disabled, false);
});

test("daily briefing archive failures describe a recovery action without exposing transport errors", () => {
  const archiveStart = app.indexOf("async function archiveCurrentBriefing");
  const archiveEnd = app.indexOf("function renderBriefArchiveItem", archiveStart);
  const historyStart = app.indexOf("async function loadBriefingArchive");
  const historyEnd = app.indexOf('document.querySelector("#generate-briefing")', historyStart);
  assert.ok(archiveStart >= 0 && archiveEnd > archiveStart && historyStart >= 0 && historyEnd > historyStart);
  const archiveSource = app.slice(archiveStart, archiveEnd);
  const historySource = app.slice(historyStart, historyEnd);
  assert.match(archiveSource, /简报状态：本机存档服务未连接/);
  assert.match(historySource, /简报状态：本机存档服务未连接/);
  assert.doesNotMatch(archiveSource, /存档失败（\$\{error\.message\}/);
  assert.doesNotMatch(historySource, /历史读取失败（" \+ error\.message/);
});

test("daily queue ignores stale concurrent refresh responses", () => {
  const start = app.indexOf("window.loadTodayTodos = async function loadTodayTodos");
  const end = app.indexOf("let llmModelName", start);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(app, /const todayTodosRequestGuard = createGenerationGuard\(\)/);
  assert.match(source, /todayTodosRequestGuard\.next\(\)/);
  assert.match(source, /todayTodosRequestGuard\.isCurrent\(/);
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

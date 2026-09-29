const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs.readFileSync(require.resolve("../app.js"), "utf8");

function loadCreatorImportHelpers() {
  const parserStart = appSource.indexOf("function splitCreatorLine(line) {");
  const parserEnd = appSource.indexOf("\nfunction getCreatorBriefInput()", parserStart);
  const tableStart = appSource.indexOf("function creatorRowsToText(rows) {");
  const tableEnd = appSource.indexOf("\nfunction getZipEntryMeta(buffer)", tableStart);
  assert.notEqual(parserStart, -1, "creator parser should exist in app.js");
  assert.notEqual(parserEnd, -1, "creator parser should have a clear end boundary");
  assert.notEqual(tableStart, -1, "creator table mapper should exist in app.js");
  assert.notEqual(tableEnd, -1, "creator table mapper should have a clear end boundary");

  const context = {
    normalizeCreatorHeader: (value) => String(value || "").toLowerCase().replace(/\s+/g, ""),
    parseMetricValue: (value) => Number.parseFloat(value) || 0,
    parseRateValue: (value) => Number.parseFloat(String(value).replace("%", "")) || 0,
    TextEncoder
  };
  vm.runInNewContext(`const MAX_CREATOR_IMPORT_ROWS = 1000; const MAX_CREATOR_IMPORT_BYTES = 10 * 1024 * 1024;\n${appSource.slice(parserStart, parserEnd)}\n${appSource.slice(tableStart, tableEnd)}\nthis.creatorRowsToText = creatorRowsToText; this.parseCreators = parseCreators;`, context);
  return context;
}

function sampleRows(count) {
  return Array.from({ length: count }, (_unused, index) => [
    `达人${index + 1}`,
    "B站",
    "100000",
    "50000",
    "5%",
    "攻略",
    "动作游戏",
    "高",
    "5000",
    "低"
  ]);
}

function loadInflater(DecompressionStream = globalThis.DecompressionStream) {
  const start = appSource.indexOf("async function inflateZipEntry(entry, maxBytes = MAX_CREATOR_XLSX_UNCOMPRESSED_BYTES) {");
  const end = appSource.indexOf("\nasync function readZipText(entries, fileName, budget)", start);
  assert.notEqual(start, -1, "XLSX inflater should exist in app.js");
  assert.notEqual(end, -1, "XLSX inflater should have a clear end boundary");
  const context = {
    MAX_CREATOR_XLSX_UNCOMPRESSED_BYTES: 24 * 1024 * 1024,
    Blob,
    Uint8Array,
    DecompressionStream
  };
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.inflateZipEntry = inflateZipEntry;`, context);
  return context.inflateZipEntry;
}

function loadDelimitedRowParser() {
  const start = appSource.indexOf("function parseDelimitedRows(text, delimiter, maxRows = Infinity) {");
  const end = appSource.indexOf("\nfunction normalizeCreatorHeader(value)", start);
  assert.notEqual(start, -1, "delimited parser should exist in app.js");
  assert.notEqual(end, -1, "delimited parser should have a clear end boundary");
  const context = {};
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.parseDelimitedRows = parseDelimitedRows;`, context);
  return context.parseDelimitedRows;
}

test("creator workspace starts empty until the user requests the demo list", () => {
  const initializeStart = appSource.indexOf("/* ---- 初始化 ---- */");
  const initializeEnd = appSource.indexOf("if (views.daily)", initializeStart);
  assert.ok(initializeStart >= 0 && initializeEnd > initializeStart);
  const initialization = appSource.slice(initializeStart, initializeEnd);

  assert.match(initialization, /analyzeCreators\(\);/);
  assert.doesNotMatch(initialization, /loadCreatorDemo\(\);/);
  const syncStart = initialization.indexOf("const initialCreatorGame =");
  const syncEnd = initialization.indexOf("\nanalyzeCreators();", syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  const creatorGame = { value: "" };
  const elements = {
    "#trending-game": { value: " 鸣潮 " },
    "#game-name": { value: "备用项目" },
    "#creator-game": creatorGame
  };
  vm.runInNewContext(initialization.slice(syncStart, syncEnd), {
    document: { querySelector: (selector) => elements[selector] || null },
    setFieldValue: (selector, value) => { if (elements[selector]) elements[selector].value = value; }
  });
  assert.equal(creatorGame.value, "鸣潮");
});

test("creator demo fields are only populated by the explicit sample action", () => {
  const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
  for (const id of ["creator-game", "creator-category", "creator-audience"]) {
    const field = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
    assert.ok(field, `${id} should exist`);
    assert.doesNotMatch(field, /\bvalue=/, `${id} must not start with stale demo values`);
  }

  const start = appSource.indexOf("function loadCreatorDemo() {");
  const end = appSource.indexOf("function exportCreatorCsv()", start);
  assert.ok(start >= 0 && end > start);
  const elements = {
    "#creator-game": { value: "鸣潮" },
    "#creator-category": { value: "" },
    "#creator-audience": { value: "" },
    "#creator-input": { value: "" }
  };
  const context = {
    creatorInputSource: "unverified",
    creatorDemoRows: "demo rows",
    document: { querySelector: (selector) => elements[selector] || null },
    setFieldValue: (selector, value) => { if (elements[selector]) elements[selector].value = value; },
    analyzeCreators() {}
  };
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.run = loadCreatorDemo;`, context);
  context.run();

  assert.equal(elements["#creator-game"].value, "巅峰极速");
  assert.equal(elements["#creator-category"].value, "赛车/竞速");
  assert.equal(elements["#creator-audience"].value, "竞速玩家");
  assert.equal(elements["#creator-input"].value, "demo rows");
  assert.equal(context.creatorInputSource, "sample");
});

test("demo creator rankings stay visibly marked as sample data after recalculation", () => {
  const start = appSource.indexOf("function analyzeCreators(rowsOverride = null) {");
  const end = appSource.indexOf("function loadCreatorDemo()", start);
  assert.ok(start >= 0 && end > start);
  const status = { textContent: "", className: "" };
  const elements = {
    "#creator-input": { value: "sample" },
    "#creator-goal": { value: "launch" },
    "#creator-activity": { value: "newLaunch" },
    "#creator-budget": { value: "80000" },
    "#creator-status": status,
    "#creator-summary": { textContent: "" },
    "#creator-score-explain": { textContent: "" }
  };
  const noop = () => {};
  const context = {
    currentCreatorRows: [],
    creatorInputSource: "sample",
    updateCreatorResultActions() {},
    document: {
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => []
    },
    numberValue: Number,
    parseCreators: () => ({ rows: [{ name: "演示达人" }], truncated: false }),
    getCreatorBriefInput: () => ({}),
    readCreatorLibrary: () => ({}),
    findCreatorProfile: () => ({ profile: null }),
    scoreCreator: (row) => ({ ...row, tier: "A" }),
    getCreatorHistoryScore: () => null,
    CREATOR_TIER: { A: "A", PENDING: "PENDING" },
    isEligibleCreator: () => true,
    compareCreatorPriority: () => 0,
    renderCreatorLibrary: noop,
    renderMetrics: noop,
    renderCreatorTable: noop,
    renderCreatorTiers: noop,
    renderCreatorScenarios: noop,
    renderCreatorBudgetPlans: noop,
    renderCreatorBriefs: noop,
    renderCreatorAnomalies: noop,
    renderCreatorRisks: noop,
    summarizeCreators: () => "summary",
    explainCreatorScore: () => "explanation"
  };
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.run = analyzeCreators;`, context);
  context.run();

  assert.match(status.textContent, /示例名单.*仅供功能演示.*不代表真实合作数据/);
  assert.match(status.className, /source-mock/);

  context.creatorInputSource = "unverified";
  context.run();
  assert.match(status.textContent, /名单来源未核验/);
  assert.match(status.className, /source-mock/);
});

test("creator profiles preserve provenance and legacy profiles remain unverified", () => {
  assert.match(appSource, /creator: \{[\s\S]{0,180}source: creatorInputSource/);
  assert.match(appSource, /creatorInputSource = resolveCreatorInputSource\(profile\.creator\?\.source\)/);
  const start = appSource.indexOf("function resolveCreatorInputSource(");
  const end = appSource.indexOf("\n}", start) + 2;
  const resolve = vm.runInNewContext(`(${appSource.slice(start, end).replace("function resolveCreatorInputSource", "function")})`);
  assert.equal(resolve("sample"), "sample");
  assert.equal(resolve("imported"), "imported");
  assert.equal(resolve(undefined), "unverified");
  assert.equal(resolve("unknown"), "unverified");
});

test("project snapshots preserve creator provenance and clear stale state for legacy snapshots", () => {
  const collectStart = appSource.indexOf("function collectProjectState() {");
  const restoreStart = appSource.indexOf("function restoreProjectState(", collectStart);
  const restoreEnd = appSource.indexOf("function isProjectStateRestorable(", restoreStart);
  const collect = appSource.slice(collectStart, restoreStart);
  const restore = appSource.slice(restoreStart, restoreEnd);
  assert.ok(collectStart >= 0 && restoreStart > collectStart && restoreEnd > restoreStart);
  assert.match(collect, /creatorInputSource,/);
  assert.match(restore, /creatorInputSource = resolveCreatorInputSource\(state\.creatorInputSource\)/);
});

test("edited creator inputs disable stale actions until the list is reanalyzed", () => {
  const start = appSource.indexOf("function creatorAnalysisMatchesInput()");
  const end = appSource.indexOf("function buildDemoStreamers()", start);
  assert.ok(start >= 0 && end > start);
  const saveButton = { disabled: false };
  const elements = {
    "#creator-input": { value: "new list" },
    "#creator-status": { textContent: "", className: "" },
    "#save-eligible-creators": saveButton
  };
  const buttons = [{ disabled: false }, { disabled: false }];
  const context = {
    analyzedCreatorInput: "old list",
    document: {
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => buttons
    }
  };
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.matches = creatorAnalysisMatchesInput; this.require = requireCurrentCreatorAnalysis; this.update = updateCreatorResultActions;`, context);

  assert.equal(context.matches(), false);
  context.update();
  assert.deepEqual(buttons.map((button) => button.disabled), [true, true]);
  assert.equal(saveButton.disabled, true);
  assert.equal(context.require("效果回填"), false);
  assert.match(elements["#creator-status"].textContent, /名单已修改.*点击“生成筛选表”/);

  context.analyzedCreatorInput = "new list";
  assert.equal(context.matches(), true);
  context.update();
  assert.deepEqual(buttons.map((button) => button.disabled), [false, false]);
  assert.equal(saveButton.disabled, false);
  const inputHandlerStart = appSource.indexOf('document.querySelector("#creator-input")?.addEventListener("input"');
  const inputHandlerEnd = appSource.indexOf('document.querySelector("#creator-goal")', inputHandlerStart);
  assert.match(appSource.slice(inputHandlerStart, inputHandlerEnd), /updateCreatorResultActions\(\)/);
});

test("stale creator results cannot create follow-ups or update backfill", async () => {
  const followUpStart = appSource.indexOf("async function addCreatorFollowUp(");
  const followUpEnd = appSource.indexOf("\n}", followUpStart) + 2;
  assert.ok(followUpStart >= 0 && followUpEnd > followUpStart);
  const status = { textContent: "", className: "" };
  let requests = 0;
  const guardedActions = [];
  const followUpContext = {
    requireCurrentCreatorAnalysis: (action) => { guardedActions.push(action); return false; },
    archivePanelSessionKey: "session",
    document: { querySelector: (selector) => selector === "#creator-status" ? status : { value: "鸣潮" } },
    isEligibleCreator: () => true,
    getActivityConfig: () => ({ label: "活动" }),
    ARCHIVE_SERVICE_URL: "http://localhost",
    archiveJsonRequestWithTimeout: async () => { requests += 1; throw new Error("blocked test request"); },
    archiveMutationFailure: () => "request failed"
  };
  vm.runInNewContext(`${appSource.slice(followUpStart, followUpEnd)}\nthis.run = addCreatorFollowUp;`, followUpContext);
  await followUpContext.run({ name: "旧名单达人" }, { disabled: false });
  assert.equal(requests, 0);
  assert.deepEqual(guardedActions, ["达人待办"]);

  const backfillStart = appSource.indexOf("function recalcWithBackfill() {");
  const backfillEnd = appSource.indexOf("\n}", backfillStart) + 2;
  const backfillSource = appSource.slice(backfillStart, backfillEnd);
  assert.match(backfillSource, /requireCurrentCreatorAnalysis\("效果回填"\)/);
  let parsedBackfills = 0;
  const backfillContext = {
    requireCurrentCreatorAnalysis: (action) => { guardedActions.push(action); return false; },
    document: { querySelector: (selector) => selector === "#creator-backfill" ? { value: "旧达人：100/3/中/1/500" } : status },
    parseCreatorBackfill: () => { parsedBackfills += 1; return []; }
  };
  vm.runInNewContext(`${backfillSource}\nthis.run = recalcWithBackfill;`, backfillContext);
  backfillContext.run();
  assert.equal(parsedBackfills, 0);
  assert.deepEqual(guardedActions, ["达人待办", "效果回填"]);

  const tableActions = appSource.slice(appSource.indexOf('document.querySelector("#creator-table")?.addEventListener("click"'), appSource.indexOf('document.querySelector("#export-creator-library")'));
  const batchSave = appSource.slice(appSource.indexOf('document.querySelector("#save-eligible-creators")?.addEventListener("click"'), appSource.indexOf('document.querySelector("#export-creator-library")'));
  assert.match(tableActions, /requireCurrentCreatorAnalysis\("个人库操作"\)/);
  assert.match(batchSave, /requireCurrentCreatorAnalysis\("批量保存"\)/);
});

test("full operation reports do not reuse backfilled rows after the input list changes", () => {
  const start = appSource.indexOf("function buildFullOperationReportText() {");
  const end = appSource.indexOf("\n  const game =", start);
  assert.ok(start >= 0 && end > start);
  const reportSetup = appSource.slice(start, end);
  assert.match(reportSetup, /const hasBackfillRows = creatorAnalysisMatchesInput\(\) && currentCreatorRows\.some/);
  const analyzeStart = reportSetup.indexOf("const hasBackfillRows =");
  const calls = [];
  const context = {
    currentCreatorRows: [{ name: "旧达人", dataSource: "backfill" }],
    creatorAnalysisMatchesInput: () => false,
    analyzeCreators: (rows) => calls.push(rows)
  };
  vm.runInNewContext(`${reportSetup.slice(analyzeStart)}\nthis.result = hasBackfillRows;`, context);
  assert.equal(context.result, false);
  assert.deepEqual(calls, [null]);
});

test("full operation reports surface unverified creator source data", () => {
  const reportStart = appSource.indexOf("function buildFullOperationReportText() {");
  const sourceStart = appSource.indexOf("const sourceTexts =", reportStart);
  const end = appSource.indexOf("const date = businessDate();", sourceStart);
  assert.ok(reportStart >= 0 && sourceStart > reportStart && end > sourceStart);
  const context = {
    currentHotspots: [],
    currentTrendingTopics: [],
    document: {
      querySelector: (selector) => selector === "#creator-status"
        ? { textContent: "达人来源：已识别 1 位达人；名单来源未核验，请确认后再用于决策。" }
        : null
    }
  };
  vm.runInNewContext(`${appSource.slice(sourceStart, end)}\nthis.result = dataQuality;`, context);
  assert.match(context.result, /KOL\/KOC.*名单来源未核验/);
  assert.doesNotMatch(context.result, /未检测到样例兜底标记/);
});

test("demo readiness ignores creator rows whose source input is stale", () => {
  const start = appSource.indexOf("async function runDemoReadinessCheck() {");
  const end = appSource.indexOf("\nasync function tryRecognizeScreenshot", start);
  assert.ok(start >= 0 && end > start);
  const readiness = appSource.slice(start, end);
  const setupEnd = readiness.indexOf("const hasReviewData =");
  assert.ok(setupEnd > 0);
  const readinessSetup = readiness.slice(0, setupEnd);
  const creatorStateStart = readinessSetup.indexOf("const creatorInputFresh =");
  assert.ok(creatorStateStart >= 0);
  const creatorState = readinessSetup.slice(creatorStateStart);
  assert.match(readiness, /hasStaleCreatorInput[\s\S]*名单已修改.*重新生成筛选表/);
  const evaluate = (fresh, rows, analyzedInput) => JSON.parse(JSON.stringify(vm.runInNewContext(
    `${creatorState}\nthis.result = { creatorInputFresh, hasCreators, hasStaleCreatorInput };`,
    { creatorAnalysisMatchesInput: () => fresh, currentCreatorRows: rows, analyzedCreatorInput: analyzedInput }
  )));
  assert.deepEqual(evaluate(false, [{ name: "旧达人" }], "旧名单"), { creatorInputFresh: false, hasCreators: false, hasStaleCreatorInput: true });
  assert.deepEqual(evaluate(true, [{ name: "当前达人" }], "当前名单"), { creatorInputFresh: true, hasCreators: true, hasStaleCreatorInput: false });
  assert.deepEqual(evaluate(false, [], null), { creatorInputFresh: false, hasCreators: false, hasStaleCreatorInput: false });
});

test("creator import accepts exactly 1000 rows without reporting truncation", () => {
  const helpers = loadCreatorImportHelpers();
  const parsed = helpers.parseCreators(helpers.creatorRowsToText(sampleRows(1000)));

  assert.equal(parsed.rows.length, 1000);
  assert.equal(parsed.rows[0].name, "达人1");
  assert.equal(parsed.rows[999].name, "达人1000");
  assert.equal(parsed.truncated, false);
});

test("creator CSV export and reimport preserve content type instead of the creator tier", () => {
  const helpers = loadCreatorImportHelpers();
  const parseDelimitedRows = loadDelimitedRowParser();
  const rows = [
    ["达人名", "平台", "账号ID", "主页链接", "类型", "粉丝数", "平均播放", "互动率", "内容类型", "历史游戏品类", "评论质量", "预估报价", "实际成本", "商单密度"],
    ["达人甲", "B站", "uid-001", "https://space.bilibili.com/10001", "垂类 KOC", "100000", "10000", "5%", "攻略", "动作游戏", "高", "1000", "800", "低"]
  ];
  const csvText = rows.map((row) => row.map((value) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\r\n");
  const importedText = helpers.creatorRowsToText(parseDelimitedRows(csvText, ","));
  const imported = helpers.parseCreators(importedText);

  assert.equal(imported.rows[0].contentType, "攻略");
});

test("creator import caps 1001 rows and explicitly reports truncation", () => {
  const helpers = loadCreatorImportHelpers();
  const importText = helpers.creatorRowsToText(sampleRows(1001));
  const parsed = helpers.parseCreators(importText);

  assert.equal(parsed.rows.length, 1000);
  assert.equal(parsed.rows[999].name, "达人1000");
  assert.equal(parsed.truncated, true);
  assert.equal(importText.split(/\n+/).filter(Boolean).length, 1002);
});

test("creator import bounds line allocation while reading a large row count", () => {
  const { parseCreators } = loadCreatorImportHelpers();
  const line = "达人,B站,100000,50000,5%,攻略,动作游戏,高,5000,低";
  const parsed = parseCreators(Array(50000).fill(line).join("\n"));

  assert.equal(parsed.rows.length, 1000);
  assert.equal(parsed.truncated, true);
});

test("creator spreadsheet mapping stops after the truncation sentinel row", () => {
  const { creatorRowsToText } = loadCreatorImportHelpers();
  const rows = sampleRows(5000);
  rows[2000] = { map() { throw new Error("rows after the import cap should not be visited"); } };

  const mapped = creatorRowsToText(rows);
  assert.equal(mapped.split(/\n+/).filter(Boolean).length, 1002);
});

test("creator CSV parsing stops after the row cap without changing generic parser defaults", () => {
  const parseDelimitedRows = loadDelimitedRowParser();
  const line = "达人,B站,100000,50000";
  const bounded = parseDelimitedRows(Array(50000).fill(line).join("\n"), ",", 1002);
  const ordinary = parseDelimitedRows("主播A,10\n主播B,20", ",");

  assert.equal(bounded.length, 1002);
  assert.equal(ordinary.length, 2);
});

test("manual creator input rejects oversized text before splitting it into rows", () => {
  const { parseCreators } = loadCreatorImportHelpers();
  const oversizedAscii = parseCreators("x".repeat(10 * 1024 * 1024 + 1));
  const oversizedUtf8 = parseCreators("界".repeat(Math.floor((10 * 1024 * 1024) / 3) + 1));

  assert.equal(oversizedAscii.rows.length, 0);
  assert.match(oversizedAscii.error, /超过 10 MiB/);
  assert.equal(oversizedUtf8.rows.length, 0);
  assert.match(oversizedUtf8.error, /超过 10 MiB/);
});

test("creator XLSX import rejects stored entries above the decompressed-data limit", async () => {
  const inflateZipEntry = loadInflater();
  await assert.rejects(
    inflateZipEntry({ method: 0, bytes: new Uint8Array(5) }, 4),
    /XLSX 解压后数据超过 24 MiB/
  );
});

test("creator XLSX import stops reading a deflate stream when its byte budget is exceeded", async () => {
  class ExpandingDecompressionStream {
    constructor() {
      return new TransformStream({
        transform(_chunk, controller) {
          controller.enqueue(new Uint8Array(8));
          controller.enqueue(new Uint8Array(8));
          controller.enqueue(new Uint8Array(8));
        }
      });
    }
  }
  const inflateZipEntry = loadInflater(ExpandingDecompressionStream);

  await assert.rejects(
    inflateZipEntry({ method: 8, bytes: new Uint8Array([1]) }, 16),
    /XLSX 解压后数据超过 24 MiB/
  );
});

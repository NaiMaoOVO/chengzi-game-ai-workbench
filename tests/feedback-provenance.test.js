const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("briefing quality uses comment-content provenance, not service health styling", () => {
  const collectStart = app.indexOf("function collectBriefingData() {");
  const collectEnd = app.indexOf("function buildBriefingTodos(", collectStart);
  const collect = app.slice(collectStart, collectEnd);

  assert.notEqual(collectStart, -1);
  assert.notEqual(collectEnd, -1);
  assert.match(collect, /currentFeedbackDataSource === "real"/);
  assert.match(collect, /currentFeedbackDataSource === "sample"/);
  assert.match(collect, /currentFeedbackDataSource === "unverified"/);
  assert.doesNotMatch(collect, /feedbackStatus\?\.classList/);
  assert.match(collect, /dataSource: hasRealData && !usesSample && !hasUnverifiedFeedback \? "real" : "sample"/);
  assert.match(collect, /评论来源未核验/);
});

test("service health checks do not rewrite the imported comment source", () => {
  const checkStart = app.indexOf("async function checkCommentServices() {");
  const checkEnd = app.indexOf("async function fetchHotVideoComments(", checkStart);
  const check = app.slice(checkStart, checkEnd);

  assert.notEqual(checkStart, -1);
  assert.notEqual(checkEnd, -1);
  assert.doesNotMatch(check, /currentFeedbackDataSource\s*=/);
  assert.match(check, /querySelector\("#comment-services-status"\)/);
  assert.doesNotMatch(check, /querySelector\("#feedback-source-status"\)/);
  assert.match(app, /addEventListener\("input", \(event\) => \{\s*currentFeedbackDataSource = "unverified";[\s\S]*评论来源：内容已手动修改，当前来源未核验/);
  assert.match(html, /当前评论内容为演示样例；手动编辑后来源标为未核验/);
  assert.match(html, /id="comment-services-status" aria-live="polite"/);
});

test("comment imports explicitly mark fetched records real and fallbacks as samples", () => {
  const importCalls = [...app.matchAll(/importFeedbackComments\(([^\n]+)\)/g)]
    .map((match) => match[0])
    .filter((call) => !call.startsWith("importFeedbackComments(comments, source"));

  assert.ok(importCalls.some((call) => /importFeedbackComments\(comments, "real"\)/.test(call)));
  assert.ok(importCalls.some((call) => /importFeedbackComments\(allComments, "real"\)/.test(call)));
  assert.ok(importCalls.length > 0 && importCalls.every((call) => /"(?:real|sample)"\)/.test(call)));
});

test("feedback CSV keeps verification status for real, sample and manually edited comments", () => {
  const start = app.indexOf("function exportFeedbackAnalysis() {");
  const end = app.indexOf("/* ========================================\n   模块3：活动复盘", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const exporter = app.slice(start, end);
  const exportRows = (source) => vm.runInNewContext(`(() => {
    let currentFeedbackRows = [{ source: "测试视频", comment: "测试评论", categories: ["玩法反馈"], sentiment: "中性", risk: "正常" }];
    const currentFeedbackDataSource = ${JSON.stringify(source)};
    let capturedRows = [];
    function analyzeFeedback() {}
    function businessDate() { return "2026-09-27"; }
    function toCsv(rows) { capturedRows = rows; return "csv"; }
    function downloadFile() {}
    ${exporter}
    exportFeedbackAnalysis();
    return capturedRows;
  })()`);

  assert.deepEqual(Array.from(exportRows("real")[0]), ["来源", "来源核验", "评论", "标签", "情绪", "风险"]);
  assert.equal(exportRows("real")[1][1], "真实平台数据");
  assert.equal(exportRows("sample")[1][1], "演示样例");
  assert.equal(exportRows("unverified")[1][1], "来源未核验");
});

test("project snapshots preserve a valid comment source and legacy snapshots stay unverified", () => {
  const collectStart = app.indexOf("function collectProjectState() {");
  const collectEnd = app.indexOf("function restoreProjectState(", collectStart);
  const restoreStart = collectEnd;
  const restoreEnd = app.indexOf("function saveProjectState(", restoreStart);
  const collect = app.slice(collectStart, collectEnd);
  const restore = app.slice(restoreStart, restoreEnd);
  assert.ok(collectStart >= 0 && collectEnd > collectStart && restoreEnd > restoreStart);
  assert.match(collect, /feedbackDataSource:[\s\S]*currentFeedbackDataSource/);
  assert.match(restore, /state\.feedbackDataSource/);
  assert.match(restore, /currentFeedbackSourceInput = feedbackInputValue/);
  assert.match(restore, /已从本机项目快照恢复/);

  const helperStart = app.indexOf("function resolveFeedbackDataSource(");
  const helperEnd = app.indexOf("\n}", helperStart) + 2;
  const resolve = vm.runInNewContext(`(${app.slice(helperStart, helperEnd).replace("function resolveFeedbackDataSource", "function")})`);
  assert.equal(resolve("real", true), "real");
  assert.equal(resolve("sample", true), "sample");
  assert.equal(resolve("unverified", true), "unverified");
  assert.equal(resolve(undefined, true), "unverified");
  assert.equal(resolve("real", false), "unverified");
  assert.match(app, /currentFeedbackDataSource = "sample";\s*currentFeedbackSourceInput = document\.querySelector\("#feedback-input"\)\?\.value \|\| "";\s*const feedbackSourceStatus/);
  assert.match(app, /评论来源：已载入内置演示样例/);
});

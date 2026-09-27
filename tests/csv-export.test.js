const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../utils.js"), "utf8");
const start = source.indexOf("function toCsv(");
const end = source.indexOf("\nfunction downloadFile(", start);
assert.ok(start >= 0 && end > start, "toCsv source should be present");
const toCsv = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test("CSV export neutralizes spreadsheet formulas in untrusted text", () => {
  const csv = toCsv([["=HYPERLINK(\"https://example.com\")", "  +SUM(1,2)", "\t@SUM(1,2)", "-1+2"]]);
  assert.equal(csv, '"\'=HYPERLINK(""https://example.com"")","\'  +SUM(1,2)","\'\t@SUM(1,2)","\'-1+2"');
});

test("CSV export preserves numeric values and quotes ordinary text", () => {
  assert.equal(toCsv([[-12, "-12.5%", "普通文本", "含\"引号\""]]), '"-12","-12.5%","普通文本","含""引号"""');
});

test("file downloads attach the link and defer cleanup until after the click", () => {
  const downloadStart = source.indexOf("function downloadFile(");
  const downloadEnd = source.indexOf("\nfunction formatChange(", downloadStart);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart);
  const events = [];
  const downloadFile = vm.runInNewContext(`(${source.slice(downloadStart, downloadEnd).trim()})`, {
    Blob: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: {
      createObjectURL: () => "blob:export",
      revokeObjectURL: (url) => events.push(["revoke", url])
    },
    document: {
      body: { appendChild: (link) => events.push(["append", link]) },
      createElement: () => ({ style: {}, remove() { events.push(["remove", this]); }, click() { events.push(["click", this]); } })
    },
    events,
    setTimeout: (callback, delay) => events.push(["schedule", callback, delay])
  });
  downloadFile("export.csv", "content", "text/csv");
  assert.deepEqual(events.map(([name]) => name), ["append", "click", "schedule"]);
  assert.equal(events[0][1].href, "blob:export");
  assert.equal(events[0][1].download, "export.csv");
  assert.equal(events[2][2], 1000);
  events[2][1]();
  assert.deepEqual(events.slice(3).map(([name]) => name), ["remove", "revoke"]);
});

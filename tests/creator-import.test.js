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

test("creator import accepts exactly 1000 rows without reporting truncation", () => {
  const helpers = loadCreatorImportHelpers();
  const parsed = helpers.parseCreators(helpers.creatorRowsToText(sampleRows(1000)));

  assert.equal(parsed.rows.length, 1000);
  assert.equal(parsed.rows[0].name, "达人1");
  assert.equal(parsed.rows[999].name, "达人1000");
  assert.equal(parsed.truncated, false);
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

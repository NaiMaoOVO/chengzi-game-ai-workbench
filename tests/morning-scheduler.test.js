const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const archive = fs.readFileSync(path.join(__dirname, "..", "archive-server.js"), "utf8");

test("morning fetch uses Shanghai business time and persistent per-game run records", () => {
  assert.match(archive, /businessDate\(now\)/);
  assert.match(archive, /businessTime\(now\)/);
  assert.match(archive, /CREATE TABLE IF NOT EXISTS morning_runs/);
  assert.match(archive, /owner_key TEXT NOT NULL DEFAULT 'default'/);
  assert.match(archive, /PRIMARY KEY \(owner_key, run_date, game, platform\)/);
  assert.match(archive, /ON CONFLICT\(owner_key, run_date, game, platform\)/);
  assert.match(archive, /function listMorningRuns\(url, ownerKey\)/);
  assert.match(archive, /FROM morning_runs WHERE owner_key = \?/);
  assert.match(archive, /INSERT OR IGNORE INTO snapshots/);
});

test("a failed morning-run claim is isolated to one game", async () => {
  const start = archive.indexOf("async function runMorningFetch(");
  const end = archive.indexOf("\nsetInterval(() => {", start);
  assert.ok(start >= 0 && end > start);
  const completed = [];
  const failures = [];
  const runMorningFetch = vm.runInNewContext(`(() => {
    ${archive.slice(start, end)}
    return runMorningFetch;
  })()`, {
    MORNING_GAMES: ["鸣潮", "绝区零"],
    MORNING_PLATFORM: "B站",
    HOTSPOT_SOURCE_URL: "http://127.0.0.1:8790",
    claimMorningRun: (_date, game) => {
      if (game === "鸣潮") throw new Error("database busy");
      return true;
    },
    URLSearchParams,
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ source: "sample", items: [] }) }),
    insertMorningSnapshotStatement: { run: (...args) => completed.push(args) },
    recordOwner: () => "user:1",
    finishMorningRun: (_date, game, _platform, status) => {
      failures.push({ game, status });
      if (game === "鸣潮" && status === "failed") throw new Error("database still busy");
    },
    console: { error: () => {}, log: () => {} }
  });
  await runMorningFetch("2026-09-29");
  assert.deepEqual(failures, [
    { game: "鸣潮", status: "failed" },
    { game: "绝区零", status: "success" }
  ]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0][2], "绝区零");
});

test("unexpected scheduled morning errors are contained and logged", async () => {
  const start = archive.indexOf("async function launchMorningFetch(");
  const end = archive.indexOf("\nsetInterval(() => {", start);
  assert.ok(start >= 0 && end > start);
  const errors = [];
  const launchMorningFetch = vm.runInNewContext(`(() => {
    ${archive.slice(start, end)}
    return launchMorningFetch;
  })()`, {
    runMorningFetch: async () => { throw new Error("unexpected database error"); },
    console: { error: (message) => errors.push(message) }
  });
  await assert.doesNotReject(() => launchMorningFetch("2026-09-29"));
  assert.match(errors[0], /服务继续运行.*unexpected database error/);
});

test("archive statistics group snapshots by the Shanghai business date", () => {
  assert.match(archive, /function dayKey\(iso\) \{\s+return businessDate\(new Date\(iso\)\);/);
  assert.match(archive, /businessDateStart\(new Date\(\), days - 1\)\.toISOString\(\)/);
  assert.doesNotMatch(archive, /function dayKey\(iso\) \{\s+return String\(iso\)\.slice\(0, 10\);/);
});

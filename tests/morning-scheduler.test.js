const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("archive statistics group snapshots by the Shanghai business date", () => {
  assert.match(archive, /function dayKey\(iso\) \{\s+return businessDate\(new Date\(iso\)\);/);
  assert.doesNotMatch(archive, /function dayKey\(iso\) \{\s+return String\(iso\)\.slice\(0, 10\);/);
});

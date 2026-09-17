const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const archive = fs.readFileSync(path.join(__dirname, "..", "archive-server.js"), "utf8");

test("morning fetch uses Shanghai business time and persistent per-game run records", () => {
  assert.match(archive, /businessDate\(now\)/);
  assert.match(archive, /businessTime\(now\)/);
  assert.match(archive, /CREATE TABLE IF NOT EXISTS morning_runs/);
  assert.match(archive, /INSERT OR IGNORE INTO snapshots/);
});

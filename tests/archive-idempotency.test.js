const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const archive = fs.readFileSync(path.join(__dirname, "..", "archive-server.js"), "utf8");

test("legacy unmodified archive rows receive request fingerprints without changing their content", () => {
  const stableStart = archive.indexOf("function stableJsonValue(value)");
  const stableEnd = archive.indexOf("function storedRequestMatches", stableStart);
  const backfillStart = archive.indexOf("function backfillRequestFingerprints()");
  const backfillEnd = archive.indexOf("\nbackfillRequestFingerprints();", backfillStart);
  assert.ok(stableStart >= 0 && stableEnd > stableStart);
  assert.ok(backfillStart >= 0 && backfillEnd > backfillStart);

  const rows = {
    snapshots: [
      { id: 1, kind: "feedback", game: "鸣潮", source: "real", payload: JSON.stringify({ title: "保留内容" }) },
      { id: 2, kind: "feedback", game: "鸣潮", source: "real", payload: "损坏 JSON" }
    ],
    publications: [{ id: 3, game: "鸣潮", title: "发布", channel: "B站", url: "", related_topic: "", published_at: null, metrics_json: "{}" }],
    risk_events: [{ id: 4, game: "鸣潮", title: "风险", source: "评论分析", url: "", detail: "", level: "中", status: "open" }],
    daily_todos: [{ id: 5, game: "鸣潮", title: "待办", priority: "medium", status: "open", due_date: null, notes: "", source: "manual", link_view: "" }]
  };
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      const table = /(?:FROM|UPDATE) (\w+)/.exec(sql)?.[1];
      return sql.startsWith("SELECT")
        ? { all: () => rows[table] }
        : { run: (fingerprint, id) => statements.push({ table, fingerprint, id }) };
    }
  };
  const helperSource = `${archive.slice(stableStart, stableEnd)}\n${archive.slice(backfillStart, backfillEnd)}`;
  const backfill = vm.runInNewContext(`(() => { ${helperSource}; return backfillRequestFingerprints; })()`, {
    crypto,
    db,
    parseStoredObject(value) {
      try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { value: parsed, valid: true } : { value: {}, valid: false };
      } catch (_error) {
        return { value: {}, valid: false };
      }
    }
  });

  backfill();
  const updates = statements.filter((statement) => typeof statement === "object");
  assert.deepEqual(updates.map(({ table, id }) => [table, id]), [
    ["snapshots", 1],
    ["publications", 3],
    ["risk_events", 4],
    ["daily_todos", 5]
  ]);
  assert.ok(updates.every(({ fingerprint }) => /^[a-f0-9]{64}$/.test(fingerprint)));
  assert.match(statements.find((statement) => typeof statement === "string" && statement.startsWith("SELECT") && statement.includes("FROM publications")), /created_at = updated_at/);
  assert.match(statements.find((statement) => typeof statement === "string" && statement.startsWith("SELECT") && statement.includes("FROM risk_events")), /created_at = updated_at/);
  assert.match(statements.find((statement) => typeof statement === "string" && statement.startsWith("SELECT") && statement.includes("FROM daily_todos")), /created_at = updated_at/);
});

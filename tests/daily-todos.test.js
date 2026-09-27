const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19712;
const databasePath = path.join(os.tmpdir(), "gameops-daily-todos-" + process.pid + "-" + Date.now() + ".db");

function httpRequest(requestPath, options) {
  const { method = "GET", headers = {}, body = null } = options || {};
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: requestPath, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8")
        }));
      }
    );
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}

async function waitForHealth(timeoutMs) {
  const deadline = timeoutMs || 10000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + PORT + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch (_error) { /* retry until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("服务未能在 " + deadline + "ms 内就绪（端口 " + PORT + "）");
}

const child = spawn(process.execPath, [path.join(projectRoot, "archive-server.js")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ARCHIVE_PORT: String(PORT),
    ARCHIVE_DB_PATH: databasePath,
    MORNING_GAMES: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderrText = "";
child.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });

test.before(async () => {
  try {
    await waitForHealth();
  } catch (error) {
    assert.fail(error.message + "\nstderr: " + stderrText.slice(-800));
  }
});

test.after(async () => {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
});

function postDailyTodo(bodyObject) {
  return httpRequest("/daily-todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObject)
  });
}

test("daily todos support create, list, complete, and reopen", async () => {
  const created = await postDailyTodo({
    game: "鸣潮",
    title: "跟进高风险舆情",
    priority: "high",
    due_date: "2026-09-03",
    source: "manual",
    link_view: "feedback",
    notes: "来自每日工作台"
  });
  assert.equal(created.status, 201);
  const createPayload = JSON.parse(created.text);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.daily_todo.game, "鸣潮");
  assert.equal(createPayload.daily_todo.priority, "high");
  assert.equal(createPayload.daily_todo.status, "open");
  assert.equal(createPayload.daily_todo.link_view, "feedback");

  const done = await httpRequest("/daily-todos/" + createPayload.daily_todo.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(done.status, 200);
  const donePayload = JSON.parse(done.text);
  assert.equal(donePayload.daily_todo.status, "done");
  assert.ok(donePayload.daily_todo.completed_at);
  assert.equal(donePayload.daily_todo.title, "跟进高风险舆情");

  const reopened = await httpRequest("/daily-todos/" + createPayload.daily_todo.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "open" })
  });
  assert.equal(JSON.parse(reopened.text).daily_todo.completed_at, null);

  const clearedDueDate = await httpRequest("/daily-todos/" + createPayload.daily_todo.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ due_date: null })
  });
  assert.equal(clearedDueDate.status, 200);
  assert.equal(JSON.parse(clearedDueDate.text).daily_todo.due_date, null);

  const listed = JSON.parse((await httpRequest("/daily-todos?game=" + encodeURIComponent("鸣潮") + "&status=open")).text);
  assert.equal(listed.ok, true);
  assert.equal(listed.items.some((item) => item.id === createPayload.daily_todo.id), true);
});

test("daily todo validation rejects invalid fields and missing records", async () => {
  const missing = await postDailyTodo({});
  assert.equal(missing.status, 400);
  assert.match(JSON.parse(missing.text).error, /game/);

  const badPriority = await postDailyTodo({ game: "鸣潮", title: "测试", priority: "urgent" });
  assert.equal(badPriority.status, 400);
  assert.match(JSON.parse(badPriority.text).error, /priority/);

  const badDate = await postDailyTodo({ game: "鸣潮", title: "测试", due_date: "09/03/2026" });
  assert.equal(badDate.status, 400);
  assert.match(JSON.parse(badDate.text).error, /due_date/);

  const badDateType = await postDailyTodo({ game: "鸣潮", title: "测试", due_date: 20260903 });
  assert.equal(badDateType.status, 400);
  assert.match(JSON.parse(badDateType.text).error, /due_date/);

  const impossibleDate = await postDailyTodo({ game: "鸣潮", title: "测试", due_date: "2026-02-30" });
  assert.equal(impossibleDate.status, 400);
  assert.match(JSON.parse(impossibleDate.text).error, /due_date/);

  const tooLongTitle = await postDailyTodo({ game: "鸣潮", title: "x".repeat(201) });
  assert.equal(tooLongTitle.status, 400);
  assert.match(JSON.parse(tooLongTitle.text).error, /title/);

  const missingUpdate = await httpRequest("/daily-todos/999999", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(missingUpdate.status, 404);
});

test("daily todo enum fields reject explicit non-string values instead of defaulting", async () => {
  for (const [field, value] of [["priority", 7], ["status", { value: "done" }], ["link_view", ["feedback"]]]) {
    const response = await postDailyTodo({ game: "鸣潮", title: "枚举字段校验", [field]: value });
    assert.equal(response.status, 400, field + " must reject a non-string value");
    assert.match(JSON.parse(response.text).error, new RegExp(field));
  }

  const created = JSON.parse((await postDailyTodo({ game: "鸣潮", title: "待办更新类型校验" })).text).daily_todo;
  for (const [field, value] of [["priority", null], ["status", { value: "done" }]]) {
    const response = await httpRequest("/daily-todos/" + created.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value })
    });
    assert.equal(response.status, 400, field + " updates must reject a non-string value");
    assert.match(JSON.parse(response.text).error, new RegExp(field));
  }
});

test("daily todo updates reject explicit non-string text instead of reporting a no-op as success", async () => {
  const created = JSON.parse((await postDailyTodo({ game: "鸣潮", title: "修复待办" })).text).daily_todo;
  const updated = await httpRequest("/daily-todos/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: { text: "被静默丢弃" } })
  });
  assert.equal(updated.status, 400);
  assert.match(JSON.parse(updated.text).error, /title/);

  const listed = JSON.parse((await httpRequest("/daily-todos?game=" + encodeURIComponent("鸣潮"))).text);
  assert.equal(listed.items.find((item) => item.id === created.id).title, "修复待办");
});

test("daily todo retries with one idempotency key create only one row", async () => {
  const headers = { "Content-Type": "application/json", "Idempotency-Key": "daily-retry-20260916" };
  const body = JSON.stringify({ game: "鸣潮", title: "网络重试不能重复创建" });
  const first = await httpRequest("/daily-todos", { method: "POST", headers, body });
  const second = await httpRequest("/daily-todos", { method: "POST", headers, body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const firstTodo = JSON.parse(first.text).daily_todo;
  const secondPayload = JSON.parse(second.text);
  assert.equal(secondPayload.idempotent, true);
  assert.equal(secondPayload.daily_todo.id, firstTodo.id);
  const listed = JSON.parse((await httpRequest("/daily-todos?game=" + encodeURIComponent("鸣潮"))).text);
  assert.equal(listed.items.filter((item) => item.title === "网络重试不能重复创建").length, 1);
});

test("daily todo create storage errors return 500 without leaking database details", async () => {
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TRIGGER reject_daily_todo_insert BEFORE INSERT ON daily_todos BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  db.close();

  const response = await httpRequest("/daily-todos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "daily-storage-failure-20260927" },
    body: JSON.stringify({ game: "数据库写故障样本", title: "存储异常保护" })
  });
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.text), { ok: false, error: "待办暂时无法保存，请稍后重试" });
  assert.doesNotMatch(response.text, /blocked|sqlite/i);
  assert.equal((await httpRequest("/health")).status, 200);
  const after = JSON.parse((await httpRequest("/daily-todos?game=" + encodeURIComponent("数据库写故障样本"))).text);
  assert.equal(after.items.length, 0, "失败的创建不应留下待办");
});

test("daily todo update storage errors return 500 and preserve the existing row", async () => {
  const db = new DatabaseSync(databasePath);
  db.exec("DROP TRIGGER IF EXISTS reject_daily_todo_insert;");
  db.close();

  const created = JSON.parse((await postDailyTodo({ game: "鸣潮", title: "待办更新故障保护" })).text).daily_todo;
  const triggerDb = new DatabaseSync(databasePath);
  triggerDb.exec("CREATE TRIGGER reject_daily_todo_update BEFORE UPDATE ON daily_todos BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  triggerDb.close();

  const response = await httpRequest("/daily-todos/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.text), { ok: false, error: "待办暂时无法更新，请稍后重试" });
  assert.doesNotMatch(response.text, /blocked|sqlite/i);
  assert.equal((await httpRequest("/health")).status, 200);
  const after = JSON.parse((await httpRequest("/daily-todos?game=" + encodeURIComponent("鸣潮"))).text);
  assert.equal(after.items.find((item) => item.id === created.id).status, "open");
});

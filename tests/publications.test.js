const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19711;
const databasePath = path.join(os.tmpdir(), "gameops-publications-" + process.pid + "-" + Date.now() + ".db");

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

function postPublication(bodyObject) {
  return httpRequest("/publications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObject)
  });
}

test("health identity is unchanged by the publications ledger", async (t) => {
  t.diagnostic("health 契约：ok + service 不变，storage 仍指向隔离的临时数据文件");
  const payload = JSON.parse((await httpRequest("/health")).text);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "gameops-archive");
  assert.match(payload.storage, /^gameops-publications-\d+-\d+\.db$/);
  const live = JSON.parse((await httpRequest("/live")).text);
  assert.equal(live.service, "gameops-archive");
  const readyResponse = await httpRequest("/ready");
  const ready = JSON.parse(readyResponse.text);
  assert.equal(readyResponse.status, 200);
  assert.equal(ready.ready, true);
  assert.equal(ready.service, "gameops-archive");
});

test("create -> list roundtrip keeps fields and parses metrics into objects", async () => {
  const created = await postPublication({
    game: "鸣潮",
    title: "2.0 版本前瞻动态",
    channel: "B站",
    url: "https://www.bilibili.com/video/BVdemo001",
    related_topic: "版本前瞻爆料",
    published_at: "2026-05-20T10:00:00.000Z",
    metrics_json: { views: 12000, likes: 800 }
  });
  assert.equal(created.status, 201);
  const createPayload = JSON.parse(created.text);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.publication.game, "鸣潮");
  assert.equal(createPayload.publication.channel, "B站");
  assert.equal(createPayload.publication.url, "https://www.bilibili.com/video/BVdemo001");
  assert.equal(createPayload.publication.related_topic, "版本前瞻爆料");
  assert.equal(createPayload.publication.published_at, "2026-05-20T10:00:00.000Z");
  assert.deepEqual(createPayload.publication.metrics_json, { views: 12000, likes: 800 });
  assert.equal(typeof createPayload.publication.created_at, "string");

  const listed = await httpRequest("/publications?game=" + encodeURIComponent("鸣潮") + "&channel=B%E7%AB%99&limit=5&offset=0");
  assert.equal(listed.status, 200);
  const listPayload = JSON.parse(listed.text);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.total >= 1, true);
  const match = listPayload.items.find((item) => item.id === createPayload.publication.id);
  assert.ok(match, "创建的记录应出现在过滤结果中");
  assert.deepEqual(match.metrics_json, { views: 12000, likes: 800 });

  const otherChannel = await httpRequest("/publications?game=" + encodeURIComponent("鸣潮") + "&channel=" + encodeURIComponent("抖音"));
  assert.equal(JSON.parse(otherChannel.text).items.some((item) => item.id === createPayload.publication.id), false);
});

test("publication retries with one idempotency key create only one ledger row", async () => {
  const headers = { "Content-Type": "application/json", "Idempotency-Key": "publication-retry-20260916" };
  const body = JSON.stringify({ game: "鸣潮", title: "版本内容回流", channel: "B站" });
  const first = await httpRequest("/publications", { method: "POST", headers, body });
  const second = await httpRequest("/publications", { method: "POST", headers, body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const firstPublication = JSON.parse(first.text).publication;
  const secondPayload = JSON.parse(second.text);
  assert.equal(secondPayload.idempotent, true);
  assert.equal(secondPayload.publication.id, firstPublication.id);
  const listed = JSON.parse((await httpRequest("/publications?game=" + encodeURIComponent("鸣潮"))).text);
  assert.equal(listed.items.filter((item) => item.title === "版本内容回流").length, 1);
});

test("update accepts metrics object, persists string storage, returns parsed object", async () => {
  const created = JSON.parse((await postPublication({
    game: "巅峰极速",
    title: "新赛季预告",
    channel: "小红书",
    related_topic: "新车爆料"
  })).text).publication;

  const updated = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metrics_json: { views: 3400 }, url: "https://www.xiaohongshu.com/explore/demo" })
  });
  assert.equal(updated.status, 200);
  const updatePayload = JSON.parse(updated.text);
  assert.equal(updatePayload.ok, true);
  assert.deepEqual(updatePayload.publication.metrics_json, { views: 3400 });
  assert.equal(updatePayload.publication.title, "新赛季预告", "未提交字段应保持不变");
  assert.equal(updatePayload.publication.url, "https://www.xiaohongshu.com/explore/demo");
  assert.ok(updatePayload.publication.updated_at >= updatePayload.publication.created_at);

  // 回流自动化补数据后，台账读取侧拿到的 metrics_json 始终是对象
  const refetched = JSON.parse((await httpRequest("/publications?game=" + encodeURIComponent("巅峰极速"))).text);
  const row = refetched.items.find((item) => item.id === created.id);
  assert.deepEqual(row.metrics_json, { views: 3400 });
});

test("publication updates reject explicit non-string fields instead of silently keeping old values", async () => {
  const created = JSON.parse((await postPublication({
    game: "鸣潮",
    title: "发布前瞻",
    channel: "B站",
    url: "https://example.com/post"
  })).text).publication;

  const invalidTitle = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: 123 })
  });
  assert.equal(invalidTitle.status, 400);
  assert.match(JSON.parse(invalidTitle.text).error, /title/);

  const invalidUrl = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: { value: "https://evil.example" } })
  });
  assert.equal(invalidUrl.status, 400);
  assert.match(JSON.parse(invalidUrl.text).error, /url/);

  const current = JSON.parse((await httpRequest("/publications?game=" + encodeURIComponent("鸣潮"))).text).items
    .find((item) => item.id === created.id);
  assert.equal(current.title, "发布前瞻");
  assert.equal(current.url, "https://example.com/post");
});

test("missing required fields return per-field 400 messages", async () => {
  const missingAll = await postPublication({});
  assert.equal(missingAll.status, 400);
  assert.match(JSON.parse(missingAll.text).error, /game、title、channel/);

  const missingTitle = await postPublication({ game: "鸣潮", channel: "B站" });
  assert.equal(missingTitle.status, 400);
  assert.match(JSON.parse(missingTitle.text).error, /title/);
});

test("publication dates and text limits reject invalid input without taking down the service", async () => {
  const invalidDates = ["yesterday", "2026-02-30", "2026-02-30T10:00:00.000Z", 20260903];
  for (const published_at of invalidDates) {
    const response = await postPublication({ game: "鸣潮", title: "日期校验", channel: "B站", published_at });
    assert.equal(response.status, 400);
    assert.match(JSON.parse(response.text).error, /published_at/);
    assert.equal((await httpRequest("/health")).status, 200, "bad input must not terminate the archive service");
  }

  const overlongTitle = await postPublication({ game: "鸣潮", title: "标".repeat(201), channel: "B站" });
  assert.equal(overlongTitle.status, 400);
  assert.match(JSON.parse(overlongTitle.text).error, /title/);
  assert.equal((await httpRequest("/health")).status, 200, "text validation errors must not terminate the archive service");

  const calendarDate = await postPublication({ game: "鸣潮", title: "日期格式", channel: "B站", published_at: "2024-02-29" });
  assert.equal(calendarDate.status, 201);
  assert.equal(JSON.parse(calendarDate.text).publication.published_at, "2024-02-29");

  const created = JSON.parse(calendarDate.text).publication;
  const badUpdate = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ published_at: "2026-02-30" })
  });
  assert.equal(badUpdate.status, 400);
  const listed = JSON.parse((await httpRequest("/publications?game=" + encodeURIComponent("鸣潮"))).text);
  assert.equal(listed.items.find((item) => item.id === created.id).published_at, "2024-02-29");
});

test("malformed JSON bodies are rejected with 400", async () => {
  const badPost = await httpRequest("/publications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json"
  });
  assert.equal(badPost.status, 400);

  const badPut = await httpRequest("/publications/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{oops"
  });
  assert.equal(badPut.status, 400);
});

test("invalid metrics_json payloads return 400 on create and update", async () => {
  const arrayMetrics = await postPublication({
    game: "鸣潮",
    title: "t",
    channel: "B站",
    metrics_json: [1, 2]
  });
  assert.equal(arrayMetrics.status, 400);
  assert.match(JSON.parse(arrayMetrics.text).error, /metrics_json/);

  const created = JSON.parse((await postPublication({ game: "鸣潮", title: "t2", channel: "B站" })).text).publication;

  const stringMetrics = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metrics_json: "播放1万" })
  });
  assert.equal(stringMetrics.status, 400);
  assert.match(JSON.parse(stringMetrics.text).error, /metrics_json/);
});

test("unknown publication ids return 404 on update and delete", async () => {
  const putUnknown = await httpRequest("/publications/999999999", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metrics_json: { views: 1 } })
  });
  assert.equal(putUnknown.status, 404);

  const deleteUnknown = await httpRequest("/publications/999999999", { method: "DELETE" });
  assert.equal(deleteUnknown.status, 404);
});

test("delete removes the record; subsequent reads no longer see it", async () => {
  const created = JSON.parse((await postPublication({
    game: "绝区零",
    title: "角色 PV",
    channel: "抖音"
  })).text).publication;

  const removed = await httpRequest("/publications/" + created.id, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(JSON.parse(removed.text), { ok: true });

  const after = await httpRequest("/publications?game=" + encodeURIComponent("绝区零"));
  assert.equal(JSON.parse(after.text).items.some((item) => item.id === created.id), false);

  const gone = await httpRequest("/publications/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metrics_json: {} })
  });
  assert.equal(gone.status, 404);
});

test("publication create storage errors return 500 without stopping the service", async () => {
  const invalid = await postPublication({ game: "鸣潮", title: "输入校验", channel: "B站", url: 123 });
  assert.equal(invalid.status, 400);
  assert.match(JSON.parse(invalid.text).error, /url/);

  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TRIGGER reject_publication_insert BEFORE INSERT ON publications BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  db.close();

  const response = await httpRequest("/publications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "publication-storage-failure-20260927" },
    body: JSON.stringify({ game: "数据库写故障样本", title: "存储异常保护", channel: "B站" })
  });
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.text), { ok: false, error: "发布记录暂时无法保存，请稍后重试" });
  assert.doesNotMatch(response.text, /blocked|sqlite/i);
  assert.equal((await httpRequest("/health")).status, 200);
  const after = JSON.parse((await httpRequest("/publications?game=" + encodeURIComponent("数据库写故障样本"))).text);
  assert.equal(after.items.length, 0, "失败的创建不应留下发布记录");
});

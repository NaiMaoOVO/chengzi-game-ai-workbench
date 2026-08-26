const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19712;

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
    ARCHIVE_DB_PATH: path.join(os.tmpdir(), "gameops-risk-events-" + process.pid + "-" + Date.now() + ".db"),
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

function postRiskEvent(bodyObject) {
  return httpRequest("/risk-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObject)
  });
}

test("health identity is unchanged by the risk events ledger", async (t) => {
  t.diagnostic("health 契约：ok + service 不变，storage 仍指向隔离的临时数据文件");
  const payload = JSON.parse((await httpRequest("/health")).text);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "gameops-archive");
  assert.match(payload.storage, /^gameops-risk-events-\d+-\d+\.db$/);
  const live = JSON.parse((await httpRequest("/live")).text);
  assert.equal(live.service, "gameops-archive");
});

test("create -> list roundtrip keeps fields, fills defaults and honors filters", async () => {
  const created = await postRiskEvent({
    game: "鸣潮",
    title: "卡顿掉帧反馈集中",
    source: "评论分析",
    url: "https://www.bilibili.com/video/BVdemo100",
    detail: "2.0 版本前瞻视频评论区集中出现性能反馈",
    level: "高",
    status: "open"
  });
  assert.equal(created.status, 201);
  const createPayload = JSON.parse(created.text);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.risk_event.game, "鸣潮");
  assert.equal(createPayload.risk_event.title, "卡顿掉帧反馈集中");
  assert.equal(createPayload.risk_event.source, "评论分析");
  assert.equal(createPayload.risk_event.url, "https://www.bilibili.com/video/BVdemo100");
  assert.equal(createPayload.risk_event.detail, "2.0 版本前瞻视频评论区集中出现性能反馈");
  assert.equal(createPayload.risk_event.level, "高");
  assert.equal(createPayload.risk_event.status, "open");
  assert.equal(createPayload.risk_event.notes, "");
  assert.equal(typeof createPayload.risk_event.created_at, "string");

  // 最小创建：source/level/status 走默认值
  const minimal = await postRiskEvent({ game: "鸣潮", title: "抽卡福利争议升温" });
  assert.equal(minimal.status, 201);
  const minimalEvent = JSON.parse(minimal.text).risk_event;
  assert.equal(minimalEvent.source, "评论分析");
  assert.equal(minimalEvent.level, "中");
  assert.equal(minimalEvent.status, "open");
  assert.equal(minimalEvent.url, "");

  const listed = await httpRequest("/risk-events?game=" + encodeURIComponent("鸣潮") + "&status=open&level=%E9%AB%98&limit=5&offset=0");
  assert.equal(listed.status, 200);
  const listPayload = JSON.parse(listed.text);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.total >= 1, true);
  const match = listPayload.items.find((item) => item.id === createPayload.risk_event.id);
  assert.ok(match, "创建的记录应出现在过滤结果中");
  assert.equal(match.status, "open");
  // 最小创建的那条是“中”级，不应出现在 level=高 的过滤结果里
  assert.equal(listPayload.items.some((item) => item.id === minimalEvent.id), false);

  const midOnly = JSON.parse((await httpRequest("/risk-events?game=" + encodeURIComponent("鸣潮") + "&level=" + encodeURIComponent("中"))).text);
  assert.equal(midOnly.items.some((item) => item.id === minimalEvent.id), true);
  assert.ok(midOnly.items[0].id >= midOnly.items[midOnly.items.length - 1].id, "列表应按 id 倒序（最新在前）");

  const limited = JSON.parse((await httpRequest("/risk-events?limit=1")).text);
  assert.equal(limited.items.length, 1);
});

test("partial update drives open -> processing -> resolved without touching other fields", async () => {
  const created = JSON.parse((await postRiskEvent({
    game: "绝区零",
    title: "热门视频评论区扩散",
    detail: "需要保留原评与来源截图"
  })).text).risk_event;

  const processing = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "processing" })
  });
  assert.equal(processing.status, 200);
  const processingPayload = JSON.parse(processing.text);
  assert.equal(processingPayload.ok, true);
  assert.equal(processingPayload.risk_event.status, "processing");
  assert.equal(processingPayload.risk_event.game, "绝区零", "game 不可变，未提交也应保持原值");
  assert.equal(processingPayload.risk_event.title, "热门视频评论区扩散", "未提交字段应保持不变");
  assert.equal(processingPayload.risk_event.detail, "需要保留原评与来源截图");
  assert.ok(processingPayload.risk_event.updated_at >= processingPayload.risk_event.created_at);

  const resolved = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved", notes: "已发布已知问题说明并回访玩家" })
  });
  assert.equal(resolved.status, 200);
  const resolvedPayload = JSON.parse(resolved.text);
  assert.equal(resolvedPayload.risk_event.status, "resolved");
  assert.equal(resolvedPayload.risk_event.notes, "已发布已知问题说明并回访玩家");
  assert.equal(resolvedPayload.risk_event.title, "热门视频评论区扩散");

  // 提交 game 字段也不会改动归属游戏
  const withGame = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game: "别的游戏", level: "低" })
  });
  assert.equal(withGame.status, 200);
  assert.equal(JSON.parse(withGame.text).risk_event.game, "绝区零");
  assert.equal(JSON.parse(withGame.text).risk_event.level, "低");

  // 处理完的记录不再出现在 open 过滤里
  const openOnly = JSON.parse((await httpRequest("/risk-events?game=" + encodeURIComponent("绝区零") + "&status=open")).text);
  assert.equal(openOnly.items.some((item) => item.id === created.id), false);
});

test("missing required fields return per-field 400 messages", async () => {
  const missingAll = await postRiskEvent({});
  assert.equal(missingAll.status, 400);
  assert.match(JSON.parse(missingAll.text).error, /game、title/);

  const missingTitle = await postRiskEvent({ game: "鸣潮" });
  assert.equal(missingTitle.status, 400);
  assert.match(JSON.parse(missingTitle.text).error, /title/);

  const missingGame = await postRiskEvent({ title: "只有标题" });
  assert.equal(missingGame.status, 400);
  assert.match(JSON.parse(missingGame.text).error, /game/);
});

test("malformed JSON bodies are rejected with 400", async () => {
  const badPost = await httpRequest("/risk-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json"
  });
  assert.equal(badPost.status, 400);

  const badPut = await httpRequest("/risk-events/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{oops"
  });
  assert.equal(badPut.status, 400);
});

test("invalid level or status return 400 on create and update", async () => {
  const badLevel = await postRiskEvent({ game: "鸣潮", title: "t", level: "严重" });
  assert.equal(badLevel.status, 400);
  assert.match(JSON.parse(badLevel.text).error, /level/);

  const badStatus = await postRiskEvent({ game: "鸣潮", title: "t2", status: "closed" });
  assert.equal(badStatus.status, 400);
  assert.match(JSON.parse(badStatus.text).error, /status/);

  const created = JSON.parse((await postRiskEvent({ game: "巅峰极速", title: "账号代练信息污染样本" })).text).risk_event;

  const putBadLevel = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: "紧急" })
  });
  assert.equal(putBadLevel.status, 400);
  assert.match(JSON.parse(putBadLevel.text).error, /level/);

  const putBadStatus = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(putBadStatus.status, 400);
  assert.match(JSON.parse(putBadStatus.text).error, /status/);

  // 校验失败不应改动原记录
  const after = JSON.parse((await httpRequest("/risk-events?game=" + encodeURIComponent("巅峰极速"))).text);
  const row = after.items.find((item) => item.id === created.id);
  assert.ok(row, "校验失败后记录仍应存在");
  assert.equal(row.level, "中");
  assert.equal(row.status, "open");
});

test("unknown risk event ids return 404 on update and delete", async () => {
  const putUnknown = await httpRequest("/risk-events/999999999", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "processing" })
  });
  assert.equal(putUnknown.status, 404);

  const deleteUnknown = await httpRequest("/risk-events/999999999", { method: "DELETE" });
  assert.equal(deleteUnknown.status, 404);
});

test("delete removes the record; subsequent reads no longer see it", async () => {
  const created = JSON.parse((await postRiskEvent({
    game: "原神",
    title: "版本直播节奏风险",
    level: "中"
  })).text).risk_event;

  const removed = await httpRequest("/risk-events/" + created.id, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(JSON.parse(removed.text), { ok: true });

  const after = JSON.parse((await httpRequest("/risk-events?game=" + encodeURIComponent("原神"))).text);
  assert.equal(after.items.some((item) => item.id === created.id), false);

  const gone = await httpRequest("/risk-events/" + created.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "dropped" })
  });
  assert.equal(gone.status, 404);
});

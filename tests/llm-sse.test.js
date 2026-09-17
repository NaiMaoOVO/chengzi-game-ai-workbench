const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

// 组装结果：{"announcement":"新版本正式开启","social":{"bilibili":"B站动态"}}
const STREAM_PIECES = [
  '{"anno',
  'uncement":"新版本',
  '正式开启",',
  '"social":{"bilibili"',
  ':"B站动态"}}'
];
const ASSEMBLED_TEXT = STREAM_PIECES.join("");
const EXPECTED_RESULT = { announcement: "新版本正式开启", social: { bilibili: "B站动态" } };
const VERSION_COPY_BODY = {
  task: "version-copy",
  data: { game: "测试游戏", theme: "夏日版本", points: ["新角色上线", "福利活动"], style: "官方公告风", audience: "核心玩家" }
};

async function waitForHealth(port, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch (_error) { /* retry until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("服务未能在 " + timeoutMs + "ms 内就绪（端口 " + port + "）");
}

function postStream(port, body, extraHeaders = {}) {
  return new Promise((resolve) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const chunks = [];
    let meta = null;
    let settled = false;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/generate",
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders }
      },
      (res) => {
        meta = { status: res.statusCode, headers: res.headers };
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", finish);
        res.on("close", finish);
      }
    );
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ ...(meta || { status: 0, headers: {} }), text: Buffer.concat(chunks).toString("utf8") });
    };
    req.on("error", finish);
    req.end(payload);
  });
}

function parseSseEvents(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let eventName = "";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event: eventName || "message", data: dataLines.join("\n") });
  }
  return events;
}

function createFakeOpenAiUpstream(port, behavior = {}) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_error) { /* keep empty */ }
      state.requests.push(body);
      if (body.stream !== true) {
        // 非流式请求按 OpenAI 兼容协议返回一次性 JSON 补全
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: ASSEMBLED_TEXT } }] }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const pieces = behavior.abortAfterPieces != null ? STREAM_PIECES.slice(0, behavior.abortAfterPieces) : STREAM_PIECES;
      pieces.forEach((piece, index) => {
        setTimeout(() => {
          res.write("data: " + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + "\n\n");
        }, index * 20);
      });
      setTimeout(() => {
        if (behavior.abortMidway) {
          res.destroy();
          return;
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }, pieces.length * 20 + 30);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        requests: state.requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function withLlmService(envOverrides, run) {
  const child = spawn(process.execPath, [path.join(projectRoot, "llm-server.js")], {
    cwd: projectRoot,
    env: { ...process.env, ALLOWED_ORIGIN: "null", ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });
  try {
    await waitForHealth(envOverrides.LLM_PORT);
    await run(envOverrides.LLM_PORT);
  } catch (error) {
    assert.fail(error.message + "\nstderr: " + stderrText.slice(-800));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
  }
}

test("llm stream=true forwards ordered SSE deltas and a done event with the parsed JSON result", async () => {
  const llmPort = 19531;
  const upstreamPort = 19631;
  const upstream = await createFakeOpenAiUpstream(upstreamPort);
  try {
    await withLlmService({
      LLM_PORT: String(llmPort),
      LLM_API_KEY: "sse-test-key",
      LLM_BASE_URL: "http://127.0.0.1:" + upstreamPort + "/v1",
      LLM_MODEL: "test-model",
      LLM_RATE_LIMIT_MAX: "100"
    }, async () => {
      const res = await postStream(llmPort, { ...VERSION_COPY_BODY, stream: true }, { Origin: "null" });
      assert.equal(res.status, 200, "流式请求应返回 200，实际 " + res.status + "：" + res.text.slice(0, 300));
      assert.ok(res.headers["content-type"].startsWith("text/event-stream"), "应为 text/event-stream，实际 " + res.headers["content-type"]);
      assert.equal(res.headers["access-control-allow-origin"], "null");

      const events = parseSseEvents(res.text);
      assert.ok(events.length >= STREAM_PIECES.length + 1, "应包含全部 delta 与一个 done 事件");
      const deltaEvents = events.filter((e) => e.event === "delta");
      const doneEvents = events.filter((e) => e.event === "done");
      assert.equal(doneEvents.length, 1, "done 事件应恰好一次");
      assert.deepEqual(events.map((e) => e.event), [...deltaEvents.map(() => "delta"), "done"], "事件顺序应为 delta* 然后 done");

      const joined = deltaEvents.map((e) => JSON.parse(e.data).delta).join("");
      assert.equal(joined, ASSEMBLED_TEXT, "delta 应按序拼出完整原始文本");

      const donePayload = JSON.parse(doneEvents[0].data);
      assert.equal(donePayload.task, "version-copy");
      assert.equal(donePayload.model, "test-model");
      assert.equal(donePayload.cached, false);
      assert.deepEqual(donePayload.result, EXPECTED_RESULT);

      assert.equal(upstream.requests.length, 1);
      assert.equal(upstream.requests[0].stream, true, "上游应收到 stream:true");
      assert.equal(upstream.requests[0].model, "test-model");
    });
  } finally {
    await upstream.close();
  }
});

test("llm without stream field keeps the legacy JSON response shape and does not stream upstream", async () => {
  const llmPort = 19532;
  const upstreamPort = 19632;
  const upstream = await createFakeOpenAiUpstream(upstreamPort);
  try {
    await withLlmService({
      LLM_PORT: String(llmPort),
      LLM_API_KEY: "sse-test-key",
      LLM_BASE_URL: "http://127.0.0.1:" + upstreamPort + "/v1",
      LLM_MODEL: "test-model",
      LLM_RATE_LIMIT_MAX: "100"
    }, async () => {
      const legacyBody = JSON.parse(JSON.stringify(VERSION_COPY_BODY));
      delete legacyBody.stream;
      const res = await postStream(llmPort, legacyBody);
      assert.equal(res.status, 200);
      assert.ok(res.headers["content-type"].startsWith("application/json"), "非流式请求应返回 application/json");
      assert.doesNotMatch(res.text, /^event:/m, "非流式响应不得出现 SSE 帧");

      const payload = JSON.parse(res.text);
      assert.equal(Object.keys(payload).sort().join(","), "cached,model,result,task");
      assert.equal(payload.task, "version-copy");
      assert.equal(payload.model, "test-model");
      assert.equal(payload.cached, false);
      assert.deepEqual(payload.result, EXPECTED_RESULT);

      assert.equal(upstream.requests.length, 1);
      assert.equal(upstream.requests[0].stream, undefined, "旧路径不得向上游发起流式请求");
    });
  } finally {
    await upstream.close();
  }
});

test("llm rate limit still applies to stream requests", async () => {
  const llmPort = 19533;
  await withLlmService({
    LLM_PORT: String(llmPort),
    LLM_API_KEY: "sse-test-key",
    LLM_BASE_URL: "http://127.0.0.1:9/v1",
    LLM_RATE_LIMIT_MAX: "2"
  }, async () => {
    const first = await postStream(llmPort, { task: "nope", stream: true });
    const second = await postStream(llmPort, { task: "nope", stream: true });
    assert.equal(first.status, 400);
    assert.equal(second.status, 400);
    const limited = await postStream(llmPort, { task: "nope", stream: true });
    assert.equal(limited.status, 429, "第三个流式请求应被限流");
    const retryAfter = Number(limited.headers["retry-after"]);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, "Retry-After 应为 1-60 的整数秒");
  });
});

test("llm rejects a remote HTTP upstream before it can receive an API key", async () => {
  const llmPort = 19535;
  await withLlmService({
    LLM_PORT: String(llmPort),
    LLM_API_KEY: "sse-test-key",
    LLM_BASE_URL: "http://public-provider.example/v1",
    LLM_RATE_LIMIT_MAX: "100"
  }, async () => {
    const ready = await fetch("http://127.0.0.1:" + llmPort + "/ready");
    assert.equal(ready.status, 503);
    const payload = await ready.json();
    assert.equal(payload.llm, "not_ready");
    assert.match(payload.detail, /HTTPS/);
  });
});

test("llm stream requests share the configured concurrency limit", async () => {
  const llmPort = 19536;
  const upstreamPort = 19636;
  const upstream = await createFakeOpenAiUpstream(upstreamPort);
  try {
    await withLlmService({
      LLM_PORT: String(llmPort),
      LLM_API_KEY: "sse-test-key",
      LLM_BASE_URL: "http://127.0.0.1:" + upstreamPort + "/v1",
      LLM_MODEL: "test-model",
      LLM_MAX_CONCURRENCY: "2",
      LLM_RATE_LIMIT_MAX: "100"
    }, async () => {
      const first = postStream(llmPort, { ...VERSION_COPY_BODY, stream: true });
      const second = postStream(llmPort, { ...VERSION_COPY_BODY, stream: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const limited = await postStream(llmPort, { ...VERSION_COPY_BODY, stream: true });
      assert.equal(limited.status, 503);
      assert.equal(limited.headers["retry-after"], "2");
      await Promise.all([first, second]);
    });
  } finally {
    await upstream.close();
  }
});

test("llm stream emits an error event when the upstream dies mid-stream", async () => {
  const llmPort = 19534;
  const upstreamPort = 19634;
  const upstream = await createFakeOpenAiUpstream(upstreamPort, { abortMidway: true, abortAfterPieces: 2 });
  try {
    await withLlmService({
      LLM_PORT: String(llmPort),
      LLM_API_KEY: "sse-test-key",
      LLM_BASE_URL: "http://127.0.0.1:" + upstreamPort + "/v1",
      LLM_MODEL: "test-model",
      LLM_RATE_LIMIT_MAX: "100"
    }, async () => {
      const res = await postStream(llmPort, { ...VERSION_COPY_BODY, stream: true });
      assert.ok(res.headers["content-type"].startsWith("text/event-stream"), "应为 text/event-stream，实际 " + res.headers["content-type"]);
      const events = parseSseEvents(res.text);
      assert.ok(events.length >= 2, "应至少有一个 delta 和一个 error 事件");
      const deltaEvents = events.filter((e) => e.event === "delta");
      assert.deepEqual(
        deltaEvents.map((e) => JSON.parse(e.data).delta).join(""),
        STREAM_PIECES.slice(0, 2).join(""),
        "中断前已转发的增量应与上游一致"
      );
      const lastEvent = events[events.length - 1];
      assert.equal(lastEvent.event, "error", "最后一个事件应为 error");
      const errorPayload = JSON.parse(lastEvent.data);
      assert.ok(typeof errorPayload.error === "string" && errorPayload.error.length > 0);
      assert.equal(events.some((e) => e.event === "done"), false, "中断后不得发出 done");
    });
  } finally {
    await upstream.close();
  }
});

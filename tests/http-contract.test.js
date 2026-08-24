const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { parseRequestUrl } = require("../lib/safe-request-url");

const projectRoot = path.resolve(__dirname, "..");

function request(url, host) {
  return { url, headers: { host } };
}

test("safe request URL rejects malformed Host headers without throwing", () => {
  assert.doesNotThrow(() => parseRequestUrl(request("/health", "a|b")));
  assert.equal(parseRequestUrl(request("/health", "a|b")), null);
  assert.equal(parseRequestUrl(request("/health", "bad host")), null);
});

test("safe request URL accepts ordinary local Host headers", () => {
  assert.equal(parseRequestUrl(request("/health?ok=1", "127.0.0.1:8791")).pathname, "/health");
  assert.equal(parseRequestUrl(request("/health?ok=1", "localhost:8791")).searchParams.get("ok"), "1");
});

const serviceCases = [
  { script: "hotspot-server.js", envPort: "HOTSPOT_PORT", service: "gameops-hotspot" },
  { script: "comment-server.js", envPort: "COMMENT_PORT", service: "gameops-comments" },
  { script: "ocr-server.js", envPort: "PORT", service: "gameops-ocr" },
  { script: "llm-server.js", envPort: "LLM_PORT", service: "gameops-llm" },
  {
    script: "archive-server.js",
    envPort: "ARCHIVE_PORT",
    service: "gameops-archive",
    extraCheck(port) {
      return (async () => {
        const post = await fetch(`http://127.0.0.1:${port}/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "smoke", game: "测试", source: "sample", payload: { ok: true } })
        });
        assert.equal(post.status, 201);
        const list = await fetch(`http://127.0.0.1:${port}/snapshots?kind=smoke`).then((r) => r.json());
        assert.equal(list.items.length >= 1, true);
        const putProfile = await fetch(`http://127.0.0.1:${port}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game: "冒烟游戏", profile: { competitors: ["竞品A"] } })
        });
        assert.equal(putProfile.status, 200);
        const gotProfile = await fetch(`http://127.0.0.1:${port}/profile?game=${encodeURIComponent("冒烟游戏")}`).then((r) => r.json());
        assert.equal(gotProfile.profile.competitors[0], "竞品A");
      })();
    }
  }
];

async function waitForHealth(port, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch (_error) { /* retry until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务未能在 ${timeoutMs}ms 内就绪（端口 ${port}）`);
}

for (const [index, item] of serviceCases.entries()) {
  test(`${item.script} boots and serves its identity on /health`, async () => {
    const port = 18800 + index * 7;
    const child = spawn(process.execPath, [path.join(projectRoot, item.script)], {
      cwd: projectRoot,
      env: { ...process.env, [item.envPort]: String(port), ...(item.script === "archive-server.js" ? { ARCHIVE_DB_PATH: path.join(require("node:os").tmpdir(), "gameops-archive-smoke-" + Date.now() + ".db") } : {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderrText = "";
    let exited = false;
    child.on("exit", () => { exited = true; });
    child.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });
    try {
      const payload = await waitForHealth(port);
      assert.equal(payload.service, item.service);
      assert.equal(payload.ok, true);
      const bad = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Host: "a|b" } }).then((r) => r.status, () => "reset");
      assert.notEqual(bad, null);
      const cors = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "null" } });
      assert.equal(cors.ok, true, `${item.script} 应接受 file:// 页面的 null Origin`);
      assert.equal(cors.headers.get("access-control-allow-origin"), "null");
    } catch (error) {
      assert.fail(`${error.message}\nstderr: ${stderrText.slice(-800)}`);
    } finally {
      if (!exited) child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (exited) return resolve();
        child.once("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  });
}

test("local controller serves CORS headers for file pages and supervises child services", { timeout: 60000 }, async () => {
  const ports = { controller: 19003, hotspot: 18990, comment: 18991, ocr: 18992, llm: 18993 };
  const child = spawn(process.execPath, [path.join(projectRoot, "start-demo.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CONTROLLER_PORT: String(ports.controller),
      HOTSPOT_PORT: String(ports.hotspot),
      COMMENT_PORT: String(ports.comment),
      PORT: String(ports.ocr),
      LLM_PORT: String(ports.llm),
      ARCHIVE_DB_PATH: path.join(require("node:os").tmpdir(), "gameops-chain-smoke-" + Date.now() + ".db"),
      GAMEOPS_NO_OPEN: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });
  try {
    await waitForHealth(ports.controller, 15000);
    const health = await fetch(`http://127.0.0.1:${ports.controller}/health`).then((r) => r.json());
    assert.equal(health.service, "gameops-local-controller");

    const corsResponse = await fetch(`http://127.0.0.1:${ports.controller}/health`, {
      headers: { Origin: "null" }
    });
    assert.equal(corsResponse.headers.get("access-control-allow-origin"), "null");

    let status;
    const startedAt = Date.now();
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = await fetch(`http://127.0.0.1:${ports.controller}/status`).then((r) => r.json());
      assert.equal(status.service, "gameops-local-controller");
    } while (Date.now() - startedAt < 20000 && !status.services.every((s) => s.running));
    assert.ok(status.services.length >= 4, "status 应包含四个核心服务");
    for (const service of status.services) {
      assert.equal(service.running, true, `${service.name} 应处于运行状态`);
    }
  } catch (error) {
    assert.fail(`${error.message}\nstderr: ${stderrText.slice(-800)}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

/* ---- 契约深化：畸形 Host、CORS 拒绝、限流与上传守卫 ---- */

let nextGuardPort = 19211;

function httpRequest(port, requestPath, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: requestPath, method, headers },
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

async function exhaustUntilLimited(port) {
  let sawOk = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await httpRequest(port, "/health");
    if (res.status === 429) {
      assert.ok(sawOk, "限流前应至少有一次成功请求");
      return res;
    }
    if (res.status === 200) sawOk = true;
  }
  throw new Error("30 次请求内未触发限流");
}

async function withGuardedService(script, envPortName, extraEnv, run) {
  const port = nextGuardPort;
  nextGuardPort += 1;
  const child = spawn(process.execPath, [path.join(projectRoot, script)], {
    cwd: projectRoot,
    env: { ...process.env, [envPortName]: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderrText = "";
  child.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });
  try {
    await waitForHealth(port);
    await run(port);
  } catch (error) {
    assert.fail(`${error.message}\nstderr: ${stderrText.slice(-800)}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
  }
}

test("hotspot: malformed Host -> 400, disallowed Origin -> no ACAO, exceeding limit -> 429 + Retry-After", async () => {
  await withGuardedService("hotspot-server.js", "HOTSPOT_PORT", {
    RATE_LIMIT_MAX: "5",
    RATE_LIMIT_WINDOW_MS: "1000"
  }, async (port) => {
    const badHost = await httpRequest(port, "/hotspots?game=demo", { headers: { Host: "a|b" } });
    assert.equal(badHost.status, 400);
    assert.equal(JSON.parse(badHost.text).error, "invalid_request_url");

    const evilOrigin = await httpRequest(port, "/health", { headers: { Origin: "http://evil.example" } });
    assert.equal(evilOrigin.status, 200);
    assert.equal(evilOrigin.headers["access-control-allow-origin"], undefined, "拒绝的 Origin 不得携带 ACAO");

    const health = JSON.parse((await httpRequest(port, "/health")).text);
    assert.equal(health.service, "gameops-hotspot");

    const limited = await exhaustUntilLimited(port);
    assert.equal(limited.headers["retry-after"], "1");
  });
});

test("comment: malformed Host -> 400, disallowed Origin -> no ACAO, exceeding limit -> 429 + Retry-After", async () => {
  await withGuardedService("comment-server.js", "COMMENT_PORT", {
    RATE_LIMIT_MAX: "5",
    RATE_LIMIT_WINDOW_MS: "1000"
  }, async (port) => {
    const badHost = await httpRequest(port, "/comments?url=BV1GJ411x7h7", { headers: { Host: "bad host" } });
    assert.equal(badHost.status, 400);
    assert.equal(JSON.parse(badHost.text).error, "invalid_request_url");

    const evilOrigin = await httpRequest(port, "/health", { headers: { Origin: "http://evil.example" } });
    assert.equal(evilOrigin.status, 200);
    assert.equal(evilOrigin.headers["access-control-allow-origin"], undefined, "拒绝的 Origin 不得携带 ACAO");

    const health = JSON.parse((await httpRequest(port, "/health")).text);
    assert.equal(health.service, "gameops-comments");

    const limited = await exhaustUntilLimited(port);
    assert.equal(limited.headers["retry-after"], "1");
  });
});

// 回归锁：getCached 曾被吞进损坏的 fetchWithRetry 声明，合法查询会以未捕获异常杀死进程。
test("comment: valid GET /comments answers with JSON and keeps the process alive", async () => {
  await withGuardedService("comment-server.js", "COMMENT_PORT", {
    RATE_LIMIT_MAX: "100",
    UPSTREAM_TIMEOUT_MS: "2000",
    UPSTREAM_RETRIES: "0"
  }, async (port) => {
    const res = await httpRequest(port, "/comments?url=BV1GJ411x7h7&limit=5");
    assert.ok([200, 502].includes(res.status), `unexpected status ${res.status}`);
    const payload = JSON.parse(res.text);
    if (res.status === 200) {
      assert.equal(payload.source, "B站公开评论");
      assert.ok(Array.isArray(payload.comments));
    } else {
      assert.equal(payload.error, "fetch_failed");
    }
    const stillAlive = await httpRequest(port, "/health");
    assert.equal(stillAlive.status, 200);
  });
});

test("ocr: disallowed Origin -> 403, wrong content type -> 415, undetectable image -> 415, oversized upload -> 413", async () => {
  await withGuardedService("ocr-server.js", "PORT", {
    OCR_PROVIDER: "remote",
    // 本地 http 地址即可让 remote provider 就绪，且永远不会被真正调用（用例都在上游调用前被拒）
    OCR_REMOTE_URL: "http://127.0.0.1:1",
    OCR_RATE_LIMIT_MAX: "1000"
  }, async (port) => {
    const evilOrigin = await httpRequest(port, "/live", { headers: { Origin: "http://evil.example" } });
    assert.equal(evilOrigin.status, 403);
    assert.equal(evilOrigin.headers["access-control-allow-origin"], "null", "ocr 对拒绝来源固定回 null，不回显恶意 Origin");

    const health = JSON.parse((await httpRequest(port, "/health")).text);
    assert.equal(health.service, "gameops-ocr");

    // ocr 不基于 Host 解析 URL，畸形 Host 不应杀死进程
    const badHost = await httpRequest(port, "/live", { headers: { Host: "a|b" } });
    assert.equal(badHost.status, 200);

    const wrongType = await httpRequest(port, "/ocr", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello"
    });
    assert.equal(wrongType.status, 415);

    const garbageImage = await httpRequest(port, "/ocr", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: "definitely-not-an-image"
    });
    assert.equal(garbageImage.status, 415);
    assert.match(garbageImage.text, /无法识别或不支持的图片格式/);

    const tooBig = await httpRequest(port, "/ocr", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: Buffer.alloc(12 * 1024 * 1024 + 1, 0x61)
    });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.text, /12MB/);
  });
});

test("llm: identity, disallowed Origin -> 403, bad bodies -> 400, exceeding limit -> 429 + Retry-After", async () => {
  await withGuardedService("llm-server.js", "LLM_PORT", {
    LLM_API_KEY: "contract-test-key",
    LLM_BASE_URL: "http://127.0.0.1:1/v1",
    LLM_RATE_LIMIT_MAX: "3"
  }, async (port) => {
    const healthPayload = JSON.parse((await httpRequest(port, "/health")).text);
    assert.equal(healthPayload.service, "gameops-llm");
    assert.equal(typeof healthPayload.model, "string");

    const evilOrigin = await httpRequest(port, "/health", { headers: { Origin: "http://evil.example" } });
    assert.equal(evilOrigin.status, 403);
    assert.equal(evilOrigin.headers["access-control-allow-origin"], "null", "llm 对拒绝来源固定回 null，不回显恶意 Origin");

    // llm 不基于 Host 解析 URL，畸形 Host 不应杀死进程
    const badHost = await httpRequest(port, "/live", { headers: { Host: "a|b" } });
    assert.equal(badHost.status, 200);

    const post = (body) => httpRequest(port, "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });

    const badJson = await post("{not-json");
    assert.equal(badJson.status, 400);

    const unknownTask = await post(JSON.stringify({ task: "nope" }));
    assert.equal(unknownTask.status, 400);

    const thinSamples = await post(JSON.stringify({ task: "feedback-insight", data: { comments: ["只有一条"] } }));
    assert.equal(thinSamples.status, 400);

    const limited = await post(JSON.stringify({ task: "nope" }));
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers["retry-after"]);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, "Retry-After 应为 1-60 的整数秒");
  });
});

test("archive: identity, malformed Host -> 400, disallowed Origin -> 403, wrong method/bad JSON guards", async () => {
  await withGuardedService("archive-server.js", "ARCHIVE_PORT", {
    ARCHIVE_DB_PATH: path.join(require("node:os").tmpdir(), `gameops-archive-guard-${Date.now()}.db`),
    MORNING_GAMES: ""
  }, async (port) => {
    const health = JSON.parse((await httpRequest(port, "/health")).text);
    assert.equal(health.service, "gameops-archive");

    const badHost = await httpRequest(port, "/snapshots?kind=smoke", { headers: { Host: "a|b" } });
    assert.equal(badHost.status, 400);
    assert.equal(JSON.parse(badHost.text).error, "invalid_request_url");

    const evilOrigin = await httpRequest(port, "/health", { headers: { Origin: "http://evil.example" } });
    assert.equal(evilOrigin.status, 403);

    const wrongMethod = await httpRequest(port, "/snapshots?kind=smoke", { method: "DELETE" });
    assert.equal(wrongMethod.status, 404);

    const badJson = await httpRequest(port, "/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops"
    });
    assert.equal(badJson.status, 400);
  });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
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

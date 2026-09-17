const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19716;

function request(requestPath, options = {}) {
  const { method = "GET", headers = {}, body = null } = options;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/health");
      if (response.status === 200) return;
    } catch (_error) { /* 服务启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("创作者库测试服务未在 10 秒内启动");
}

function cookieOf(response) {
  return (response.headers["set-cookie"]?.[0] || "").split(";", 1)[0];
}

const child = spawn(process.execPath, [path.join(projectRoot, "archive-server.js")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ARCHIVE_PORT: String(PORT),
    ARCHIVE_DB_PATH: path.join(os.tmpdir(), "gameops-creator-library-" + process.pid + "-" + Date.now() + ".db"),
    ARCHIVE_AUTH_ENABLED: "1",
    ARCHIVE_ADMIN_USERNAME: "creator-admin",
    ARCHIVE_ADMIN_PASSWORD: "creator-password-2026",
    ARCHIVE_COOKIE_SECURE: "0",
    MORNING_GAMES: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

test.before(waitForHealth);
test.after(async () => {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
});

test("creator library sync is authenticated and rejects stale writes", async () => {
  assert.equal((await request("/creator-library")).status, 401);
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const csrf = login.payload.csrf_token;
  const headers = { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf };
  const empty = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.deepEqual(empty.payload.library, {});

  const saved = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: null, library: { "b站::id::uid-1": { name: "新名称", platform: "B站", accountId: "uid-1" } } })
  });
  assert.equal(saved.status, 200);
  assert.ok(saved.payload.updated_at);

  const current = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.equal(current.payload.library["b站::id::uid-1"].name, "新名称");
  const stale = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: null, library: {} })
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.error, "creator_library_conflict");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19715;
const databasePath = path.join(os.tmpdir(), "gameops-archive-auth-rate-" + process.pid + "-" + Date.now() + ".db");
const child = spawn(process.execPath, [path.join(projectRoot, "archive-server.js")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ARCHIVE_PORT: String(PORT),
    ARCHIVE_DB_PATH: databasePath,
    ARCHIVE_AUTH_ENABLED: "1",
    ARCHIVE_ADMIN_USERNAME: "ops-admin",
    ARCHIVE_ADMIN_PASSWORD: "admin-password-2026",
    ARCHIVE_COOKIE_SECURE: "0",
    ARCHIVE_RATE_LIMIT_MAX: "100",
    ARCHIVE_AUTH_RATE_LIMIT_MAX: "4",
    RATE_LIMIT_WINDOW_MS: "60000",
    MORNING_GAMES: ""
  },
  stdio: "ignore"
});

function request(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: PORT,
      path: pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        payload: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health" }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
      });
      if (response === 200) return;
    } catch (_error) { /* 服务启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("认证限流测试服务未在 10 秒内启动");
}

test.before(waitForHealth);
test.after(async () => {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  }
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(databasePath + suffix, { force: true });
});

test("archive login caps request bodies and enforces its configured rate limit", async () => {
  const successful = await request("/auth/login", { username: "ops-admin", password: "admin-password-2026" });
  assert.equal(successful.status, 200);

  const oversized = await request("/auth/login", {
    username: "ops-admin",
    password: "wrong-password-2026",
    extra: "x".repeat(5000)
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.payload.error, "请求内容过大（上限 4KB）");

  const attempts = [];
  for (let index = 0; index < 3; index += 1) {
    attempts.push(await request("/auth/login", { username: "ops-admin", password: "wrong-password-2026" }));
  }

  assert.deepEqual(attempts.map((attempt) => attempt.status), [401, 401, 429]);
  assert.equal(attempts[2].payload.error, "登录尝试过于频繁");
  assert.ok(Number.isInteger(Number(attempts[2].headers["retry-after"])));
  assert.ok(Number(attempts[2].headers["retry-after"]) > 0);
});

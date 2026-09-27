const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19716;
const databasePath = path.join(os.tmpdir(), "gameops-creator-library-" + process.pid + "-" + Date.now() + ".db");

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
    ARCHIVE_DB_PATH: databasePath,
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

test("creator library rejects malformed profile and collaboration records without overwriting saved data", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    "X-CSRF-Token": login.payload.csrf_token
  };
  const beforeSave = await request("/creator-library", { headers: { Cookie: cookie } });
  const saved = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      base_updated_at: beforeSave.payload.updated_at,
      library: { ...beforeSave.payload.library, profile: { name: "有效档案", platform: "B站" } }
    })
  });
  assert.equal(saved.status, 200);
  const current = await request("/creator-library", { headers: { Cookie: cookie } });

  for (const library of [
    { profile: null },
    { profile: { name: "有效档案", platform: "B站", collaborations: [{ project: "鸣潮" }, null] } }
  ]) {
    const rejected = await request("/creator-library", {
      method: "PUT",
      headers,
      body: JSON.stringify({ base_updated_at: current.payload.updated_at, library })
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.payload.error, "creator_library_invalid_payload");
  }

  const after = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.deepEqual(after.payload.library, current.payload.library);
  assert.equal(after.payload.updated_at, current.payload.updated_at);
});

test("creator library storage errors return 500 and preserve the remote archive", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    "X-CSRF-Token": login.payload.csrf_token
  };
  const current = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.equal(current.status, 200);

  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TRIGGER reject_creator_library_insert BEFORE INSERT ON creator_libraries BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  db.close();

  const response = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      base_updated_at: current.payload.updated_at,
      library: { ...current.payload.library, new: { name: "不会被保存", platform: "B站" } }
    })
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.payload, { ok: false, error: "个人库暂时无法保存，请稍后重试" });
  assert.doesNotMatch(JSON.stringify(response.payload), /blocked|sqlite/i);
  assert.equal((await request("/health")).status, 200);

  const after = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.deepEqual(after.payload.library, current.payload.library);
  assert.equal(after.payload.updated_at, current.payload.updated_at);
});

test("creator library marks structurally damaged stored data invalid and blocks valid overwrites", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const csrf = login.payload.csrf_token;
  const ownerKey = "user:" + login.payload.user.id;
  const damagedLibrary = {
    preserved: { name: "应保留的档案", platform: "B站", collaborations: { malformed: true } }
  };
  const updatedAt = "2026-09-27T00:00:00.000Z";
  const database = new DatabaseSync(databasePath);
  database.prepare("UPDATE creator_libraries SET payload = ?, updated_at = ? WHERE owner_key = ?")
    .run(JSON.stringify(damagedLibrary), updatedAt, ownerKey);
  database.close();

  const current = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.equal(current.status, 200);
  assert.equal(current.payload.invalid, true);
  assert.deepEqual(current.payload.library, damagedLibrary);

  const overwrite = await request("/creator-library", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ base_updated_at: updatedAt, library: {} })
  });
  assert.equal(overwrite.status, 409);
  assert.equal(overwrite.payload.error, "creator_library_invalid");

  const after = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.equal(after.payload.invalid, true);
  assert.deepEqual(after.payload.library, damagedLibrary);
  assert.equal(after.payload.updated_at, updatedAt);
});

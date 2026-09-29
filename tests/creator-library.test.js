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
    GAMEOPS_TEST_FIXED_TIME: String(Date.now()),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${path.join(__dirname, "helpers/fixed-clock.js")}`].filter(Boolean).join(" "),
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

test("creator library no-op writes preserve the concurrency token after validating the base version", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  const cookie = cookieOf(login);
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    "X-CSRF-Token": login.payload.csrf_token
  };
  const before = await request("/creator-library", { headers: { Cookie: cookie } });
  const library = {
    ...before.payload.library,
    "noop-profile": { name: "结构相同", platform: "B站", details: { alpha: 1, beta: 2 } }
  };
  const saved = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: before.payload.updated_at, library })
  });
  assert.equal(saved.status, 200);

  const reorderKeys = (value) => Array.isArray(value)
    ? value.map(reorderKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorderKeys(entry)]))
      : value;
  const equivalent = reorderKeys(library);
  const stale = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: before.payload.updated_at, library: equivalent })
  });
  assert.equal(stale.status, 409, "equal content must not bypass the stale base-version check");

  const noOp = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: saved.payload.updated_at, library: equivalent })
  });
  assert.equal(noOp.status, 200);
  assert.equal(noOp.payload.updated_at, saved.payload.updated_at, "an equivalent library should not create a new version");
  const after = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.deepEqual(after.payload.library, library);
  assert.equal(after.payload.updated_at, saved.payload.updated_at);
});

test("creator library concurrency token advances for writes in the same millisecond", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  const cookie = cookieOf(login);
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
    "X-CSRF-Token": login.payload.csrf_token
  };
  const before = await request("/creator-library", { headers: { Cookie: cookie } });
  const base = before.payload.updated_at;
  const firstLibrary = { ...before.payload.library, first: { name: "第一标签页", platform: "B站" } };
  const first = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: base, library: firstLibrary })
  });
  assert.equal(first.status, 200);

  const secondLibrary = { ...firstLibrary, second: { name: "第二标签页", platform: "小红书" } };
  const second = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: first.payload.updated_at, library: secondLibrary })
  });
  assert.equal(second.status, 200);
  assert.notEqual(second.payload.updated_at, first.payload.updated_at);

  const stale = await request("/creator-library", {
    method: "PUT",
    headers,
    body: JSON.stringify({ base_updated_at: first.payload.updated_at, library: { stale: { name: "过期写入", platform: "B站" } } })
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.error, "creator_library_conflict");
  const after = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.deepEqual(after.payload.library, secondLibrary);
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

test("creator library read errors return a sanitized 500 and keep the server alive", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "creator-admin", password: "creator-password-2026" })
  });
  const cookie = cookieOf(login);

  const database = new DatabaseSync(databasePath);
  database.exec("ALTER TABLE creator_libraries RENAME TO creator_libraries_unavailable");
  database.close();

  const response = await request("/creator-library", { headers: { Cookie: cookie } });
  assert.equal(response.status, 500);
  assert.deepEqual(response.payload, { ok: false, error: "个人库暂时无法读取，请稍后重试" });
  assert.doesNotMatch(JSON.stringify(response.payload), /sqlite|no such table/i);
  assert.equal((await request("/health")).status, 200);
});

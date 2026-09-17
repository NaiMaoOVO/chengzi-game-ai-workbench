const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19714;
const databasePath = path.join(os.tmpdir(), "gameops-archive-auth-" + process.pid + "-" + Date.now() + ".db");

// 认证开启前可能已经在个人模式写入创作者库，启动服务前构造一条 legacy default 记录，验证它会迁移给管理员。
const seedDb = new DatabaseSync(databasePath);
seedDb.exec("CREATE TABLE creator_libraries (owner_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO creator_libraries VALUES ('default', '{\"demo-key\":{\"name\":\"旧个人库\"}}', '2026-09-15T00:00:00.000Z');");
seedDb.close();

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
      if (response.status === 200) return response.payload;
    } catch (_error) { /* 服务启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("认证测试服务未在 10 秒内启动");
}

function sessionCookie(response) {
  const header = response.headers["set-cookie"]?.[0] || "";
  assert.match(header, /^gameops_session=/);
  return header.split(";", 1)[0];
}

function jsonHeaders({ cookie, csrf } = {}) {
  return {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
    ...(csrf ? { "X-CSRF-Token": csrf } : {})
  };
}

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

test("archive auth requires login, CSRF, and keeps each account's data private", async () => {
  const health = await request("/health");
  assert.equal(health.payload.auth_required, true);
  assert.equal((await request("/daily-todos")).status, 401);

  const rejectedLogin = await request("/auth/login", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: "ops-admin", password: "wrong-password" })
  });
  assert.equal(rejectedLogin.status, 401);

  const adminLogin = await request("/auth/login", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: "ops-admin", password: "admin-password-2026" })
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.payload.user.role, "admin");
  const adminCookie = sessionCookie(adminLogin);
  const adminCsrf = adminLogin.payload.csrf_token;

  const migratedLibrary = await request("/creator-library", { headers: { Cookie: adminCookie } });
  assert.equal(migratedLibrary.status, 200);
  assert.equal(migratedLibrary.payload.library["demo-key"].name, "旧个人库", "认证开启后 legacy 创作者库应迁移给管理员");

  const missingCsrf = await request("/daily-todos", {
    method: "POST",
    headers: jsonHeaders({ cookie: adminCookie }),
    body: JSON.stringify({ game: "鸣潮", title: "不应写入" })
  });
  assert.equal(missingCsrf.status, 403);

  const adminTodo = await request("/daily-todos", {
    method: "POST",
    headers: jsonHeaders({ cookie: adminCookie, csrf: adminCsrf }),
    body: JSON.stringify({ game: "鸣潮", title: "管理员私人待办" })
  });
  assert.equal(adminTodo.status, 201);
  const adminTodoId = adminTodo.payload.daily_todo.id;

  const createMember = await request("/auth/users", {
    method: "POST",
    headers: jsonHeaders({ cookie: adminCookie, csrf: adminCsrf }),
    body: JSON.stringify({ username: "content-editor", password: "member-password-2026", role: "member" })
  });
  assert.equal(createMember.status, 201);
  assert.equal(createMember.payload.user.role, "member");

  const memberLogin = await request("/auth/login", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: "content-editor", password: "member-password-2026" })
  });
  assert.equal(memberLogin.status, 200);
  const memberCookie = sessionCookie(memberLogin);
  const memberCsrf = memberLogin.payload.csrf_token;

  const memberBeforeCreate = await request("/daily-todos", { headers: jsonHeaders({ cookie: memberCookie }) });
  assert.equal(memberBeforeCreate.status, 200);
  assert.equal(memberBeforeCreate.payload.items.some((item) => item.id === adminTodoId), false, "成员不应读到管理员的私人待办");

  const memberUpdateAdminTodo = await request("/daily-todos/" + adminTodoId, {
    method: "PUT",
    headers: jsonHeaders({ cookie: memberCookie, csrf: memberCsrf }),
    body: JSON.stringify({ status: "done" })
  });
  assert.equal(memberUpdateAdminTodo.status, 404, "成员不应修改其他账号的数据");

  const created = await request("/daily-todos", {
    method: "POST",
    headers: jsonHeaders({ cookie: memberCookie, csrf: memberCsrf }),
    body: JSON.stringify({ game: "鸣潮", title: "协作写入待办", priority: "high" })
  });
  assert.equal(created.status, 201);
  const todoId = created.payload.daily_todo.id;

  const adminCannotSeeMemberTodo = await request("/daily-todos", { headers: jsonHeaders({ cookie: adminCookie }) });
  assert.equal(adminCannotSeeMemberTodo.payload.items.some((item) => item.id === todoId), false, "管理员不应默认读取成员私人待办");

  const memberDelete = await request("/daily-todos/" + todoId, {
    method: "DELETE",
    headers: jsonHeaders({ cookie: memberCookie, csrf: memberCsrf })
  });
  assert.equal(memberDelete.status, 200, "成员可删除自己的数据");

  const adminDelete = await request("/daily-todos/" + adminTodoId, {
    method: "DELETE",
    headers: jsonHeaders({ cookie: adminCookie, csrf: adminCsrf })
  });
  assert.equal(adminDelete.status, 200);
});

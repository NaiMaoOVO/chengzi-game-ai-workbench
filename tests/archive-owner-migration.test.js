const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const PORT = 19721;

function startArchive(databasePath, authEnabled) {
  const child = spawn(process.execPath, [path.join(projectRoot, "archive-server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ARCHIVE_PORT: String(PORT),
      ARCHIVE_DB_PATH: databasePath,
      ARCHIVE_AUTH_ENABLED: authEnabled ? "1" : "0",
      ARCHIVE_ADMIN_USERNAME: "migration-admin",
      ARCHIVE_ADMIN_PASSWORD: "migration-password-2026",
      ARCHIVE_COOKIE_SECURE: "0",
      MORNING_GAMES: ""
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderrText = "";
  child.stderr.on("data", (chunk) => { child.stderrText += chunk.toString(); });
  return child;
}

function requestHealth() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 500 }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("timeout", () => request.destroy(new Error("health timeout")));
    request.on("error", reject);
  });
}

async function waitForHealth(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("archive exited before health: " + child.stderrText);
    try {
      if (await requestHealth() === 200) return;
    } catch (_error) { /* 服务启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("archive did not become healthy: " + child.stderrText);
}

function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("archive did not exit in time"));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopArchive(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, 3000);
  } catch (_error) {
    child.kill("SIGKILL");
  }
}

test("failed legacy owner migration rolls back every table", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-owner-migration-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "archive.db");
  const setupServer = startArchive(databasePath, false);
  try {
    await waitForHealth(setupServer);
  } finally {
    await stopArchive(setupServer);
  }

  const db = new DatabaseSync(databasePath);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO snapshots (owner_key, kind, payload, created_at) VALUES ('default', 'briefing', '{}', ?)").run(now);
  db.prepare("INSERT INTO project_profiles (owner_key, game, payload, updated_at) VALUES ('default', '鸣潮', '{}', ?)").run(now);
  db.prepare("INSERT INTO publications (owner_key, game, title, channel, created_at, updated_at) VALUES ('default', '鸣潮', '版本发布', 'B站', ?, ?)").run(now, now);
  db.prepare("INSERT INTO risk_events (owner_key, game, title, created_at, updated_at) VALUES ('default', '鸣潮', '舆情风险', ?, ?)").run(now, now);
  db.prepare("INSERT INTO daily_todos (owner_key, game, title, created_at, updated_at) VALUES ('default', '鸣潮', '复核数据', ?, ?)").run(now, now);
  db.prepare("INSERT INTO creator_libraries (owner_key, payload, updated_at) VALUES ('default', '{}', ?)").run(now);
  db.prepare("INSERT INTO morning_runs (owner_key, run_date, game, platform, status, started_at) VALUES ('default', '2026-09-28', '鸣潮', 'B站', 'success', ?)").run(now);
  db.exec("CREATE TRIGGER reject_publication_owner_update BEFORE UPDATE OF owner_key ON publications WHEN OLD.owner_key = 'default' BEGIN SELECT RAISE(ABORT, 'injected owner migration failure'); END;");
  db.close();

  const authServer = startArchive(databasePath, true);
  const exit = await waitForExit(authServer);
  assert.equal(exit.code, 1, authServer.stderrText);
  assert.match(authServer.stderrText, /injected owner migration failure/);

  const verify = new DatabaseSync(databasePath, { readOnly: true });
  for (const table of ["snapshots", "project_profiles", "publications", "risk_events", "daily_todos", "creator_libraries", "morning_runs"]) {
    assert.equal(verify.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_key = 'default'`).get().count, 1, `${table} should keep its original owner`);
  }
  verify.close();
});

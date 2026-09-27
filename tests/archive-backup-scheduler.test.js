const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { businessDate } = require("../lib/business-date");
const {
  backupProcessEnvironment,
  createArchiveBackupScheduler,
  hasVerifiedBackupForBusinessDate,
  isAutomaticBackupEnabled
} = require("../lib/archive-backup-scheduler");
const { loadArchiveBackupEnv, verifyArchiveBackup } = require("../lib/archive-backup");

const root = path.resolve(__dirname, "..");

test("automatic backup lookup accepts only a verified copy from the Shanghai business date", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-scheduler-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('kept');");
  db.close();

  const backup = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
    cwd: root,
    env: { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);

  const today = businessDate(new Date());
  const backupName = fs.readdirSync(backupDir).find((name) => /^archive-.*\.db$/.test(name));
  const backupPath = path.join(backupDir, backupName);
  assert.equal(hasVerifiedBackupForBusinessDate(backupDir, today), true);

  const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
  fs.utimesSync(backupPath, yesterday, yesterday);
  assert.equal(hasVerifiedBackupForBusinessDate(backupDir, today), false);

  fs.utimesSync(backupPath, new Date(), new Date());
  fs.writeFileSync(backupPath + ".sha256", "broken checksum\n");
  assert.equal(hasVerifiedBackupForBusinessDate(backupDir, today), false);
});

test("automatic backup retries a failed run, then runs once per Shanghai date", () => {
  let now = new Date("2026-09-28T15:59:00.000Z");
  const children = [];
  const scheduler = createArchiveBackupScheduler({
    env: { ARCHIVE_AUTO_BACKUP_ENABLED: "1" },
    now: () => now,
    hasVerifiedBackup: () => false,
    spawnBackup: () => {
      const child = new EventEmitter();
      children.push(child);
      return child;
    },
    logger: { log() {}, warn() {}, error() {} }
  });

  assert.equal(scheduler.check().status, "started");
  assert.equal(children.length, 1);
  assert.equal(scheduler.getStatus().status, "running");
  children[0].emit("exit", 1, null);
  assert.equal(scheduler.getStatus().status, "failed");
  assert.equal(scheduler.check().status, "started");
  assert.equal(children.length, 2);
  children[1].emit("exit", 0, null);
  assert.equal(scheduler.check().status, "already-backed-up");
  assert.equal(scheduler.getStatus().status, "complete");
  assert.equal(scheduler.getStatus().last_success_date, "2026-09-28");
  assert.equal(children.length, 2);

  now = new Date("2026-09-28T16:01:00.000Z");
  assert.equal(scheduler.check().status, "started");
  assert.equal(scheduler.getStatus().status, "running");
  assert.equal(children.length, 3);
});

test("automatic backups default off in Node test subprocesses but can be explicitly enabled", () => {
  assert.equal(isAutomaticBackupEnabled({ NODE_TEST_CONTEXT: "child-v8" }), false);
  assert.equal(isAutomaticBackupEnabled({ NODE_TEST_CONTEXT: "child-v8", ARCHIVE_AUTO_BACKUP_ENABLED: "1" }), true);
  assert.equal(isAutomaticBackupEnabled({ ARCHIVE_AUTO_BACKUP_ENABLED: "0" }), false);
  assert.equal(isAutomaticBackupEnabled({}), true);
});

test("backup configuration loads only archive variables from the project env file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-env-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, ".env"), "ARCHIVE_DB_PATH=/tmp/archive.db\nARCHIVE_BACKUP_KEEP=3\nLLM_API_KEY=not-for-backup-process\n");
  const env = { ARCHIVE_BACKUP_DIR: "/tmp/archive-backups" };

  assert.deepEqual(loadArchiveBackupEnv(dir, env), {
    ARCHIVE_DB_PATH: "/tmp/archive.db",
    ARCHIVE_BACKUP_DIR: "/tmp/archive-backups",
    ARCHIVE_BACKUP_KEEP: "3"
  });
});

test("automatic scheduler launches the existing backup script and verifies its output", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-auto-backup-run-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('automatic');");
  db.close();

  const env = { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir, ARCHIVE_AUTO_BACKUP_ENABLED: "1" };
  const scheduler = createArchiveBackupScheduler({ root, databasePath, backupDir, env, enabled: true, startDelayMs: 10, checkIntervalMs: 50 });
  t.after(() => scheduler.stop());
  assert.equal(scheduler.start(), true);

  const deadline = Date.now() + 10000;
  let backupPath = "";
  while (Date.now() < deadline) {
    let name = "";
    try {
      name = fs.readdirSync(backupDir, { withFileTypes: true }).find((entry) => entry.isFile() && /^archive-.*\.db$/.test(entry.name))?.name || "";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (name) {
      backupPath = path.join(backupDir, name);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(backupPath, "scheduler should create a backup within 10 seconds");
  assert.doesNotThrow(() => verifyArchiveBackup(backupPath));
  assert.deepEqual(backupProcessEnvironment({ HOME: "/tmp/user", ARCHIVE_DB_PATH: databasePath, LLM_API_KEY: "must-not-be-inherited" }), {
    HOME: "/tmp/user",
    ARCHIVE_DB_PATH: databasePath
  });
});

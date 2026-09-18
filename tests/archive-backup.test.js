const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");

test("archive backup creates a consistent SQLite copy outside the live database path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-test-"));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('kept');");
  db.close();

  const result = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
    cwd: root,
    env: { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const files = fs.readdirSync(backupDir).filter((name) => name.endsWith(".db"));
  assert.equal(files.length, 1);
  const backup = new DatabaseSync(path.join(backupDir, files[0]), { readOnly: true });
  assert.equal(backup.prepare("SELECT value FROM check_rows").get().value, "kept");
  backup.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive backup writes a checksum and prunes older copies by retention", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-retention-test-"));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('kept');");
  db.close();

  const env = { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir, ARCHIVE_BACKUP_KEEP: "1" };
  const first = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], { cwd: root, env, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], { cwd: root, env, encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const files = fs.readdirSync(backupDir);
  const databaseFiles = files.filter((name) => /^archive-.*\.db$/.test(name));
  assert.equal(databaseFiles.length, 1);
  const checksumPath = path.join(backupDir, databaseFiles[0] + ".sha256");
  assert.equal(fs.existsSync(checksumPath), true);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(backupDir, databaseFiles[0]))).digest("hex");
  assert.match(fs.readFileSync(checksumPath, "utf8"), new RegExp("^" + digest + "  " + databaseFiles[0] + "\\n$"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive backup verification accepts intact files and rejects tampering", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-verify-test-"));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('kept');");
  db.close();
  const env = { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir };
  const backup = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], { cwd: root, env, encoding: "utf8" });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const file = fs.readdirSync(backupDir).find((name) => /^archive-.*\.db$/.test(name));
  const verifier = path.join(root, "scripts", "verify-archive-backup.js");
  const valid = spawnSync(process.execPath, [verifier, path.join(backupDir, file)], { cwd: root, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.match(valid.stdout, /校验通过/);

  fs.appendFileSync(path.join(backupDir, file), "tampered");
  const invalid = spawnSync(process.execPath, [verifier, path.join(backupDir, file)], { cwd: root, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /校验失败/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive backup verification rejects a checksum-valid non-SQLite file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-invalid-db-test-"));
  const file = path.join(dir, "archive-invalid.db");
  fs.writeFileSync(file, "not a sqlite database");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fs.writeFileSync(file + ".sha256", digest + "  archive-invalid.db\n");
  const verifier = path.join(root, "scripts", "verify-archive-backup.js");
  const result = spawnSync(process.execPath, [verifier, file], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQLite|完整性|校验失败/);
  fs.rmSync(dir, { recursive: true, force: true });
});

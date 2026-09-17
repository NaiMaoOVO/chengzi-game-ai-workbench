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

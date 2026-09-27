const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertSafeArchiveBackupDirectory, sha256File } = require("../lib/archive-backup");

const root = path.resolve(__dirname, "..");

test("archive backup refuses filesystem-level and symlinked broad directories", () => {
  const filesystemRoot = path.parse(path.resolve(".")).root;
  assert.throws(() => assertSafeArchiveBackupDirectory(filesystemRoot), /备份目录/);
  assert.throws(() => assertSafeArchiveBackupDirectory(path.dirname(os.homedir())), /备份目录/);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-path-test-"));
  try {
    const rootLink = path.join(scratch, "root-link");
    fs.symlinkSync(filesystemRoot, rootLink);
    assert.throws(() => assertSafeArchiveBackupDirectory(rootLink), /备份目录/);

    const safeDirectory = path.join(fs.realpathSync(scratch), "archive-backups", "daily");
    assert.equal(assertSafeArchiveBackupDirectory(safeDirectory), safeDirectory);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

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

test("archive backup hardens an existing backup directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-mode-test-"));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('kept');");
  db.close();
  fs.mkdirSync(backupDir, { mode: 0o755 });
  fs.chmodSync(backupDir, 0o755);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
    cwd: root,
    env: { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.statSync(backupDir).mode & 0o777, 0o700);
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

test("archive backup verification binds the checksum to the target filename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-name-test-"));
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
  const file = fs.readdirSync(backupDir).find((name) => /^archive-.*\.db$/.test(name));
  const target = path.join(backupDir, file);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  fs.writeFileSync(target + ".sha256", digest + "  another-archive.db\n");
  const verifier = path.join(root, "scripts", "verify-archive-backup.js");
  const result = spawnSync(process.execPath, [verifier, target], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /文件名|校验失败/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive restore requires a stopped-service acknowledgement and preserves the replaced database and sidecars", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-restore-test-"));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('before backup');");
  db.close();
  const env = { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir };
  const backup = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], { cwd: root, env, encoding: "utf8" });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const backupFile = path.join(backupDir, fs.readdirSync(backupDir).find((name) => /^archive-.*\.db$/.test(name)));

  const live = new DatabaseSync(databasePath);
  live.exec("INSERT INTO check_rows VALUES ('after backup');");
  live.close();
  const beforeRestore = fs.readFileSync(databasePath);
  fs.writeFileSync(databasePath + "-wal", "old-wal-sidecar");
  fs.writeFileSync(databasePath + "-shm", "old-shm-sidecar");

  const restoreScript = path.join(root, "scripts", "restore-archive-backup.js");
  const blocked = spawnSync(process.execPath, [restoreScript, backupFile], { cwd: root, env, encoding: "utf8" });
  assert.equal(blocked.status, 2);
  assert.equal(fs.readFileSync(databasePath + "-wal", "utf8"), "old-wal-sidecar");

  const restored = spawnSync(process.execPath, [restoreScript, backupFile, "--service-stopped"], { cwd: root, env, encoding: "utf8" });
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  const recovered = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(recovered.prepare("SELECT value FROM check_rows ORDER BY rowid").all().map((row) => row.value), ["before backup"]);
  recovered.close();
  assert.equal(fs.existsSync(databasePath + "-wal"), false);
  assert.equal(fs.existsSync(databasePath + "-shm"), false);

  const safetyFiles = fs.readdirSync(dir).filter((name) => name.startsWith("archive.db.pre-restore-"));
  const safetyMain = safetyFiles.find((name) => /^archive\.db\.pre-restore-[^-]+-\d+-[a-f0-9]+$/.test(name));
  assert.ok(safetyMain, "expected a preserved pre-restore database");
  assert.deepEqual(fs.readFileSync(path.join(dir, safetyMain)), beforeRestore);
  assert.equal(fs.readFileSync(path.join(dir, safetyMain + "-wal"), "utf8"), "old-wal-sidecar");
  assert.equal(fs.readFileSync(path.join(dir, safetyMain + "-shm"), "utf8"), "old-shm-sidecar");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive restore rejects a checksum-valid non-SQLite backup without touching the live database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-restore-invalid-test-"));
  const databasePath = path.join(dir, "archive.db");
  const invalidBackup = path.join(dir, "archive-invalid.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('keep live data');");
  db.close();
  fs.writeFileSync(invalidBackup, "not a sqlite database");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(invalidBackup)).digest("hex");
  fs.writeFileSync(invalidBackup + ".sha256", digest + "  archive-invalid.db\n");

  const result = spawnSync(process.execPath, [path.join(root, "scripts", "restore-archive-backup.js"), invalidBackup, "--service-stopped"], {
    cwd: root,
    env: { ...process.env, ARCHIVE_DB_PATH: databasePath },
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  const stillLive = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(stillLive.prepare("SELECT value FROM check_rows").get().value, "keep live data");
  stillLive.close();
  assert.equal(fs.readdirSync(dir).some((name) => name.includes("pre-restore")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("archive file hashing streams large files through a bounded buffer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-hash-test-"));
  const file = path.join(dir, "large-backup.db");
  const chunk = Buffer.alloc(1024 * 1024, 0xa5);
  const descriptor = fs.openSync(file, "w");
  for (let index = 0; index < 8; index += 1) fs.writeSync(descriptor, chunk);
  fs.closeSync(descriptor);
  const expected = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(sha256File(file), expected);
  fs.rmSync(dir, { recursive: true, force: true });
});

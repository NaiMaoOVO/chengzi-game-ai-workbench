const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertSafeArchiveBackupDirectory, sha256File, verifyArchiveBackup } = require("../lib/archive-backup");

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

test("archive backup verifies the new copy before pruning older recovery points", () => {
  const script = fs.readFileSync(path.join(root, "scripts", "backup-archive.js"), "utf8");
  const verifyPosition = script.indexOf("verifyArchiveBackup(destination)");
  const prunePosition = script.indexOf("fs.rmSync(path.join(backupDir, name), { force: true })");
  assert.ok(verifyPosition >= 0, "new backup must pass checksum and SQLite integrity validation");
  assert.ok(prunePosition > verifyPosition, "retention must not run before the new copy is verified");
});

test("archive backup rejects malformed retention before pruning existing copies", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-retention-invalid-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('live');");
  db.close();
  fs.mkdirSync(backupDir);

  const existingBackup = path.join(backupDir, "archive-20200101000000000.db");
  const existingDb = new DatabaseSync(existingBackup);
  existingDb.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('recovery point');");
  existingDb.close();
  const existingDigest = sha256File(existingBackup);
  fs.writeFileSync(existingBackup + ".sha256", existingDigest + "  " + path.basename(existingBackup) + "\n");

  for (const keep of ["1junk", "0", "101", "1.5", "NaN", "Infinity"]) {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
      cwd: root,
      env: { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir, ARCHIVE_BACKUP_KEEP: keep },
      encoding: "utf8"
    });
    assert.equal(result.status, 1, `expected invalid retention ${keep} to be rejected`);
    assert.match(result.stderr, /ARCHIVE_BACKUP_KEEP/);
    assert.equal(fs.existsSync(existingBackup), true);
    assert.equal(fs.existsSync(existingBackup + ".sha256"), true);
    assert.equal(sha256File(existingBackup), existingDigest);
  }

  const maximum = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
    cwd: root,
    env: { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir, ARCHIVE_BACKUP_KEEP: "100" },
    encoding: "utf8"
  });
  assert.equal(maximum.status, 0, maximum.stderr || maximum.stdout);
  assert.equal(fs.readdirSync(backupDir).filter((name) => /^archive-.*\.db$/.test(name)).length, 2);
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

test("archive backup bounds checksum reads even when the file grows after its size check", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-checksum-size-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "archive-large-checksum.db");
  fs.writeFileSync(file, "not a sqlite database");
  const checksumPath = file + ".sha256";
  fs.writeFileSync(checksumPath, "x".repeat(1024 * 1024));
  const originalOpenSync = fs.openSync;
  const originalStatSync = fs.statSync;
  const originalFstatSync = fs.fstatSync;
  const originalReadFileSync = fs.readFileSync;
  const originalReadSync = fs.readSync;
  let checksumDescriptor = null;
  let checksumReadBytes = 0;
  let largestChecksumRead = 0;
  fs.openSync = function trackedOpenSync(target, ...args) {
    const descriptor = originalOpenSync.call(this, target, ...args);
    if (path.resolve(String(target)) === checksumPath) checksumDescriptor = descriptor;
    return descriptor;
  };
  fs.statSync = function reportStaleChecksumSize(target, ...args) {
    const stats = originalStatSync.call(this, target, ...args);
    return target === checksumPath ? { size: 1, isFile: () => true } : stats;
  };
  fs.fstatSync = function reportStaleDescriptorSize(descriptor, ...args) {
    const stats = originalFstatSync.call(this, descriptor, ...args);
    return descriptor === checksumDescriptor ? { size: 1, isFile: () => true } : stats;
  };
  fs.readFileSync = function trackedReadFileSync(target, ...args) {
    const content = originalReadFileSync.call(this, target, ...args);
    if (target === checksumPath) checksumReadBytes += Buffer.byteLength(content);
    return content;
  };
  fs.readSync = function trackedReadSync(descriptor, buffer, offset, length, position) {
    if (descriptor === checksumDescriptor) largestChecksumRead = Math.max(largestChecksumRead, length);
    return originalReadSync.call(this, descriptor, buffer, offset, length, position);
  };
  try {
    assert.throws(() => verifyArchiveBackup(file), /校验文件过大/);
    assert.equal(largestChecksumRead, 513, "checksum reads should stop after one byte beyond the accepted limit");
    assert.equal(checksumReadBytes, 0, "checksum content must not be loaded with an unbounded read");
  } finally {
    fs.openSync = originalOpenSync;
    fs.statSync = originalStatSync;
    fs.fstatSync = originalFstatSync;
    fs.readFileSync = originalReadFileSync;
    fs.readSync = originalReadSync;
  }
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

test("archive restore refuses to replace the database while the archive service is responding", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-backup-restore-running-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "archive.db");
  const backupDir = path.join(dir, "backups");
  const backupDatabase = new DatabaseSync(databasePath);
  backupDatabase.exec("CREATE TABLE check_rows (value TEXT NOT NULL); INSERT INTO check_rows VALUES ('before backup');");
  backupDatabase.close();
  const env = { ...process.env, ARCHIVE_DB_PATH: databasePath, ARCHIVE_BACKUP_DIR: backupDir, ARCHIVE_PORT: "19717", MORNING_GAMES: "" };
  const backup = spawnSync(process.execPath, [path.join(root, "scripts", "backup-archive.js")], { cwd: root, env, encoding: "utf8" });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  const backupFile = path.join(backupDir, fs.readdirSync(backupDir).find((name) => /^archive-.*\.db$/.test(name)));
  const changed = new DatabaseSync(databasePath);
  changed.exec("INSERT INTO check_rows VALUES ('after backup');");
  changed.close();

  const archiveService = spawn(process.execPath, [path.join(root, "archive-server.js")], {
    cwd: root,
    env: { ...env, ARCHIVE_AUTH_ENABLED: "0", ARCHIVE_COOKIE_SECURE: "0" },
    stdio: "ignore"
  });
  t.after(async () => {
    if (archiveService.exitCode === null) {
      archiveService.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => archiveService.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
  });

  const deadline = Date.now() + 10000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      ready = await new Promise((resolve, reject) => {
        const request = http.get({ host: "127.0.0.1", port: 19717, path: "/health" }, (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode === 200));
        });
        request.on("error", reject);
      });
    } catch (_error) { /* 等待隔离测试服务启动 */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "archive 测试服务应在 10 秒内启动");

  const restore = spawnSync(process.execPath, [path.join(root, "scripts", "restore-archive-backup.js"), backupFile, "--service-stopped"], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.equal(restore.status, 1);
  assert.match(restore.stderr, /仍有服务响应，已拒绝恢复/);
  const stillLive = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(stillLive.prepare("SELECT value FROM check_rows ORDER BY rowid").all().map((row) => row.value), ["before backup", "after backup"]);
  stillLive.close();
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

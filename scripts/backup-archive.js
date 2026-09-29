const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertSafeArchiveBackupDirectory, loadArchiveBackupEnv, parseArchiveBackupKeep, sha256File, verifyArchiveBackup } = require("../lib/archive-backup");
const RECENT_BACKUP_GRACE_MS = 60 * 60 * 1000;

const root = path.resolve(__dirname, "..");
loadArchiveBackupEnv(root);

const databasePath = process.env.ARCHIVE_DB_PATH
  ? path.resolve(process.env.ARCHIVE_DB_PATH)
  : path.join(os.homedir(), ".gameops", "archive.db");
const backupDirInput = process.env.ARCHIVE_BACKUP_DIR
  ? path.resolve(process.env.ARCHIVE_BACKUP_DIR)
  : path.join(path.dirname(databasePath), "backups");
let keep;
try {
  keep = parseArchiveBackupKeep(process.env.ARCHIVE_BACKUP_KEEP);
} catch (error) {
  console.error("存档备份失败：" + error.message);
  process.exit(1);
}

function removeBackupFiles(backupDir, name) {
  for (const filePath of [path.join(backupDir, name), path.join(backupDir, name + ".sha256")]) {
    let stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stats.isFile() || stats.isSymbolicLink()) fs.rmSync(filePath, { force: true });
  }
}

if (!fs.existsSync(databasePath)) {
  console.error("未找到存档数据库：" + databasePath);
  process.exit(1);
}

let destination = "";
let checksumPath = "";
let backupCreated = false;
let checksumCreated = false;
let backupVerified = false;
let backupLockDb = null;

try {
  const backupDir = assertSafeArchiveBackupDirectory(backupDirInput);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const backupLockPath = path.join(backupDir, ".archive-backup-lock.sqlite");
  let existingLock;
  try {
    existingLock = fs.lstatSync(backupLockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existingLock && (!existingLock.isFile() || existingLock.isSymbolicLink())) {
    throw new Error("备份轮转锁必须是普通文件");
  }
  backupLockDb = new DatabaseSync(backupLockPath);
  const openedLock = fs.lstatSync(backupLockPath);
  if (!openedLock.isFile() || openedLock.isSymbolicLink()
    || existingLock && (existingLock.dev !== openedLock.dev || existingLock.ino !== openedLock.ino)) {
    throw new Error("备份轮转锁在打开期间发生变化");
  }
  backupLockDb.exec("PRAGMA busy_timeout = 120000; BEGIN EXCLUSIVE");

  // SQLite's OS-backed exclusive lock serializes the whole snapshot and rotation flow,
  // and is released automatically if this process exits unexpectedly.
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  destination = path.join(backupDir, "archive-" + stamp + ".db");
  const escapedDestination = "'" + destination.replace(/'/g, "''") + "'";
  const db = new DatabaseSync(databasePath);
  db.exec("VACUUM INTO " + escapedDestination);
  backupCreated = true;
  db.close();
  fs.chmodSync(destination, 0o600);
  const digest = sha256File(destination);
  checksumPath = destination + ".sha256";
  fs.writeFileSync(checksumPath, digest + "  " + path.basename(destination) + "\n", { flag: "wx", mode: 0o600 });
  checksumCreated = true;
  fs.chmodSync(checksumPath, 0o600);
  verifyArchiveBackup(destination);
  backupVerified = true;

  const currentBackupName = path.basename(destination);
  const backups = [];
  const invalidBackups = [];
  for (const name of fs.readdirSync(backupDir).filter((entry) => /^archive-.*\.db$/.test(entry) && entry !== currentBackupName)) {
    const filePath = path.join(backupDir, name);
    let stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile() && !stats.isSymbolicLink()) continue;
    const candidate = { name, modifiedAt: stats.mtimeMs };
    try {
      if (!stats.isFile()) throw new Error("备份文件不是普通文件");
      verifyArchiveBackup(filePath);
      backups.push(candidate);
    } catch (_error) {
      invalidBackups.push(candidate);
    }
  }
  backups.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
  const staleBefore = Date.now() - RECENT_BACKUP_GRACE_MS;
  for (const backup of invalidBackups) {
    // A recent file may belong to another backup process that is still writing it.
    if (backup.modifiedAt < staleBefore) removeBackupFiles(backupDir, backup.name);
  }
  for (const backup of backups.slice(Math.max(keep - 1, 0))) {
    removeBackupFiles(backupDir, backup.name);
  }
  console.log("存档备份完成：" + destination + "（校验和已写入，保留 " + Math.min(keep, backups.length + 1) + " 份）");
} catch (error) {
  if (!backupVerified) {
    if (backupCreated) fs.rmSync(destination, { force: true });
    if (checksumCreated) fs.rmSync(checksumPath, { force: true });
  }
  console.error("存档备份失败：" + error.message);
  process.exitCode = 1;
} finally {
  if (backupLockDb) {
    try { backupLockDb.exec("ROLLBACK"); } catch (_error) { /* lock may not have been acquired */ }
    backupLockDb.close();
  }
}

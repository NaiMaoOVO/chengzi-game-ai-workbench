const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertSafeArchiveBackupDirectory, loadArchiveBackupEnv, parseArchiveBackupKeep, sha256File, verifyArchiveBackup } = require("../lib/archive-backup");

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

if (!fs.existsSync(databasePath)) {
  console.error("未找到存档数据库：" + databasePath);
  process.exit(1);
}

let destination = "";
let checksumPath = "";
let backupCreated = false;
let checksumCreated = false;
let backupVerified = false;

try {
  const backupDir = assertSafeArchiveBackupDirectory(backupDirInput);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
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
  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^archive-.*\.db$/.test(name))
    .filter((name) => name !== currentBackupName)
    .map((name) => ({ name, modifiedAt: fs.lstatSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
  for (const backup of backups.slice(Math.max(keep - 1, 0))) {
    fs.rmSync(path.join(backupDir, backup.name), { force: true });
    fs.rmSync(path.join(backupDir, backup.name + ".sha256"), { force: true });
  }
  console.log("存档备份完成：" + destination + "（校验和已写入，保留 " + Math.min(keep, backups.length + 1) + " 份）");
} catch (error) {
  if (!backupVerified) {
    if (backupCreated) fs.rmSync(destination, { force: true });
    if (checksumCreated) fs.rmSync(checksumPath, { force: true });
  }
  console.error("存档备份失败：" + error.message);
  process.exit(1);
}

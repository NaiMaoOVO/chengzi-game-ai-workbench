const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { loadProjectEnv } = require("../lib/env-file");
const { assertSafeArchiveBackupDirectory, sha256File } = require("../lib/archive-backup");

const root = path.resolve(__dirname, "..");
loadProjectEnv(root);

const databasePath = process.env.ARCHIVE_DB_PATH
  ? path.resolve(process.env.ARCHIVE_DB_PATH)
  : path.join(os.homedir(), ".gameops", "archive.db");
const backupDirInput = process.env.ARCHIVE_BACKUP_DIR
  ? path.resolve(process.env.ARCHIVE_BACKUP_DIR)
  : path.join(path.dirname(databasePath), "backups");
const keepSetting = process.env.ARCHIVE_BACKUP_KEEP?.trim() || "";
const keep = keepSetting ? Number(keepSetting) : 7;
if (keepSetting && (!/^\d+$/.test(keepSetting) || !Number.isSafeInteger(keep) || keep < 1 || keep > 100)) {
  console.error("存档备份失败：ARCHIVE_BACKUP_KEEP 必须是 1–100 的整数");
  process.exit(1);
}

if (!fs.existsSync(databasePath)) {
  console.error("未找到存档数据库：" + databasePath);
  process.exit(1);
}

try {
  const backupDir = assertSafeArchiveBackupDirectory(backupDirInput);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const destination = path.join(backupDir, "archive-" + stamp + ".db");
  const escapedDestination = "'" + destination.replace(/'/g, "''") + "'";
  const db = new DatabaseSync(databasePath);
  db.exec("VACUUM INTO " + escapedDestination);
  db.close();
  fs.chmodSync(destination, 0o600);
  const digest = sha256File(destination);
  const checksumPath = destination + ".sha256";
  fs.writeFileSync(checksumPath, digest + "  " + path.basename(destination) + "\n", { mode: 0o600 });
  fs.chmodSync(checksumPath, 0o600);

  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^archive-.*\.db$/.test(name))
    .sort()
    .reverse();
  for (const name of backups.slice(keep)) {
    fs.rmSync(path.join(backupDir, name), { force: true });
    fs.rmSync(path.join(backupDir, name + ".sha256"), { force: true });
  }
  console.log("存档备份完成：" + destination + "（校验和已写入，保留 " + Math.min(keep, backups.length) + " 份）");
} catch (error) {
  console.error("存档备份失败：" + error.message);
  process.exit(1);
}

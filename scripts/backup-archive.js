const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { loadProjectEnv } = require("../lib/env-file");

const root = path.resolve(__dirname, "..");
loadProjectEnv(root);

const databasePath = process.env.ARCHIVE_DB_PATH
  ? path.resolve(process.env.ARCHIVE_DB_PATH)
  : path.join(os.homedir(), ".gameops", "archive.db");
const backupDir = process.env.ARCHIVE_BACKUP_DIR
  ? path.resolve(process.env.ARCHIVE_BACKUP_DIR)
  : path.join(path.dirname(databasePath), "backups");
const keepRaw = Number.parseInt(process.env.ARCHIVE_BACKUP_KEEP, 10);
const keep = Number.isFinite(keepRaw) ? Math.min(100, Math.max(1, keepRaw)) : 7;

if (!fs.existsSync(databasePath)) {
  console.error("未找到存档数据库：" + databasePath);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const destination = path.join(backupDir, "archive-" + stamp + ".db");
const escapedDestination = "'" + destination.replace(/'/g, "''") + "'";

try {
  const db = new DatabaseSync(databasePath);
  db.exec("VACUUM INTO " + escapedDestination);
  db.close();
  fs.chmodSync(destination, 0o600);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
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

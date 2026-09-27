const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadProjectEnv } = require("../lib/env-file");
const { assertSqliteIntegrity, sha256File, verifyArchiveBackup } = require("../lib/archive-backup");

const root = path.resolve(__dirname, "..");
loadProjectEnv(root);

const args = process.argv.slice(2);
const serviceStopped = args.includes("--service-stopped");
const backupArgument = args.find((value) => value !== "--service-stopped");
if (!backupArgument || args.length !== 2 || !serviceStopped) {
  console.error("用法：npm run archive:restore -- /path/to/archive-YYYYMMDDHHMMSSmmm.db --service-stopped");
  console.error("先停止 archive 服务；此命令会替换当前数据库，并在旁边保留恢复前副本。");
  process.exit(2);
}

const databasePath = process.env.ARCHIVE_DB_PATH
  ? path.resolve(process.env.ARCHIVE_DB_PATH)
  : path.join(os.homedir(), ".gameops", "archive.db");
const sidecarSuffixes = ["-wal", "-shm", "-journal"];
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "") + "-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
const stagePath = databasePath + ".restore-stage-" + stamp;
const safetyPath = databasePath + ".pre-restore-" + stamp;

function preserveFile(source, destination) {
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
}

try {
  const backup = verifyArchiveBackup(backupArgument);
  if (backup.path === databasePath || (fs.existsSync(databasePath) && fs.realpathSync(backup.path) === fs.realpathSync(databasePath))) {
    throw new Error("备份文件不能与当前数据库相同");
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  preserveFile(backup.path, stagePath);
  if (sha256File(stagePath) !== backup.digest) throw new Error("备份在复制期间发生变化，已取消恢复");
  assertSqliteIntegrity(stagePath);

  const existingFiles = [];
  if (fs.existsSync(databasePath)) existingFiles.push([databasePath, safetyPath]);
  for (const suffix of sidecarSuffixes) {
    const sidecar = databasePath + suffix;
    if (fs.existsSync(sidecar)) existingFiles.push([sidecar, safetyPath + suffix]);
  }
  for (const [source, destination] of existingFiles) preserveFile(source, destination);

  const removedSidecars = [];
  try {
    for (const suffix of sidecarSuffixes) {
      const sidecar = databasePath + suffix;
      if (!fs.existsSync(sidecar)) continue;
      fs.unlinkSync(sidecar);
      removedSidecars.push(suffix);
    }
    fs.renameSync(stagePath, databasePath);
  } catch (error) {
    for (const suffix of removedSidecars) {
      const sidecar = databasePath + suffix;
      const preservedSidecar = safetyPath + suffix;
      if (!fs.existsSync(sidecar) && fs.existsSync(preservedSidecar)) {
        fs.copyFileSync(preservedSidecar, sidecar);
        fs.chmodSync(sidecar, 0o600);
      }
    }
    throw error;
  }

  console.log("存档恢复完成：" + databasePath);
  console.log(existingFiles.length
    ? "恢复前数据库与侧文件已保留为：" + safetyPath + "（侧文件带 -wal/-shm/-journal 后缀）"
    : "恢复前不存在数据库文件，无恢复前副本。");
} catch (error) {
  console.error("存档恢复失败：" + error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(stagePath, { force: true });
}

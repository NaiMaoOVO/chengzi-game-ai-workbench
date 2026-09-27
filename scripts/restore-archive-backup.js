const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { loadProjectEnv } = require("../lib/env-file");
const { parseIntegerConfig } = require("../lib/http-guards");
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

let archivePort;
try {
  archivePort = parseIntegerConfig(process.env.ARCHIVE_PORT, { name: "ARCHIVE_PORT", min: 1, max: 65535, defaultValue: 8796 });
} catch (error) {
  console.error("存档恢复失败：" + error.message);
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

function assertArchiveServiceStopped() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: archivePort, path: "/health" }, (response) => {
      response.resume();
      response.once("end", () => reject(new Error(`127.0.0.1:${archivePort} 仍有服务响应，已拒绝恢复`)));
    });
    request.setTimeout(1000, () => request.destroy(Object.assign(new Error("健康检查超时"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve();
      else reject(new Error(`无法确认 archive 服务已停止：${error.message}`));
    });
  });
}

async function restoreArchive() {
  try {
    await assertArchiveServiceStopped();
    const backup = verifyArchiveBackup(backupArgument);
    if (backup.path === databasePath || (fs.existsSync(databasePath) && fs.realpathSync(backup.path) === fs.realpathSync(databasePath))) {
      throw new Error("备份文件不能与当前数据库相同");
    }

    const existingFiles = [];
    for (const suffix of ["", ...sidecarSuffixes]) {
      const source = databasePath + suffix;
      try {
        const stats = fs.lstatSync(source);
        if (stats.isSymbolicLink()) throw new Error("存档恢复拒绝符号链接文件：" + path.basename(source));
        if (!stats.isFile()) throw new Error("存档恢复拒绝非普通文件：" + path.basename(source));
        existingFiles.push([source, suffix ? safetyPath + suffix : safetyPath]);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    preserveFile(backup.path, stagePath);
    if (sha256File(stagePath) !== backup.digest) throw new Error("备份在复制期间发生变化，已取消恢复");
    assertSqliteIntegrity(stagePath);

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
}

restoreArchive();

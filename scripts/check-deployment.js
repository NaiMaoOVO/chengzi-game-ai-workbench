const os = require("node:os");
const path = require("node:path");
const { assertSafeArchiveBackupDirectory, parseArchiveBackupKeep } = require("../lib/archive-backup");
const { buildLlmCompletionUrl } = require("../lib/platform-provider");

try {
  require("../ecosystem.config.js");
  buildLlmCompletionUrl(process.env.LLM_BASE_URL || "https://api.deepseek.com/v1");
  parseArchiveBackupKeep(process.env.ARCHIVE_BACKUP_KEEP);
  const databasePath = process.env.ARCHIVE_DB_PATH
    ? path.resolve(process.env.ARCHIVE_DB_PATH)
    : path.join(os.homedir(), ".gameops", "archive.db");
  const backupDirectory = process.env.ARCHIVE_BACKUP_DIR
    ? path.resolve(process.env.ARCHIVE_BACKUP_DIR)
    : path.join(path.dirname(databasePath), "backups");
  assertSafeArchiveBackupDirectory(backupDirectory);
  console.log("deployment environment ok");
} catch (error) {
  const message = String(error && error.message ? error.message : "未知错误").split(/\r?\n/, 1)[0];
  console.error(`部署检查失败：${message}`);
  process.exitCode = 1;
}

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertSafeArchiveBackupDirectory, verifyArchiveBackup } = require("./archive-backup");
const { businessDate } = require("./business-date");

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 10 * 1000;

function isAutomaticBackupEnabled(env = process.env) {
  if (env.ARCHIVE_AUTO_BACKUP_ENABLED === "1") return true;
  if (env.ARCHIVE_AUTO_BACKUP_ENABLED === "0" || env.NODE_TEST_CONTEXT) return false;
  return true;
}

function backupProcessEnvironment(env) {
  const childEnv = { HOME: env.HOME || os.homedir() };
  for (const key of ["ARCHIVE_DB_PATH", "ARCHIVE_BACKUP_DIR", "ARCHIVE_BACKUP_KEEP", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return childEnv;
}

function hasVerifiedBackupForBusinessDate(backupDir, targetDate) {
  const directory = assertSafeArchiveBackupDirectory(backupDir);
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }

  const candidates = names
    .filter((name) => /^archive-.*\.db$/.test(name))
    .map((name) => ({ name, filePath: path.join(directory, name) }))
    .map((candidate) => {
      try {
        const stats = fs.lstatSync(candidate.filePath);
        return stats.isFile() && businessDate(stats.mtime) === targetDate
          ? { ...candidate, modifiedAt: stats.mtimeMs }
          : null;
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  for (const candidate of candidates) {
    try {
      verifyArchiveBackup(candidate.filePath);
      return true;
    } catch (_error) {
      // A corrupt current-day copy is not a recovery point; allow a fresh backup.
    }
  }
  return false;
}

function createArchiveBackupScheduler(options = {}) {
  const env = options.env || process.env;
  const enabled = options.enabled === undefined ? isAutomaticBackupEnabled(env) : Boolean(options.enabled);
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const databasePath = path.resolve(options.databasePath || env.ARCHIVE_DB_PATH || path.join(os.homedir(), ".gameops", "archive.db"));
  const backupDir = path.resolve(options.backupDir || env.ARCHIVE_BACKUP_DIR || path.join(path.dirname(databasePath), "backups"));
  const now = options.now || (() => new Date());
  const hasVerifiedBackup = options.hasVerifiedBackup || ((directory, date) => hasVerifiedBackupForBusinessDate(directory, date));
  const spawnBackup = options.spawnBackup || (() => spawn(process.execPath, [path.join(root, "scripts", "backup-archive.js")], {
    cwd: root,
    env: backupProcessEnvironment(env),
    stdio: ["ignore", "ignore", "pipe"]
  }));
  const logger = options.logger || console;
  const checkIntervalMs = options.checkIntervalMs || DEFAULT_CHECK_INTERVAL_MS;
  const startDelayMs = options.startDelayMs || DEFAULT_START_DELAY_MS;
  let lastCompletedDate = "";
  let backupChild = null;
  let intervalTimer = null;
  let initialTimer = null;

  function check() {
    if (!enabled) return { status: "disabled" };
    if (backupChild) return { status: "running" };
    const runDate = businessDate(now());
    if (lastCompletedDate === runDate) return { status: "already-backed-up" };

    try {
      if (hasVerifiedBackup(backupDir, runDate)) {
        lastCompletedDate = runDate;
        return { status: "backup-found" };
      }
    } catch (error) {
      logger.warn("自动存档备份检查失败，稍后重试：" + error.message);
      return { status: "check-failed" };
    }

    try {
      const child = spawnBackup({ root, databasePath, backupDir, env, date: runDate });
      if (!child || typeof child.once !== "function") throw new Error("备份进程未能启动");
      backupChild = child;
      let errorOutput = "";
      child.stderr?.on("data", (chunk) => {
        if (errorOutput.length < 1200) errorOutput += chunk.toString("utf8").slice(0, 1200 - errorOutput.length);
      });
      child.once("error", (error) => {
        if (backupChild !== child) return;
        backupChild = null;
        logger.error("自动存档备份启动失败：" + error.message);
      });
      child.once("exit", (code, signal) => {
        if (backupChild !== child) return;
        backupChild = null;
        if (code === 0 && !signal) {
          lastCompletedDate = runDate;
          logger.log("自动存档备份完成（上海业务日 " + runDate + "）");
          return;
        }
        const details = errorOutput.trim();
        logger.error("自动存档备份失败（" + (signal ? "signal " + signal : "exit " + code) + "）" + (details ? "：" + details : ""));
      });
      return { status: "started" };
    } catch (error) {
      logger.error("自动存档备份启动失败：" + error.message);
      return { status: "spawn-failed" };
    }
  }

  function start() {
    if (!enabled || intervalTimer || initialTimer) return false;
    initialTimer = setTimeout(() => {
      initialTimer = null;
      check();
    }, startDelayMs);
    intervalTimer = setInterval(check, checkIntervalMs);
    initialTimer.unref?.();
    intervalTimer.unref?.();
    return true;
  }

  function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
    if (backupChild && backupChild.exitCode === null) backupChild.kill("SIGTERM");
    backupChild = null;
  }

  return { check, start, stop };
}

module.exports = { backupProcessEnvironment, createArchiveBackupScheduler, hasVerifiedBackupForBusinessDate, isAutomaticBackupEnabled };

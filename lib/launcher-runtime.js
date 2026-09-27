const fs = require("node:fs");
const path = require("node:path");

function preserveRuntimeEnv(projectEnvPath, currentRuntimePath, stagingRuntimePath) {
  const runtimeEnvPath = path.join(currentRuntimePath, ".env");
  const source = fs.statSync(runtimeEnvPath, { throwIfNoEntry: false })?.isFile()
    ? runtimeEnvPath
    : projectEnvPath && fs.statSync(projectEnvPath, { throwIfNoEntry: false })?.isFile()
      ? projectEnvPath
      : null;
  if (!source) return false;
  const destination = path.join(stagingRuntimePath, ".env");
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
  return true;
}

function replaceDirectoriesWithRollback(replacements, afterReplace = () => {}, hooks = {}) {
  const moved = [];
  try {
    for (const { targetPath, stagingPath } of replacements) {
      const backupPath = `${targetPath}.backup-${process.pid}`;
      if (fs.existsSync(backupPath)) throw new Error(`备份目录已存在：${backupPath}`);
      const hadTarget = fs.statSync(targetPath, { throwIfNoEntry: false })?.isDirectory();
      if (hadTarget) fs.renameSync(targetPath, backupPath);
      moved.push({ targetPath, backupPath, hadTarget });
      hooks.afterBackup?.();
      fs.renameSync(stagingPath, targetPath);
    }
    afterReplace();
  } catch (error) {
    for (const { targetPath, backupPath, hadTarget } of moved.reverse()) {
      if (fs.statSync(targetPath, { throwIfNoEntry: false })?.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      if (hadTarget && fs.statSync(backupPath, { throwIfNoEntry: false })?.isDirectory()) {
        fs.renameSync(backupPath, targetPath);
      }
    }
    throw error;
  }
  for (const { backupPath, hadTarget } of moved) {
    if (hadTarget) fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

function replaceDirectoryWithRollback(targetPath, stagingPath, hooks = {}) {
  replaceDirectoriesWithRollback([{ targetPath, stagingPath }], () => {}, hooks);
}

function retryRegistration(register, pause, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      register();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      pause();
    }
  }
}

function writeLauncherSyncStatus(projectRoot, payload) {
  const target = path.join(projectRoot, "launcher-sync-status.js");
  fs.writeFileSync(target, "// 由 launcher 脚本自动生成，请勿手工编辑\nwindow.__LAUNCHER_SYNC__ = " + JSON.stringify(payload) + ";\n", { mode: 0o644 });
}

module.exports = { preserveRuntimeEnv, replaceDirectoryWithRollback, replaceDirectoriesWithRollback, retryRegistration, writeLauncherSyncStatus };

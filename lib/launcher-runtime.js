const fs = require("node:fs");
const path = require("node:path");

function preserveRuntimeEnv(projectEnvPath, currentRuntimePath, stagingRuntimePath) {
  const source = projectEnvPath && fs.statSync(projectEnvPath, { throwIfNoEntry: false })?.isFile()
    ? projectEnvPath
    : path.join(currentRuntimePath, ".env");
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) return false;
  const destination = path.join(stagingRuntimePath, ".env");
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
  return true;
}

function replaceDirectoryWithRollback(targetPath, stagingPath, hooks = {}) {
  const backupPath = `${targetPath}.backup-${process.pid}`;
  fs.rmSync(backupPath, { recursive: true, force: true });
  const hadTarget = fs.statSync(targetPath, { throwIfNoEntry: false })?.isDirectory();
  try {
    if (hadTarget) fs.renameSync(targetPath, backupPath);
    hooks.afterBackup?.();
    fs.renameSync(stagingPath, targetPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    if (fs.statSync(targetPath, { throwIfNoEntry: false })?.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    if (hadTarget && fs.statSync(backupPath, { throwIfNoEntry: false })?.isDirectory()) {
      fs.renameSync(backupPath, targetPath);
    }
    throw error;
  }
}

module.exports = { preserveRuntimeEnv, replaceDirectoryWithRollback };

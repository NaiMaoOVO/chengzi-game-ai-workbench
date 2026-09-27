const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const MAX_CHECKSUM_BYTES = 512;

function parseArchiveBackupKeep(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 7;
  const keep = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(keep) || keep < 1 || keep > 100) {
    throw new Error("ARCHIVE_BACKUP_KEEP 必须是 1-100 的整数");
  }
  return keep;
}

function canonicalizePath(inputPath) {
  const target = path.resolve(inputPath);
  const missingParts = [];
  let existing = target;
  while (true) {
    try {
      fs.lstatSync(existing);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("备份目录路径无法解析");
      missingParts.unshift(path.basename(existing));
      existing = parent;
    }
  }
  return path.resolve(fs.realpathSync(existing), ...missingParts);
}

function pathDepth(target) {
  const root = path.parse(target).root;
  return path.relative(root, target).split(path.sep).filter(Boolean).length;
}

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(candidate, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function assertSafeArchiveBackupDirectory(directoryPath) {
  const requested = path.resolve(directoryPath);
  const canonical = canonicalizePath(requested);
  const home = canonicalizePath(os.homedir());
  if (pathDepth(requested) < 2 || pathDepth(canonical) < 2 || isSameOrAncestor(canonical, home)) {
    throw new Error("备份目录不能指向文件系统根目录、系统一级目录或用户主目录及其上级目录");
  }
  return canonical;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSqliteIntegrity(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error("SQLite 完整性检查失败");
  } finally {
    db?.close();
  }
}

function verifyArchiveBackup(filePath) {
  const target = path.resolve(filePath);
  if (!/^archive-.*\.db$/.test(path.basename(target))) throw new Error("请提供 archive-*.db 备份文件路径");
  const checksumPath = target + ".sha256";
  const checksumStats = fs.statSync(checksumPath);
  if (!checksumStats.isFile() || checksumStats.size > MAX_CHECKSUM_BYTES) throw new Error("校验文件过大或格式无效");
  const checksumParts = fs.readFileSync(checksumPath, "utf8").trim().split(/\s+/);
  const [expected, fileName, ...extra] = checksumParts;
  if (extra.length || fileName !== path.basename(target)) throw new Error("校验文件名或格式无效");
  if (!/^[a-f0-9]{64}$/.test(expected || "")) throw new Error("校验文件格式无效");
  if (sha256File(target) !== expected) throw new Error("SHA-256 不匹配");
  assertSqliteIntegrity(target);
  return { path: target, digest: expected };
}

module.exports = { assertSafeArchiveBackupDirectory, assertSqliteIntegrity, parseArchiveBackupKeep, sha256File, verifyArchiveBackup };

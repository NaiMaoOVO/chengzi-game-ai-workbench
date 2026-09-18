const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const target = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!target || !/^archive-.*\.db$/.test(path.basename(target))) {
  console.error("请提供 archive-*.db 备份文件路径");
  process.exit(2);
}

try {
  const checksumFile = target + ".sha256";
  const checksumParts = fs.readFileSync(checksumFile, "utf8").trim().split(/\s+/);
  const expected = checksumParts[0];
  if (checksumParts[1] !== path.basename(target)) throw new Error("校验文件名与备份文件不匹配");
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("校验文件格式无效");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  if (actual !== expected) throw new Error("SHA-256 不匹配");
  let db;
  try {
    db = new DatabaseSync(target, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error("SQLite 完整性检查失败");
  } finally {
    db?.close();
  }
  console.log("备份校验通过：" + target);
} catch (error) {
  console.error("备份校验失败：" + error.message);
  process.exit(1);
}

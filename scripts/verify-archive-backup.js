const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const target = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!target || !/^archive-.*\.db$/.test(path.basename(target))) {
  console.error("请提供 archive-*.db 备份文件路径");
  process.exit(2);
}

try {
  const checksumFile = target + ".sha256";
  const expected = fs.readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("校验文件格式无效");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  if (actual !== expected) throw new Error("SHA-256 不匹配");
  console.log("备份校验通过：" + target);
} catch (error) {
  console.error("备份校验失败：" + error.message);
  process.exit(1);
}

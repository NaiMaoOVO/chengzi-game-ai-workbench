const path = require("node:path");
const { verifyArchiveBackup } = require("../lib/archive-backup");

const target = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!target || !/^archive-.*\.db$/.test(path.basename(target))) {
  console.error("请提供 archive-*.db 备份文件路径");
  process.exit(2);
}

try {
  verifyArchiveBackup(target);
  console.log("备份校验通过：" + target);
} catch (error) {
  console.error("备份校验失败：" + error.message);
  process.exit(1);
}

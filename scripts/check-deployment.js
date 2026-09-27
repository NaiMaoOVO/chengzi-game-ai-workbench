try {
  require("../ecosystem.config.js");
  console.log("deployment environment ok");
} catch (error) {
  const message = String(error && error.message ? error.message : "未知错误").split(/\r?\n/, 1)[0];
  console.error(`部署检查失败：${message}`);
  process.exitCode = 1;
}

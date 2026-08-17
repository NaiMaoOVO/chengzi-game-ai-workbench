const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = ["index.html", "styles.css", "utils.js", "launcher.js", "app.js"];
const stale = files.filter((file) => {
  const source = path.join(root, file);
  const built = path.join(root, "public", file);
  return !fs.existsSync(built) || !fs.readFileSync(source).equals(fs.readFileSync(built));
});

if (stale.length) {
  console.error(`public 构建产物已过期：${stale.join("、")}。请执行 npm run build:public。`);
  process.exit(1);
}

console.log("public 构建产物与源码一致");

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = ["index.html", "styles.css", "utils.js", "launcher.js", "app.js", "lib/project-slots.js", "lib/ui-guards.js", "lib/safe-storage.js"];
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

const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const references = [
  ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]),
  ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((match) => match[1])
].filter((value) => value.startsWith("./"));
const missingReferences = references.filter((reference) => !fs.existsSync(path.join(root, "public", reference.slice(2))));
if (missingReferences.length) {
  console.error(`public 页面引用了不存在的资源：${missingReferences.join("、")}`);
  process.exit(1);
}

console.log("public 页面本地资源引用完整");

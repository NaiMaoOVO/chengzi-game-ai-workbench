const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const files = ["index.html", "styles.css", "utils.js", "launcher.js", "creator-ranking.js", "daily-workbench.js", "app.js", "lib/business-date.js", "lib/project-slots.js", "lib/ui-guards.js", "lib/safe-storage.js"];
// index.html 在构建时被注入资源内容指纹（?v=...），比对前先剥离再比较。
function normalized(file) {
  return fs.readFileSync(file, "utf8").replace(/(src|href)="\.\/([^"?]+)\?v=[0-9a-f]{16}"/g, '$1="./$2"');
}
const stale = files.filter((file) => {
  const source = path.join(root, file);
  const built = path.join(root, "public", file);
  if (!fs.existsSync(built)) return true;
  return file === "index.html"
    ? normalized(source) !== normalized(built)
    : !fs.readFileSync(source).equals(fs.readFileSync(built));
});

if (stale.length) {
  console.error(`public 构建产物已过期：${stale.join("、")}。请执行 npm run build:public。`);
  process.exit(1);
}

console.log("public 构建产物与源码一致");

function fingerprint(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex").slice(0, 16);
}

const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const references = [
  ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]),
  ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((match) => match[1])
];
// launcher-sync-status.js 由本机 launcher 脚本生成，线上部署与全新克隆中不存在属正常现象。
const optionalReferences = new Set(["./launcher-sync-status.js"]);
const missingReferences = [];
const staleFingerprints = [];

for (const reference of references) {
  const [pathname, query] = reference.slice(2).split("?");
  if (optionalReferences.has(reference)) continue;
  if (!fs.existsSync(path.join(root, "public", pathname))) {
    missingReferences.push(reference);
    continue;
  }
  if (!files.includes(pathname)) continue;
  const params = new URLSearchParams(query || "");
  if (params.get("v") !== fingerprint(pathname)) {
    staleFingerprints.push(reference);
  }
}

if (missingReferences.length) {
  console.error(`public 页面引用了不存在的资源：${missingReferences.join("、")}`);
  process.exit(1);
}
if (staleFingerprints.length) {
  console.error(`public 页面资源指纹与内容不一致（请重新执行 npm run build:public）：${staleFingerprints.join("、")}`);
  process.exit(1);
}

console.log("public 页面本地资源引用完整，内容指纹有效");

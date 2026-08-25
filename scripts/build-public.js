const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "public");
const files = ["index.html", "styles.css", "utils.js", "launcher.js", "app.js", "lib/project-slots.js", "lib/ui-guards.js", "lib/safe-storage.js"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}

// 静态资源内容指纹：线上发版后浏览器立即拉新文件，不再吃旧缓存。
function fingerprint(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(output, file))).digest("hex").slice(0, 16);
}

const htmlPath = path.join(output, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
html = html.replace(/(src|href)="\.\/([^"']+)"/g, (match, attr, target) => {
  if (!files.includes(target)) return match;
  return attr + '="./' + target + '?v=' + fingerprint(target) + '"';
});
fs.writeFileSync(htmlPath, html);

console.log(`Built ${files.length} public assets in ${output}`);

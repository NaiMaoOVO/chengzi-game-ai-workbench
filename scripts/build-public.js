const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "public");
const sourceFiles = ["index.html", "styles.css", "utils.js", "launcher.js", "creator-ranking.js", "app.js", "daily-workbench.js", "lib/business-date.js", "lib/project-slots.js", "lib/ui-guards.js", "lib/safe-storage.js"];
const generatedFiles = { "launcher-sync-status.js": "// Public pages do not control a local launcher.\nwindow.__LAUNCHER_SYNC__ = null;\n" };
const files = [...sourceFiles, ...Object.keys(generatedFiles)];

fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (Object.prototype.hasOwnProperty.call(generatedFiles, file)) fs.writeFileSync(destination, generatedFiles[file]);
  else fs.copyFileSync(path.join(root, file), destination);
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

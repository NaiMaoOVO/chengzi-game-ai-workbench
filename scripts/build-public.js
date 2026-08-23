const fs = require("node:fs");
const path = require("node:path");

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

console.log(`Built ${files.length} public assets in ${output}`);

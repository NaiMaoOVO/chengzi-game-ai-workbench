const fs = require("node:fs");

function parseEnvFile(text) {
  const output = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

function loadEnvFile(filePath = ".env") {
  try {
    return parseEnvFile(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function loadProjectEnv(root) {
  const values = loadEnvFile(require("node:path").join(root, ".env"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

module.exports = { parseEnvFile, loadEnvFile, loadProjectEnv };

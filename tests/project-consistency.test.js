const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("project checks and logs include the LLM service", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(pkg.scripts.check, /node --check llm-server\.js/);
  assert.match(pkg.scripts["deploy:logs"], /gameops-llm/);
  assert.equal(pkg.scripts.test, "node --test tests/*.test.js");
});

test("README describes all four services and the online LLM route", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert.match(readme, /启动热点、评论、OCR、AI 增强四个服务/);
  assert.match(readme, /\/api\/llm/);
});

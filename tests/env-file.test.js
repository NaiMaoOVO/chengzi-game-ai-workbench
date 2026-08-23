const test = require("node:test");
const assert = require("node:assert/strict");

const { parseEnvFile } = require("../lib/env-file");

test("env file parser supports comments, quotes and existing-value precedence", () => {
  const parsed = parseEnvFile([
    "# comment",
    "LLM_API_KEY=demo-key",
    "XIAOHONGSHU_PROVIDER_URL=\"http://127.0.0.1:18060/search\"",
    "EMPTY=",
    "INVALID"
  ].join("\n"));

  assert.deepEqual(parsed, {
    LLM_API_KEY: "demo-key",
    XIAOHONGSHU_PROVIDER_URL: "http://127.0.0.1:18060/search",
    EMPTY: ""
  });
});

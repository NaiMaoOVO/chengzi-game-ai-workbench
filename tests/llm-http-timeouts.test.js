const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readServerTimeouts(entrypoint, env) {
  const probe = `
    const http = require("node:http");
    const createServer = http.createServer;
    http.createServer = (...args) => {
      const server = createServer(...args);
      server.listen = function () {
        process.stdout.write(JSON.stringify({ requestTimeout: this.requestTimeout, headersTimeout: this.headersTimeout }));
        process.exit(0);
      };
      return server;
    };
    require("./${entrypoint}");
  `;
  const result = spawnSync(process.execPath, ["-e", probe], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const { name, entrypoint, env, expected } of [
  { name: "hotspot", entrypoint: "hotspot-server.js", env: { HOTSPOT_PORT: "19531", UPSTREAM_TIMEOUT_MS: "600000" }, expected: { requestTimeout: 60000, headersTimeout: 10000 } },
  { name: "comment", entrypoint: "comment-server.js", env: { COMMENT_PORT: "19532", UPSTREAM_TIMEOUT_MS: "600000" }, expected: { requestTimeout: 60000, headersTimeout: 10000 } },
  { name: "OCR", entrypoint: "ocr-server.js", env: { PORT: "19533", OCR_PROVIDER: "remote", OCR_TIMEOUT_MS: "600000" }, expected: { requestTimeout: 120000, headersTimeout: 10000 } },
  { name: "LLM", entrypoint: "llm-server.js", env: { LLM_PORT: "19534", LLM_TIMEOUT_MS: "600000" }, expected: { requestTimeout: 60000, headersTimeout: 10000 } }
]) {
  test(`${name} upstream timeout cannot extend inbound HTTP limits`, () => {
    assert.deepEqual(readServerTimeouts(entrypoint, env), expected);
  });
}

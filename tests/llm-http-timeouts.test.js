const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("LLM upstream timeout cannot extend the inbound HTTP request timeout", () => {
  const probe = `
    const http = require("node:http");
    const createServer = http.createServer;
    http.createServer = (...args) => {
      const server = createServer(...args);
      server.listen = function () {
        process.stdout.write(JSON.stringify({ requestTimeout: this.requestTimeout, headersTimeout: this.headersTimeout }));
        return this;
      };
      return server;
    };
    require("./llm-server.js");
  `;
  const result = spawnSync(process.execPath, ["-e", probe], {
    cwd: root,
    env: { ...process.env, LLM_PORT: "19537", LLM_TIMEOUT_MS: "600000" },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { requestTimeout: 60000, headersTimeout: 10000 });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const checkScript = path.join(projectRoot, "scripts", "check-deployment.js");

function runCheck(allowedOrigin, extraEnv = {}) {
  return spawnSync(process.execPath, [checkScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ALLOWED_ORIGIN: allowedOrigin,
      ALLOW_FILE_ORIGIN: "0",
      ARCHIVE_AUTH_ENABLED: "0",
      ARCHIVE_ADMIN_PASSWORD: "",
      LLM_BASE_URL: "https://api.deepseek.com/v1",
      OCR_PROVIDER: "macos",
      ...extraEnv
    },
    encoding: "utf8"
  });
}

test("deployment check gives an actionable one-line error for a placeholder public origin", () => {
  const result = runCheck("https://example.com");
  const output = (result.stdout + result.stderr).trim();

  assert.equal(result.status, 1);
  assert.match(output, /部署前必须设置 ALLOWED_ORIGIN/);
  assert.equal(output.split(/\r?\n/).length, 1);
  assert.doesNotMatch(output, /at Object\.|at Module\._compile|ecosystem\.config\.js:\d+/);
});

test("deployment check accepts a real configured HTTPS origin", () => {
  const result = runCheck("https://gameops.test");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deployment environment ok/);
});

test("deployment check never prints configured archive credentials", () => {
  const secret = "canary";
  const result = runCheck("https://gameops.test", {
    ARCHIVE_AUTH_ENABLED: "1",
    ARCHIVE_ADMIN_PASSWORD: secret
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /至少 12 位/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

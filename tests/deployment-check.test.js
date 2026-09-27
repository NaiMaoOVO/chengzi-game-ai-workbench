const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const checkScript = path.join(projectRoot, "scripts", "check-deployment.js");

function deploymentEnv(allowedOrigin, extraEnv = {}) {
  return {
    ...process.env,
    ALLOWED_ORIGIN: allowedOrigin,
    ALLOW_FILE_ORIGIN: "0",
    ARCHIVE_AUTH_ENABLED: "0",
    ARCHIVE_ADMIN_PASSWORD: "",
    LLM_BASE_URL: "https://api.deepseek.com/v1",
    OCR_PROVIDER: "macos",
    ...extraEnv
  };
}

function runCheck(allowedOrigin, extraEnv = {}) {
  return spawnSync(process.execPath, [checkScript], {
    cwd: projectRoot,
    env: deploymentEnv(allowedOrigin, extraEnv),
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
  const result = runCheck("https://gameops.test, https://staging.gameops.test, https://notexample.com");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deployment environment ok/);
});

test("deployment check rejects malformed, insecure and local public origins", () => {
  const invalidOrigins = [
    "not-a-url",
    "http://gameops.test",
    "https://localhost",
    "https://127.0.0.1:8793",
    "https://[::1]:8793",
    "https://gameops.test/path",
    "https://gameops.test, http://localhost:8793"
  ];

  for (const origin of invalidOrigins) {
    const result = runCheck(origin);
    const output = result.stdout + result.stderr;

    assert.equal(result.status, 1, `unexpectedly accepted ${origin}`);
    assert.match(output, /ALLOWED_ORIGIN 必须是一个或多个 HTTPS 源/);
    assert.doesNotMatch(output, /at Object\.|ecosystem\.config\.js:\d+/);
  }
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

test("PM2 archive process receives the configured auth settings without printing the password", () => {
  const password = "archive-config-canary-123";
  const inspectConfig = [
    'const archive = require("./ecosystem.config.js").apps.find((app) => app.name === "gameops-archive");',
    'const env = archive.env;',
    'console.log(JSON.stringify({',
    '  authEnabled: env.ARCHIVE_AUTH_ENABLED === "1",',
    '  usernameMatches: env.ARCHIVE_ADMIN_USERNAME === process.env.ARCHIVE_ADMIN_USERNAME,',
    '  passwordMatches: env.ARCHIVE_ADMIN_PASSWORD === process.env.ARCHIVE_ADMIN_PASSWORD,',
    '  secureCookie: env.ARCHIVE_COOKIE_SECURE === "1",',
    '  sessionHours: env.ARCHIVE_SESSION_HOURS === "8"',
    '}));'
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", inspectConfig], {
    cwd: projectRoot,
    env: deploymentEnv("https://gameops.test", {
      ARCHIVE_AUTH_ENABLED: "1",
      ARCHIVE_ADMIN_USERNAME: "studio-admin",
      ARCHIVE_ADMIN_PASSWORD: password,
      ARCHIVE_COOKIE_SECURE: "1",
      ARCHIVE_SESSION_HOURS: "8"
    }),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    authEnabled: true,
    usernameMatches: true,
    passwordMatches: true,
    secureCookie: true,
    sessionHours: true
  });
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
});

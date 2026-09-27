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
    ARCHIVE_AUTH_ENABLED: "1",
    ARCHIVE_ADMIN_PASSWORD: "deployment-test-password",
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

test("deployment check refuses online archive access without authentication", () => {
  const result = runCheck("https://gameops.test", { ARCHIVE_AUTH_ENABLED: "0" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /线上部署必须设置 ARCHIVE_AUTH_ENABLED=1/);
});

test("deployment check validates archive backup retention boundaries", () => {
  for (const value of ["1junk", "0", "101", "1.5", "NaN", "Infinity"]) {
    const result = runCheck("https://gameops.test", { ARCHIVE_BACKUP_KEEP: value });
    assert.equal(result.status, 1, `ARCHIVE_BACKUP_KEEP=${value} unexpectedly passed deployment checks`);
    assert.match(result.stderr, /ARCHIVE_BACKUP_KEEP 必须是 1-100 的整数/);
  }

  for (const value of ["1", "100"]) {
    const result = runCheck("https://gameops.test", { ARCHIVE_BACKUP_KEEP: value });
    assert.equal(result.status, 0, `ARCHIVE_BACKUP_KEEP=${value} should be accepted: ${result.stderr}`);
  }
});

test("deployment check rejects unsupported OCR providers and normalizes remote provider names", () => {
  const unsupported = runCheck("https://gameops.test", { OCR_PROVIDER: "unknown" });
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /OCR_PROVIDER 必须是 macos 或 remote/);

  const missingRemoteUrl = runCheck("https://gameops.test", {
    OCR_PROVIDER: " REMOTE ",
    OCR_REMOTE_URL: ""
  });
  assert.equal(missingRemoteUrl.status, 1);
  assert.match(missingRemoteUrl.stderr, /OCR_PROVIDER=remote 时必须设置真实的 OCR_REMOTE_URL/);

  const normalizedRemoteUrl = runCheck("https://gameops.test", {
    OCR_PROVIDER: " REMOTE ",
    OCR_REMOTE_URL: "https://ocr-provider.test/api"
  });
  assert.equal(normalizedRemoteUrl.status, 0, normalizedRemoteUrl.stderr);

  const config = spawnSync(process.execPath, ["-e", 'console.log(require("./ecosystem.config.js").apps.find((app) => app.name === "gameops-ocr").env.OCR_PROVIDER)'], {
    cwd: projectRoot,
    env: deploymentEnv("https://gameops.test", {
      OCR_PROVIDER: " REMOTE ",
      OCR_REMOTE_URL: "https://ocr-provider.test/api"
    }),
    encoding: "utf8"
  });
  assert.equal(config.status, 0, config.stderr);
  assert.equal(config.stdout.trim(), "remote");
});

test("deployment check rejects malformed rate limit settings before PM2 starts services", () => {
  const invalidSettings = [
    ["RATE_LIMIT_MAX", "not-a-number", /RATE_LIMIT_MAX 必须是正整数/],
    ["RATE_LIMIT_WINDOW_MS", "NaN", /RATE_LIMIT_WINDOW_MS 必须是 1000-2147483647 毫秒的整数/],
    ["RATE_LIMIT_WINDOW_MS", "999", /RATE_LIMIT_WINDOW_MS 必须是 1000-2147483647 毫秒的整数/],
    ["ARCHIVE_RATE_LIMIT_MAX", "0", /ARCHIVE_RATE_LIMIT_MAX 必须是正整数/],
    ["ARCHIVE_AUTH_RATE_LIMIT_MAX", "1.5", /ARCHIVE_AUTH_RATE_LIMIT_MAX 必须是正整数/],
    ["OCR_RATE_LIMIT_MAX", "Infinity", /OCR_RATE_LIMIT_MAX 必须是正整数/],
    ["LLM_RATE_LIMIT_MAX", "999999999999999999999", /LLM_RATE_LIMIT_MAX 必须是正整数/]
  ];

  for (const [name, value, message] of invalidSettings) {
    const result = runCheck("https://gameops.test", { [name]: value });
    assert.equal(result.status, 1, `${name} unexpectedly passed deployment checks`);
    assert.match(result.stderr, message);
  }
});

test("deployment check validates numeric service resource bounds", () => {
  const invalidSettings = [
    ["UPSTREAM_TIMEOUT_MS", "abc", /UPSTREAM_TIMEOUT_MS 必须是 1000-2147483647 之间的整数/],
    ["UPSTREAM_RETRIES", "abc", /UPSTREAM_RETRIES 必须是 0-3 的整数/],
    ["UPSTREAM_RETRIES", "4", /UPSTREAM_RETRIES 必须是 0-3 的整数/],
    ["CACHE_TTL_MS", "abc", /CACHE_TTL_MS 必须是非负整数/],
    ["CACHE_TTL_MS", "-1", /CACHE_TTL_MS 必须是非负整数/],
    ["OCR_TIMEOUT_MS", "-1", /OCR_TIMEOUT_MS 必须是 1-2147483647 之间的整数/],
    ["OCR_READINESS_TIMEOUT_MS", "Infinity", /OCR_READINESS_TIMEOUT_MS 必须是 1-2147483647 之间的整数/],
    ["OCR_MAX_CONCURRENCY", "0", /OCR_MAX_CONCURRENCY 必须是正整数/],
    ["LLM_TIMEOUT_MS", "NaN", /LLM_TIMEOUT_MS 必须是 1-2147483647 之间的整数/],
    ["LLM_MAX_CONCURRENCY", "Infinity", /LLM_MAX_CONCURRENCY 必须是正整数/],
    ["LLM_CACHE_TTL_MS", "-1", /LLM_CACHE_TTL_MS 必须是非负整数/],
    ["PLATFORM_PROVIDER_TIMEOUT_MS", "Infinity", /PLATFORM_PROVIDER_TIMEOUT_MS 必须是 1000-2147483647 之间的整数/],
    ["XHS_BRIDGE_TIMEOUT_MS", "Infinity", /XHS_BRIDGE_TIMEOUT_MS 必须是 1000-2147483647 之间的整数/],
    ["ARCHIVE_SESSION_HOURS", "0", /ARCHIVE_SESSION_HOURS 必须是 1-744 小时的整数/],
    ["ARCHIVE_SESSION_HOURS", "745", /ARCHIVE_SESSION_HOURS 必须是 1-744 小时的整数/]
  ];

  for (const [name, value, message] of invalidSettings) {
    const result = runCheck("https://gameops.test", { [name]: value });
    assert.equal(result.status, 1, `${name}=${value} unexpectedly passed deployment checks`);
    assert.match(result.stderr, message);
  }

  const boundaryValues = runCheck("https://gameops.test", {
    RATE_LIMIT_WINDOW_MS: "1000",
    CACHE_TTL_MS: "0",
    LLM_CACHE_TTL_MS: "0",
    UPSTREAM_RETRIES: "0",
    PLATFORM_PROVIDER_TIMEOUT_MS: "1000",
    XHS_BRIDGE_TIMEOUT_MS: "1000",
    ARCHIVE_SESSION_HOURS: "744"
  });
  assert.equal(boundaryValues.status, 0, boundaryValues.stderr);
});

test("deployment check validates configured service ports", () => {
  const invalidPorts = [
    ["HOTSPOT_PORT", "0"],
    ["COMMENT_PORT", "65536"],
    ["OCR_PORT", "abc"],
    ["LLM_PORT", "-1"],
    ["ARCHIVE_PORT", "Infinity"]
  ];

  for (const [name, value] of invalidPorts) {
    const result = runCheck("https://gameops.test", { [name]: value });
    assert.equal(result.status, 1, `${name}=${value} unexpectedly passed deployment checks`);
    assert.match(result.stderr, new RegExp(`${name} 必须是 1-65535 之间的整数`));
  }

  const highestPort = runCheck("https://gameops.test", { HOTSPOT_PORT: "65535" });
  assert.equal(highestPort.status, 0, highestPort.stderr);
});

test("deployment check validates the scheduled morning time and normalizes whitespace", () => {
  for (const value of ["9:00", "24:00", "12:60", "09:00x"]) {
    const result = runCheck("https://gameops.test", { MORNING_SCHEDULE: value });
    assert.equal(result.status, 1, `MORNING_SCHEDULE=${value} unexpectedly passed`);
    assert.match(result.stderr, /MORNING_SCHEDULE 必须是 24 小时制 HH:mm/);
  }

  const valid = runCheck("https://gameops.test", { MORNING_SCHEDULE: " 07:35 " });
  assert.equal(valid.status, 0, valid.stderr);

  const config = spawnSync(process.execPath, ["-e", 'console.log(require("./ecosystem.config.js").apps.find((app) => app.name === "gameops-archive").env.MORNING_SCHEDULE)'], {
    cwd: projectRoot,
    env: deploymentEnv("https://gameops.test", { MORNING_SCHEDULE: " 07:35 " }),
    encoding: "utf8"
  });
  assert.equal(config.status, 0, config.stderr);
  assert.equal(config.stdout.trim(), "07:35");
});

test("deployment check validates morning platforms and passes the normalized value to PM2", () => {
  const invalid = runCheck("https://gameops.test", { MORNING_PLATFORM: "未知平台" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /MORNING_PLATFORM 必须是以下平台之一/);

  const config = spawnSync(process.execPath, ["-e", 'console.log(require("./ecosystem.config.js").apps.find((app) => app.name === "gameops-archive").env.MORNING_PLATFORM)'], {
    cwd: projectRoot,
    env: deploymentEnv("https://gameops.test", { MORNING_PLATFORM: "  抖音 " }),
    encoding: "utf8"
  });
  assert.equal(config.status, 0, config.stderr);
  assert.equal(config.stdout.trim(), "抖音");
});

test("deployment check validates production admin and remote OCR transport", () => {
  const invalidConfigs = [
    [{ ARCHIVE_ADMIN_USERNAME: "bad username" }, /ARCHIVE_ADMIN_USERNAME 必须是 3-40 位/],
    [{ ARCHIVE_ADMIN_PASSWORD: "x".repeat(201) }, /ARCHIVE_ADMIN_PASSWORD 必须是 12-200 位/],
    [{ ARCHIVE_ADMIN_PASSWORD: "请使用至少 12 位的随机强密码" }, /不能使用示例或常见占位值/],
    [{ ARCHIVE_ADMIN_PASSWORD: "change-me" }, /不能使用示例或常见占位值/],
    [{ ARCHIVE_COOKIE_SECURE: "0" }, /线上部署必须保持 ARCHIVE_COOKIE_SECURE=1/],
    [{ OCR_PROVIDER: "remote", OCR_REMOTE_URL: "not-a-url" }, /OCR_REMOTE_URL 必须是有效的 HTTP\/HTTPS URL/],
    [{ OCR_PROVIDER: "remote", OCR_REMOTE_URL: "ftp://ocr.test/api" }, /OCR_REMOTE_URL 必须是有效的 HTTP\/HTTPS URL/],
    [{ OCR_PROVIDER: "remote", OCR_REMOTE_URL: "http://ocr-provider.test/api" }, /公网 OCR 使用 HTTP 时必须设置 OCR_ALLOW_INSECURE_REMOTE=true/],
    [{ OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://EXAMPLE.COM/api" }, /OCR_PROVIDER=remote 时必须设置真实的 OCR_REMOTE_URL/],
    [{ OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://ocr.example.com./api" }, /OCR_PROVIDER=remote 时必须设置真实的 OCR_REMOTE_URL/]
  ];

  for (const [extraEnv, message] of invalidConfigs) {
    const result = runCheck("https://gameops.test", extraEnv);

    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});

test("deployment check accepts secure and explicitly allowed OCR transports", () => {
  const validConfigs = [
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://ocr-provider.test/api" },
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://notexample.com/api" },
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://ocr-provider.test/api/example.com" },
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "https://example.com.evil.test/api" },
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "http://127.0.0.1:8787/api" },
    { OCR_PROVIDER: "remote", OCR_REMOTE_URL: "http://ocr.internal/api", OCR_ALLOW_INSECURE_REMOTE: "true" }
  ];

  for (const config of validConfigs) {
    const result = runCheck("https://gameops.test", config);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deployment environment ok/);
  }
});

test("deployment check rejects malformed, insecure and local public origins", () => {
  const invalidOrigins = [
    "not-a-url",
    "http://gameops.test",
    "https://localhost",
    "https://localhost.",
    "https://127.0.0.1:8793",
    "https://127.0.0.1.:8793",
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
  assert.match(result.stderr, /12-200 位/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test("PM2 archive process receives the configured auth settings without printing the password", () => {
  const password = "archive-config-canary-123";
  const inspectConfig = [
    'const apps = require("./ecosystem.config.js").apps;',
    'const archive = apps.find((app) => app.name === "gameops-archive");',
    'const otherApps = apps.filter((app) => app.name !== "gameops-archive");',
    'const env = archive.env;',
    'console.log(JSON.stringify({',
    '  authEnabled: env.ARCHIVE_AUTH_ENABLED === "1",',
    '  usernameMatches: env.ARCHIVE_ADMIN_USERNAME === process.env.ARCHIVE_ADMIN_USERNAME,',
    '  passwordMatches: env.ARCHIVE_ADMIN_PASSWORD === process.env.ARCHIVE_ADMIN_PASSWORD,',
    '  secureCookie: env.ARCHIVE_COOKIE_SECURE === "1",',
    '  sessionHours: env.ARCHIVE_SESSION_HOURS === "8",',
    '  otherAppsHaveNoAuthSecrets: otherApps.every((app) => !Object.hasOwn(app.env, "ARCHIVE_ADMIN_PASSWORD") && !Object.hasOwn(app.env, "ARCHIVE_AUTH_ENABLED"))',
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
    sessionHours: true,
    otherAppsHaveNoAuthSecrets: true
  });
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
});

test("PM2 forwards integration settings only to the services that use them", () => {
  const secrets = [
    "bilibili-cookie-canary",
    "douyin-token-canary",
    "xhs-token-canary",
    "ocr-key-canary",
    "llm-key-canary"
  ];
  const inspectConfig = [
    'const configs = Object.fromEntries(require("./ecosystem.config.js").apps.map((app) => [app.name, app.env]));',
    'const hotspot = configs["gameops-hotspot"];',
    'const comment = configs["gameops-comment"];',
    'const ocr = configs["gameops-ocr"];',
    'const llm = configs["gameops-llm"];',
    'const archive = configs["gameops-archive"];',
    'const has = (env, key) => Object.hasOwn(env, key);',
    'console.log(JSON.stringify({',
    '  hotspotCookie: hotspot.BILIBILI_COOKIE === process.env.BILIBILI_COOKIE,',
    '  commentCookie: comment.BILIBILI_COOKIE === process.env.BILIBILI_COOKIE,',
    '  douyinToken: hotspot.DOUYIN_PROVIDER_TOKEN === process.env.DOUYIN_PROVIDER_TOKEN,',
    '  xhsToken: hotspot.XIAOHONGSHU_PROVIDER_TOKEN === process.env.XIAOHONGSHU_PROVIDER_TOKEN,',
    '  commentInfoUrl: comment.BILIBILI_VIDEO_INFO_URL === process.env.BILIBILI_VIDEO_INFO_URL,',
    '  ocrApiKey: ocr.OCR_REMOTE_API_KEY === process.env.OCR_REMOTE_API_KEY,',
    '  llmApiKey: llm.LLM_API_KEY === process.env.LLM_API_KEY,',
    '  llmJsonMode: llm.LLM_JSON_MODE === process.env.LLM_JSON_MODE,',
    '  morningSchedule: archive.MORNING_SCHEDULE === process.env.MORNING_SCHEDULE,',
    '  morningGames: archive.MORNING_GAMES === process.env.MORNING_GAMES,',
    '  morningPlatform: archive.MORNING_PLATFORM === process.env.MORNING_PLATFORM,',
    '  hotspotSource: archive.HOTSPOT_SOURCE_URL === process.env.HOTSPOT_SOURCE_URL,',
    '  providerTokensScoped: !has(comment, "DOUYIN_PROVIDER_TOKEN") && !has(ocr, "DOUYIN_PROVIDER_TOKEN") && !has(llm, "DOUYIN_PROVIDER_TOKEN") && !has(archive, "DOUYIN_PROVIDER_TOKEN"),',
    '  ocrKeyScoped: !has(hotspot, "OCR_REMOTE_API_KEY") && !has(comment, "OCR_REMOTE_API_KEY") && !has(llm, "OCR_REMOTE_API_KEY") && !has(archive, "OCR_REMOTE_API_KEY"),',
    '  llmKeyScoped: !has(hotspot, "LLM_API_KEY") && !has(comment, "LLM_API_KEY") && !has(ocr, "LLM_API_KEY") && !has(archive, "LLM_API_KEY"),',
    '  bilibiliCookieScoped: !has(ocr, "BILIBILI_COOKIE") && !has(llm, "BILIBILI_COOKIE") && !has(archive, "BILIBILI_COOKIE")',
    '}));'
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", inspectConfig], {
    cwd: projectRoot,
    env: deploymentEnv("https://gameops.test", {
      BILIBILI_COOKIE: secrets[0],
      DOUYIN_PROVIDER_TOKEN: secrets[1],
      XIAOHONGSHU_PROVIDER_TOKEN: secrets[2],
      BILIBILI_VIDEO_INFO_URL: "https://video-info.test/api",
      OCR_PROVIDER: "remote",
      OCR_REMOTE_URL: "https://ocr.test/api",
      OCR_REMOTE_API_KEY: secrets[3],
      LLM_API_KEY: secrets[4],
      LLM_JSON_MODE: "force",
      MORNING_SCHEDULE: "07:35",
      MORNING_GAMES: "鸣潮,绝区零",
      MORNING_PLATFORM: "B站",
      HOTSPOT_SOURCE_URL: "http://127.0.0.1:8790"
    }),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    hotspotCookie: true,
    commentCookie: true,
    douyinToken: true,
    xhsToken: true,
    commentInfoUrl: true,
    ocrApiKey: true,
    llmApiKey: true,
    llmJsonMode: true,
    morningSchedule: true,
    morningGames: true,
    morningPlatform: true,
    hotspotSource: true,
    providerTokensScoped: true,
    ocrKeyScoped: true,
    llmKeyScoped: true,
    bilibiliCookieScoped: true
  });
  for (const secret of secrets) assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

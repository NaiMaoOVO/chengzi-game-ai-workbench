const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const utils = fs.readFileSync(require.resolve("../utils.js"), "utf8");
const functionStart = utils.indexOf("function setArchiveSession(");
const functionEnd = utils.indexOf("\nconst PROJECT_STORAGE_KEY", functionStart);
const archiveSessionFunctions = utils.slice(functionStart, functionEnd);

function createArchiveSessionClient() {
  const context = {
    ARCHIVE_SERVICE_URL: "/api/archive",
    Headers,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    window: {
      localStorage: { getItem: () => "local", setItem() {} },
      sessionStorage: { setItem() {}, removeItem() {} },
      location: { protocol: "file:", hostname: "" }
    },
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    }
  };

  vm.runInNewContext(`
    const SERVICE_MODE_STORAGE_KEY = "gameops-service-mode-v1";
    const SERVICE_URL_PRESETS = {
      local: { ocr: "local-ocr", hotspot: "local-hotspot", comment: "local-comment", launcher: "local-launcher", llm: "local-llm", archive: "http://127.0.0.1:8796", xiaohongshu: "local-xhs" },
      online: { ocr: "/api/ocr", hotspot: "/api/hotspot", comment: "/api/comment", launcher: "", llm: "/api/llm", archive: "/api/archive", xiaohongshu: "/api/xiaohongshu" }
    };
    let OCR_SERVICE_URL = "";
    let HOTSPOT_SERVICE_URL = "";
    let COMMENT_SERVICE_URL = "";
    let LAUNCHER_SERVICE_URL = "";
    let LLM_SERVICE_URL = "";
    let ARCHIVE_SERVICE_URL = "";
    let XHS_SERVICE_URL = "";
    let archiveCsrfToken = "";
    let archiveSessionUser = null;
    let archiveAuthRequired = false;
    let archiveSessionRefreshGeneration = 0;
    ${archiveSessionFunctions}
    this.archiveSessionClient = {
      setArchiveSession,
      refreshArchiveSession,
      logoutArchiveUser,
      setServiceMode,
      current: () => ({ required: archiveAuthRequired, user: archiveSessionUser, csrfToken: archiveCsrfToken, serviceUrl: ARCHIVE_SERVICE_URL })
    };
  `, context);
  return context;
}

function seedVerifiedLogin(client) {
  client.archiveSessionClient.setArchiveSession({
    auth_required: true,
    user: { id: 7, username: "ops-user", role: "member" },
    csrf_token: "verified-csrf-token"
  });
}

test("transient archive session HTTP errors preserve the last verified account and CSRF token", async () => {
  const context = createArchiveSessionClient();
  seedVerifiedLogin(context);
  context.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: "temporary" }) });

  const result = await context.archiveSessionClient.refreshArchiveSession();
  const current = context.archiveSessionClient.current();

  assert.equal(result.required, true);
  assert.equal(result.user.username, "ops-user");
  assert.equal(current.required, true);
  assert.equal(current.user.username, "ops-user");
  assert.equal(current.csrfToken, "verified-csrf-token");
});

test("archive session network failures preserve the last verified account and CSRF token", async () => {
  const context = createArchiveSessionClient();
  seedVerifiedLogin(context);
  context.fetch = async () => { throw new Error("network unavailable"); };

  const result = await context.archiveSessionClient.refreshArchiveSession();
  const current = context.archiveSessionClient.current();

  assert.equal(result.required, true);
  assert.equal(result.user.username, "ops-user");
  assert.equal(current.required, true);
  assert.equal(current.user.username, "ops-user");
  assert.equal(current.csrfToken, "verified-csrf-token");
});

test("an explicit unauthorized archive session response clears the account and CSRF token", async () => {
  const context = createArchiveSessionClient();
  seedVerifiedLogin(context);
  context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });

  const result = await context.archiveSessionClient.refreshArchiveSession();
  const current = context.archiveSessionClient.current();

  assert.equal(result.required, true);
  assert.equal(result.user, null);
  assert.equal(current.required, true);
  assert.equal(current.user, null);
  assert.equal(current.csrfToken, "");
});

test("a late authenticated refresh cannot restore the session after logout succeeds", async () => {
  const context = createArchiveSessionClient();
  seedVerifiedLogin(context);
  let resolveRefresh;
  context.fetch = (url) => url.endsWith("/auth/session")
    ? new Promise((resolve) => { resolveRefresh = resolve; })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });

  const staleRefresh = context.archiveSessionClient.refreshArchiveSession();
  await context.archiveSessionClient.logoutArchiveUser();
  resolveRefresh({
    ok: true,
    status: 200,
    json: async () => ({ auth_required: true, user: { id: 7, username: "ops-user", role: "member" }, csrf_token: "stale-csrf-token" })
  });
  await staleRefresh;

  const current = context.archiveSessionClient.current();
  assert.equal(current.required, true);
  assert.equal(current.user, null);
  assert.equal(current.csrfToken, "");
});

test("an older concurrent session refresh cannot overwrite the newest refresh", async () => {
  const context = createArchiveSessionClient();
  const resolvers = [];
  context.fetch = () => new Promise((resolve) => { resolvers.push(resolve); });

  const olderRefresh = context.archiveSessionClient.refreshArchiveSession();
  const newerRefresh = context.archiveSessionClient.refreshArchiveSession();
  resolvers[1]({
    ok: true,
    status: 200,
    json: async () => ({ auth_required: true, user: { id: 8, username: "new-user", role: "member" }, csrf_token: "new-csrf-token" })
  });
  await newerRefresh;
  resolvers[0]({
    ok: true,
    status: 200,
    json: async () => ({ auth_required: true, user: { id: 7, username: "old-user", role: "member" }, csrf_token: "old-csrf-token" })
  });
  await olderRefresh;

  const current = context.archiveSessionClient.current();
  assert.equal(current.user.username, "new-user");
  assert.equal(current.csrfToken, "new-csrf-token");
});

test("changing service mode clears the prior account and ignores a late session refresh", async () => {
  const context = createArchiveSessionClient();
  seedVerifiedLogin(context);
  let resolveRefresh;
  context.fetch = () => new Promise((resolve) => { resolveRefresh = resolve; });

  const staleRefresh = context.archiveSessionClient.refreshArchiveSession();
  context.archiveSessionClient.setServiceMode("online");
  const afterSwitch = context.archiveSessionClient.current();
  resolveRefresh({
    ok: true,
    status: 200,
    json: async () => ({ auth_required: true, user: { id: 7, username: "ops-user", role: "member" }, csrf_token: "old-mode-csrf" })
  });
  await staleRefresh;

  const current = context.archiveSessionClient.current();
  assert.equal(afterSwitch.serviceUrl, "/api/archive");
  assert.equal(afterSwitch.user, null);
  assert.equal(afterSwitch.csrfToken, "");
  assert.equal(current.user, null);
  assert.equal(current.csrfToken, "");
});

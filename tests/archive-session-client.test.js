const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const utils = fs.readFileSync(require.resolve("../utils.js"), "utf8");
const functionStart = utils.indexOf("function setArchiveSession(");
const functionEnd = utils.indexOf("\nfunction inferDefaultServiceMode", functionStart);
const archiveSessionFunctions = utils.slice(functionStart, functionEnd);

function createArchiveSessionClient() {
  const context = {
    ARCHIVE_SERVICE_URL: "/api/archive",
    Headers,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    window: { sessionStorage: { setItem() {}, removeItem() {} } },
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    }
  };

  vm.runInNewContext(`
    let archiveCsrfToken = "";
    let archiveSessionUser = null;
    let archiveAuthRequired = false;
    ${archiveSessionFunctions}
    this.archiveSessionClient = {
      setArchiveSession,
      refreshArchiveSession,
      current: () => ({ required: archiveAuthRequired, user: archiveSessionUser, csrfToken: archiveCsrfToken })
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

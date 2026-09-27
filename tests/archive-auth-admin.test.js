const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createArchiveAuth } = require("../lib/archive-auth");

test("disabled archive auth ignores an unused administrator username", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const auth = createArchiveAuth(db, { enabled: false, adminUsername: "admin@example.com" });
    assert.equal(auth.enabled, false);
  } finally {
    db.close();
  }
});

test("archive refuses to use a member account as the configured administrator", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const localAuth = createArchiveAuth(db, { enabled: false });
    const member = localAuth.createUser({ username: "existing-member", password: "member-password-2026", role: "member" });
    assert.equal(member.role, "member");

    assert.throws(() => createArchiveAuth(db, {
      enabled: true,
      adminUsername: "existing-member",
      adminPassword: "admin-password-2026"
    }), /管理员/);
  } finally {
    db.close();
  }
});

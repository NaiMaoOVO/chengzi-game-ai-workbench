const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createArchiveAuth } = require("../lib/archive-auth");

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

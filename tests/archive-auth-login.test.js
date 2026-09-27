const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createArchiveAuth } = require("../lib/archive-auth");

test("archive login rejects out-of-range passwords before running scrypt", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const auth = createArchiveAuth(db, { enabled: false });
    const salt = "0123456789abcdef";
    const password = "valid-member-password";
    const passwordHash = salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO archive_users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("known-member", passwordHash, "member", now, now);

    const originalScrypt = crypto.scryptSync;
    let scryptCalls = 0;
    crypto.scryptSync = (...args) => {
      scryptCalls += 1;
      return originalScrypt(...args);
    };
    try {
      assert.equal(auth.login({ username: "known-member", password: "x".repeat(11) }), null);
      assert.equal(auth.login({ username: "known-member", password: "x".repeat(201) }), null);
      assert.equal(scryptCalls, 0);
      assert.ok(auth.login({ username: "known-member", password }));
      assert.equal(scryptCalls, 1);
      assert.equal(auth.login({ username: "known-member", password: "incorrect-member-password" }), null);
      assert.equal(scryptCalls, 2);
      assert.equal(auth.login({ username: "missing-member", password: "incorrect-member-password" }), null);
      assert.equal(scryptCalls, 3);
    } finally {
      crypto.scryptSync = originalScrypt;
    }
  } finally {
    db.close();
  }
});
